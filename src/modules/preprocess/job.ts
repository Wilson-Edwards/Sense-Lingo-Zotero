/**
 * Preprocessing job: EPUB -> candidates -> batched LLM calls -> SQLite.
 *
 * One job runs at a time (`activeJob`). Every network call is bounded by the
 * provider's own timeout, every chunk is written in its own transaction, and a
 * cancel only takes effect between chunks — so an interrupted run leaves the
 * database in a consistent, resumable state.
 */

import { chatCompletion, LlmError } from "../llm/client";
import { normalizeWordTranslation } from "../llm/format";
import { isConfigured } from "../llm/providers";
import { getProfile } from "../llm/prompt";
import { renderPrompt } from "../llm/render";
import { getEpubSections } from "../reader/textSource";
import {
  getCacheDb,
  existingEntryKeys,
  getMeta,
  putEntries,
  saveAttachmentState,
  setMeta,
  type CacheEntryInput,
} from "../cache/db";
import { promptHash } from "../cache/keys";
import { getNumberPref, getStringPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { log, warn } from "../../utils/logger";
import { readSettings, type PluginSettings } from "../translate";
import {
  buildBatchSystem,
  buildBatchUser,
  canBatch,
  chunkItems,
  countAnswerLines,
  parseBatchOutput,
} from "./batch";
import {
  extractCandidates,
  normalizePreprocessLanguageFilter,
  type PreprocessSection,
} from "./extract";

/** Rough character budget per request, after the item-count limit. */
const BATCH_MAX_CHARS = 6000;
/**
 * Completion budget per batch item.
 *
 * On a gateway that always reasons (Command Code answers `reasoning: {enabled:
 * false}` with the same amount of thinking), the thinking phase is billed
 * against `max_tokens` first: measured on `deepseek/deepseek-v4.1-flash`, one
 * three-line item costs 300-500 tokens, so 120 per item spends the whole budget
 * on reasoning and the answer arrives empty.
 */
const BATCH_TOKENS_PER_ITEM = 400;
/** Floor for one request; a reasoning word prompt regularly needs more than 1k. */
const MIN_REQUEST_TOKENS = 2048;
/** A batch of reasoning answers outlives the click-translation timeout. */
const BATCH_TIMEOUT_BASE_MS = 20_000;
const BATCH_TIMEOUT_PER_ITEM_MS = 3_000;
const WRITE_SAVE_WINDOW_MS = 1000;
const MAX_REQUEST_ATTEMPTS = 3;
/** Stop instead of burning tokens on a provider that keeps failing per item. */
const MAX_CONSECUTIVE_FAILURES = 3;

interface JobItem {
  word: string;
  wordKey: string;
  sentence: string;
  sentenceKey: string;
  /** The single-item user message for this word. */
  userPrompt: string;
}

export interface PreprocessOptions {
  /** Ask for confirmation before spending tokens (default true). */
  confirm?: boolean;
}

/** A safe, read-only snapshot for task-management UI. */
export interface ActivePreprocessProgress {
  attachmentID: number;
  total: number;
  done: number;
  failed: number;
}

let activeJob: PreprocessJob | null = null;

export function isJobRunning(): boolean {
  return activeJob !== null;
}

export function getActiveJobProgress(): ActivePreprocessProgress | null {
  return activeJob?.progressSnapshot() ?? null;
}

export function cancelActiveJob(): void {
  activeJob?.cancel();
}

/** Entry point for the menu, the settings pane and the auto-run hook. */
export async function startPreprocess(
  attachmentItemID: number,
  options: PreprocessOptions = {},
): Promise<void> {
  if (activeJob) {
    warn("a preprocessing job is already running");
    return;
  }
  const job = new PreprocessJob(attachmentItemID, options);
  activeJob = job;
  try {
    await job.run();
  } catch (e) {
    warn("preprocessing job failed", e);
  } finally {
    activeJob = null;
  }
}

class PreprocessJob {
  private readonly attachmentItemID: number;
  private readonly confirmFirst: boolean;

  private cancelled = false;
  /** Set when a fatal provider/database error makes continuing pointless. */
  private stoppedReason: string | null = null;

  private settings: PluginSettings | null = null;
  private systemTemplate = "";
  private userTemplate = "";
  private targetLang = "zh-CN";
  private profileId = "word";
  private promptSignature = "";
  private batchEnabled = false;
  private expectedLines = 0;

  private total = 0;
  private doneCount = 0;
  private failedCount = 0;
  private consecutiveFailures = 0;
  private signature = "";
  private bookChars = 0;

  private progress: Zotero.ProgressWindow | null = null;
  private progressItem: _ZoteroTypes.ItemProgress | null = null;
  private lastProgressAt = 0;
  private lastProgressDone = 0;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(attachmentItemID: number, options: PreprocessOptions) {
    this.attachmentItemID = attachmentItemID;
    this.confirmFirst = options.confirm !== false;
  }

  cancel(): void {
    this.cancelled = true;
  }

  progressSnapshot(): ActivePreprocessProgress {
    return {
      attachmentID: this.attachmentItemID,
      total: this.total,
      done: this.doneCount,
      failed: this.failedCount,
    };
  }

  async run(): Promise<void> {
    const settings = readSettings();
    if (!settings.useContext) {
      this.notifyError(getString("prefetch-need-context"));
      return;
    }
    // The preprocessing provider can be its own; without a key every request
    // would fail the same way, so say it once up front.
    if (!isConfigured(settings.prefetchProvider)) {
      this.notifyError(getString("prefetch-need-provider"));
      return;
    }
    const profile = getProfile(
      settings.profiles,
      settings.wordProfileId,
      "word",
    );
    this.settings = settings;
    this.systemTemplate = profile.profile.system;
    this.userTemplate = profile.profile.user;
    this.targetLang = settings.targetLang;
    this.profileId = profile.profileId;
    this.promptSignature = promptHash(
      this.systemTemplate,
      this.userTemplate,
      this.targetLang,
    );
    this.batchEnabled =
      getNumberPref("prefetchBatchSize", 12) > 1 &&
      canBatch(this.systemTemplate);

    const item = this.readAttachment();
    if (!item) {
      this.notifyError(getString("prefetch-not-epub"));
      return;
    }

    const sections = await getEpubSections(this.attachmentItemID);
    if (!sections?.length) {
      this.notifyError(getString("prefetch-no-text"));
      return;
    }

    const items = this.buildItems(sections);
    this.total = items.length;
    if (!this.total) {
      this.notifyError(getString("prefetch-no-entries"));
      return;
    }

    if (this.confirmFirst && !this.confirm()) {
      return;
    }

    const db = await getCacheDb();
    if (!db) {
      this.notifyError(getString("prefetch-no-db"));
      return;
    }

    this.bookChars = textLength(sections);
    this.signature = await this.signatureOf(this.bookChars);
    this.openProgress();
    const planned = this.total;
    const existing = await existingEntryKeys({
      attachmentID: this.attachmentItemID,
      promptHash: this.promptSignature,
      targetLang: this.targetLang,
    });
    this.doneCount = Math.min(existing.size, planned);
    const pending = items.filter(
      (entry) => !existing.has(`${entry.wordKey}\u0000${entry.sentenceKey}`),
    );

    await saveAttachmentState({
      attachmentID: this.attachmentItemID,
      state: "running",
      signature: this.signature,
      textLength: this.bookChars,
      total: planned,
      done: this.doneCount,
      failed: 0,
      updatedAt: Date.now(),
    });

    log("preprocess job", {
      attachment: this.attachmentItemID,
      provider: settings.prefetchProvider.provider,
      planned,
      pending: pending.length,
      batch: this.batchEnabled,
    });

    if (!pending.length) {
      await this.finish("done");
      return;
    }

    if (this.batchEnabled) {
      const lines = await this.probeExpectedLines(pending[0]);
      if (!lines) {
        this.batchEnabled = false;
        warn("batching disabled: the template's line count is unstable");
      } else {
        this.expectedLines = lines;
      }
    }

    const chunks = this.batchEnabled
      ? chunkItems(pending, {
          maxItems: getNumberPref("prefetchBatchSize", 12),
          maxChars: BATCH_MAX_CHARS,
        })
      : pending.map((entry) => [entry]);

    await this.runChunks(chunks);
    await this.finish(this.cancelled || this.stoppedReason ? "paused" : "done");
  }

  // ---------------------------------------------------------------- extraction

  private readAttachment(): Zotero.Item | null {
    try {
      const item = Zotero.Items.get(this.attachmentItemID);
      if (
        !item ||
        !item.isAttachment() ||
        item.attachmentContentType !== "application/epub+zip"
      ) {
        return null;
      }
      return item;
    } catch (e) {
      warn("failed to read attachment", this.attachmentItemID, e);
      return null;
    }
  }

  private buildItems(sections: readonly PreprocessSection[]): JobItem[] {
    const settings = this.settings;
    if (!settings) {
      return [];
    }
    const candidates = extractCandidates(sections, {
      maxSentenceChars: settings.maxSentenceChars,
      maxSentencesPerWord: getNumberPref("prefetchMaxSentencesPerWord", 3),
      languageFilter: normalizePreprocessLanguageFilter(
        getStringPref("prefetchLanguageFilter", "system"),
      ),
      systemLocale: Zotero.locale,
    });
    return candidates.map((candidate) => ({
      word: candidate.word,
      wordKey: candidate.wordKey,
      sentence: candidate.sentence,
      sentenceKey: candidate.sentenceKey,
      userPrompt: renderPrompt(this.userTemplate, {
        text: candidate.word,
        word: candidate.word,
        sentence: candidate.sentence,
        prevSentence: "",
        nextSentence: "",
        targetLang: this.targetLang,
        sourceLang: settings.sourceLang,
        selectionType: "word",
        itemTitle: "",
      }),
    }));
  }

  private async signatureOf(length: number): Promise<string> {
    let modified = 0;
    let name = "";
    try {
      const item = Zotero.Items.get(this.attachmentItemID);
      if (item) {
        modified = (await item.attachmentModificationTime) ?? 0;
        name = item.attachmentFilename ?? "";
      }
    } catch {
      // A missing file still lets the job run; the signature is informational.
    }
    return `${modified}|${name}|${length}`;
  }

  // --------------------------------------------------------------- interaction

  private confirm(): boolean {
    const batchSize = Math.max(1, getNumberPref("prefetchBatchSize", 12));
    const requests = this.batchEnabled
      ? Math.ceil(this.total / batchSize)
      : this.total;
    const message = getString("prefetch-confirm", {
      entries: String(this.total),
      requests: String(requests),
    });
    try {
      return Zotero.getMainWindow().confirm(message);
    } catch {
      return true;
    }
  }

  private notifyError(message: string): void {
    warn("preprocessing aborted:", message);
    try {
      const progress = new Zotero.ProgressWindow({ closeOnClick: true });
      progress.changeHeadline(getString("prefetch-headline"));
      progress.addDescription(message);
      progress.show();
      progress.startCloseTimer(6000);
    } catch {
      // Progress window is a convenience; the log already has the reason.
    }
  }

  private openProgress(): void {
    try {
      const progress = new Zotero.ProgressWindow({ closeOnClick: false });
      progress.changeHeadline(getString("prefetch-headline"));
      progress.show();
      this.progress = progress;
      this.progressItem = new progress.ItemProgress(
        "chrome://zotero/skin/tick.png",
        getString("prefetch-progress", {
          done: String(this.doneCount),
          total: String(this.total),
        }),
      );
    } catch (e) {
      warn("failed to open progress window", e);
    }
  }

  private updateProgress(force = false): void {
    const item = this.progressItem;
    if (!item) {
      return;
    }
    const now = Date.now();
    if (
      !force &&
      now - this.lastProgressAt < WRITE_SAVE_WINDOW_MS &&
      this.doneCount - this.lastProgressDone < 10
    ) {
      return;
    }
    this.lastProgressAt = now;
    this.lastProgressDone = this.doneCount;
    try {
      item.setText(
        getString("prefetch-progress", {
          done: String(this.doneCount),
          total: String(this.total),
        }),
      );
      item.setProgress(Math.round((this.doneCount / this.total) * 100));
    } catch {
      // The user may have closed the progress window.
    }
  }

  private async finish(state: "done" | "paused" | "failed"): Promise<void> {
    await saveAttachmentState({
      attachmentID: this.attachmentItemID,
      state,
      signature: this.signature,
      textLength: this.bookChars,
      total: this.total,
      done: this.doneCount,
      failed: this.failedCount,
      expectedLines: this.expectedLines || undefined,
      updatedAt: Date.now(),
    });
    this.updateProgress(true);
    const summary = this.stoppedReason
      ? getString("prefetch-paused-error", { reason: this.stoppedReason })
      : getString("prefetch-summary", {
          done: String(this.doneCount),
          total: String(this.total),
          failed: String(this.failedCount),
        });
    try {
      this.progress?.changeHeadline(summary);
      this.progress?.startCloseTimer(8000);
    } catch {
      // Nothing to do when the window is gone.
    }
    log("preprocess finished", state, summary);
  }

  // -------------------------------------------------------------------- batching

  /** Probe how many lines one answer of this template has, so batches match. */
  private async probeExpectedLines(sample: JobItem): Promise<number | null> {
    const key = `expectedLines:${this.promptSignature}`;
    const stored = Number(await getMeta(key));
    if (Number.isInteger(stored) && stored > 0) {
      return stored;
    }
    try {
      const result = await this.requestSingle(sample);
      const lines = countAnswerLines(result);
      if (lines > 0) {
        await setMeta(key, String(lines));
        return lines;
      }
    } catch (e) {
      if (this.isFatal(e)) {
        this.stoppedReason = describeError(e);
      }
    }
    return null;
  }

  /**
   * Provider config for one request.
   *
   * `allowThinking` exists because some gateways answer "empty response
   * content" (or HTTP 500) when a reasoning model is asked to skip its
   * reasoning phase; the last retry therefore drops the no-thinking hint.
   */
  private providerConfig(maxTokens: number, allowThinking = false) {
    if (!this.settings) {
      throw new LlmError("NOT_CONFIGURED", "settings not loaded");
    }
    const provider = this.settings.prefetchProvider;
    return {
      ...provider,
      stream: false,
      disableThinking: allowThinking ? false : provider.disableThinking,
      maxTokens: Math.max(provider.maxTokens, maxTokens),
    };
  }

  /**
   * Run one request with backoff.
   *
   * Rate limits, 5xx, network timeouts and empty completions are worth a retry;
   * auth failures and bad requests are not. The budget doubles on every attempt:
   * an empty answer is usually the reasoning phase spending the whole
   * `max_tokens` before the first output token, and dropping the no-thinking
   * hint (the last attempt does that too) changes nothing on gateways that
   * ignore the field.
   */
  private async requestWithRetry(
    maxTokens: number,
    messages: Parameters<typeof chatCompletion>[0]["messages"],
    timeoutMs?: number,
  ) {
    const attempts = MAX_REQUEST_ATTEMPTS;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await chatCompletion({
          config: this.providerConfig(
            maxTokens * 2 ** (attempt - 1),
            attempt === attempts,
          ),
          messages,
          timeoutMs,
        });
      } catch (e) {
        lastError = e;
        if (!isRetryableError(e) || this.cancelled || attempt === attempts) {
          throw e;
        }
        const wait = retryDelay(attempt);
        warn(
          `request failed (attempt ${attempt}/${attempts}), retrying in ${wait}ms`,
          describeError(e),
        );
        await sleep(wait);
      }
    }
    throw lastError;
  }

  /** One single-item request; used for probes and for the fallback path. */
  private async requestSingle(item: JobItem): Promise<string> {
    const response = await this.requestWithRetry(MIN_REQUEST_TOKENS, [
      { role: "system", content: this.systemTemplate },
      { role: "user", content: item.userPrompt },
    ]);
    await this.delay();
    return response.content;
  }

  /**
   * One batch request. A parse failure is `null` (the caller retries in
   * halves); an empty answer is a parse failure too. Everything else (auth,
   * network, rate limit) propagates after the retries.
   */
  private async requestBatch(
    items: readonly JobItem[],
  ): Promise<string[] | null> {
    const response = await this.requestWithRetry(
      Math.max(MIN_REQUEST_TOKENS, BATCH_TOKENS_PER_ITEM * items.length),
      [
        {
          role: "system",
          content: buildBatchSystem(this.systemTemplate, this.expectedLines),
        },
        {
          role: "user",
          content: buildBatchUser(items.map((item) => item.userPrompt)),
        },
      ],
      this.batchTimeout(items.length),
    );
    await this.delay();
    return parseBatchOutput(response.content, items.length, this.expectedLines);
  }

  /** A batch of `count` reasoning answers is slower than one click request. */
  private batchTimeout(count: number): number {
    const base = this.settings?.prefetchProvider.timeoutMs ?? 30_000;
    return Math.max(base, BATCH_TIMEOUT_BASE_MS + BATCH_TIMEOUT_PER_ITEM_MS * count);
  }

  // --------------------------------------------------------------------- chunks

  private async runChunks(chunks: JobItem[][]): Promise<void> {
    let cursor = 0;
    const concurrency = Math.max(
      1,
      Math.min(8, getNumberPref("prefetchConcurrency", 2)),
    );
    const worker = async (): Promise<void> => {
      while (!this.cancelled && !this.stoppedReason) {
        const index = cursor;
        cursor += 1;
        if (index >= chunks.length) {
          return;
        }
        await this.handleChunk(chunks[index], 0);
        this.updateProgress();
        // Hand the main thread back so the UI keeps painting between chunks.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, chunks.length) }, worker),
    );
  }

  private async handleChunk(chunk: JobItem[], depth: number): Promise<void> {
    if (this.cancelled || this.stoppedReason || !chunk.length) {
      return;
    }
    if (this.batchEnabled && chunk.length > 1) {
      let parseFailure = false;
      try {
        const translations = await this.requestBatch(chunk);
        if (translations) {
          await this.write(chunk, translations);
          return;
        }
        parseFailure = true;
      } catch (e) {
        if (isBatchParseError(e)) {
          // The body arrived but did not follow the marker contract: a smaller
          // batch is the cheapest way to find out whether size is the issue.
          parseFailure = true;
        } else if (isRetryableError(e)) {
          // The provider itself failed (5xx / empty answer / network). Batching
          // is not the suspect here, and waiting on it would stall the whole
          // book: disable it for this run and give each item its own request.
          this.batchEnabled = false;
          warn(
            "batch request failed after retries, falling back to single requests",
            describeError(e),
          );
        } else {
          this.stopForError(e);
          return;
        }
      }
      if (parseFailure && depth < 1 && chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        await this.handleChunk(chunk.slice(0, middle), depth + 1);
        await this.handleChunk(chunk.slice(middle), depth + 1);
        return;
      }
    }
    await this.handleIndividually(chunk);
  }

  private async handleIndividually(chunk: readonly JobItem[]): Promise<void> {
    for (const item of chunk) {
      if (this.cancelled || this.stoppedReason) {
        return;
      }
      try {
        const raw = await this.requestSingle(item);
        await this.write([item], [normalizeWordTranslation(raw)]);
      } catch (e) {
        if (this.isFatal(e)) {
          this.stopForError(e);
          return;
        }
        this.failedCount += 1;
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.stopForError(e);
          return;
        }
      }
    }
  }

  private async write(
    items: readonly JobItem[],
    translations: readonly string[],
  ): Promise<void> {
    const rows: CacheEntryInput[] = items.map((item, index) => ({
      attachmentID: this.attachmentItemID,
      wordKey: item.wordKey,
      word: item.word,
      sentenceKey: item.sentenceKey,
      sentence: item.sentence,
      translation: translations[index],
      promptHash: this.promptSignature,
      targetLang: this.targetLang,
      profileId: this.profileId,
      model: this.settings?.prefetchProvider.model ?? "",
      source: "preprocess",
    }));
    let written = 0;
    await this.enqueueWrite(async () => {
      written = await putEntries(rows);
      this.doneCount += written;
      this.failedCount += rows.length - written;
      // Keep the durable task list useful after an interrupted run as well as
      // while it is open in Preferences. This shares the existing serialised
      // SQLite write queue with cache rows, so state cannot outrun the data.
      await saveAttachmentState({
        attachmentID: this.attachmentItemID,
        state: "running",
        signature: this.signature,
        textLength: this.bookChars,
        total: this.total,
        done: this.doneCount,
        failed: this.failedCount,
        expectedLines: this.expectedLines || undefined,
        updatedAt: Date.now(),
      });
    });
    if (written > 0) {
      this.consecutiveFailures = 0;
    }
    this.updateProgress();
  }

  /** Writes are serialised: one SQLite connection handles one transaction. */
  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private stopForError(error: unknown): void {
    this.stoppedReason = describeError(error);
    warn("preprocessing paused", this.stoppedReason);
  }

  private isFatal(error: unknown): boolean {
    return (
      error instanceof LlmError &&
      (error.code === "HTTP" ||
        error.code === "NETWORK" ||
        error.code === "TIMEOUT" ||
        error.code === "NOT_CONFIGURED")
    );
  }

  private async delay(): Promise<void> {
    const ms = Math.max(0, getNumberPref("prefetchDelayMs", 200));
    if (!ms) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}

/** Empty / unparsable body: retry smaller instead of aborting the job. */
function isBatchParseError(error: unknown): boolean {
  return (
    error instanceof LlmError &&
    (error.code === "PARSE" || error.code === "EMPTY")
  );
}

/**
 * Failures that are worth another request.
 *
 * A 5xx or an empty completion is usually transient (or caused by a reasoning
 * model refusing to answer without its thinking phase), while 400/401/403 mean
 * the request itself must change.
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof LlmError)) {
    return false;
  }
  if (error.code === "NETWORK" || error.code === "TIMEOUT") {
    return true;
  }
  if (error.code === "EMPTY") {
    return true;
  }
  if (error.code !== "HTTP") {
    return false;
  }
  const status = error.status ?? 0;
  return (
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

/** Exponential backoff with a little jitter so parallel retries spread out. */
function retryDelay(attempt: number): number {
  const base = Math.max(500, getNumberPref("prefetchDelayMs", 200));
  const wait = Math.min(8000, base * 2 ** (attempt - 1));
  return wait + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  if (error instanceof LlmError) {
    if (error.code === "HTTP") {
      return `${error.status ?? ""} ${error.detail ?? error.message}`.trim();
    }
    return `${error.code}: ${error.message}`;
  }
  return (error as Error)?.message ?? String(error);
}

function textLength(sections: readonly PreprocessSection[]): number {
  return sections.reduce((sum, section) => sum + section.text.length, 0);
}
