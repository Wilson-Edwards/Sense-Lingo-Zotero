/**
 * Access to the attachment's text layer.
 *
 * `Zotero.Item#attachmentText` is the public getter for this: it reads Zotero's
 * full-text cache (`.zotero-ft-cache`) and, when the attachment is not indexed
 * yet, extracts the text on demand through `Zotero.PDFWorker.getFullText`.
 * That is both cheaper and more robust than poking PDF.js ourselves.
 *
 * Results are cached per attachment because sentence resolution runs on every
 * selection.
 */

import { log, warn } from "../../utils/logger";

const MAX_CACHE_ENTRIES = 8;
const cache = new Map<number, Promise<string | null>>();

async function readAttachmentText(
  attachmentItemID: number,
): Promise<string | null> {
  try {
    const item = Zotero.Items.get(attachmentItemID);
    if (!item || !item.isAttachment()) {
      return null;
    }
    // Zotero's getter logs "Unsupported cached file type" for an EPUB that is
    // not fully indexed. EPUB has its own live-document/parser path below, so
    // do not call a getter that is only able to extract PDFs on demand.
    if (item.attachmentContentType === "application/epub+zip") {
      return null;
    }
    const text = await item.attachmentText;
    if (!text) {
      log("no text layer for attachment", attachmentItemID);
      return null;
    }
    return text;
  } catch (e) {
    warn("failed to read attachment text", attachmentItemID, e);
    return null;
  }
}

/**
 * Full text of an attachment, or `null` when there is no text layer
 * (scanned PDF, audio, image...).
 */
export function getAttachmentText(
  attachmentItemID: number | undefined,
): Promise<string | null> {
  if (!attachmentItemID || !Number.isFinite(attachmentItemID)) {
    return Promise.resolve(null);
  }
  const cached = cache.get(attachmentItemID);
  if (cached) {
    return cached;
  }
  const pending = readAttachmentText(attachmentItemID);
  cache.set(attachmentItemID, pending);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  return pending;
}

/** Drop the cache, e.g. after the user re-indexes an attachment. */
export function clearAttachmentTextCache(): void {
  cache.clear();
  epubCache.clear();
}

/** Hard cap so a huge book cannot freeze the UI thread. */
const MAX_EPUB_CHARS = 2_000_000;

const epubCache = new Map<number, Promise<string | null>>();

interface EpubSection {
  href?: string;
  doc?: Document | null;
}

interface EpubModule {
  EPUB: new (path: string) => {
    getSectionDocuments(path: string): AsyncIterable<EpubSection>;
    close(): void;
  };
}

/**
 * Last-resort text source for EPUB.
 *
 * Zotero's `Item.attachmentText` has no on-demand extraction for EPUB (only PDF
 * does), so an unindexed book returns an empty string. We then reuse the very
 * module Zotero uses for indexing (`chrome://zotero/content/EPUB.mjs`) and
 * concatenate the sections the same way.
 *
 * Everything is guarded: this touches internal Zotero APIs, so any failure must
 * degrade to "no context" instead of breaking the translation.
 */
async function readEpubText(attachmentItemID: number): Promise<string | null> {
  try {
    const item = Zotero.Items.get(attachmentItemID);
    if (!item || !item.isAttachment()) {
      return null;
    }
    if (item.attachmentContentType !== "application/epub+zip") {
      return null;
    }
    const path = await item.getFilePathAsync();
    if (!path) {
      return null;
    }
    const zoteroChrome = ChromeUtils as unknown as {
      importESModule?: (url: string) => unknown;
    };
    if (typeof zoteroChrome.importESModule !== "function") {
      warn("ChromeUtils.importESModule is unavailable");
      return null;
    }
    const { EPUB } = zoteroChrome.importESModule(
      "chrome://zotero/content/EPUB.mjs",
    ) as EpubModule;
    if (!EPUB) {
      return null;
    }
    const epub = new EPUB(path);
    try {
      let text = "";
      for await (const section of epub.getSectionDocuments(path)) {
        const body = section?.doc?.body;
        if (!body) {
          continue;
        }
        text += `${(body as HTMLElement).innerText || body.textContent || ""}\n`;
        if (text.length >= MAX_EPUB_CHARS) {
          log("EPUB text truncated at", MAX_EPUB_CHARS, "chars");
          break;
        }
      }
      const trimmed = text.trim();
      log("extracted EPUB text", trimmed.length, "chars");
      return trimmed || null;
    } finally {
      // EPUB holds a ZipReader open; Zotero's own indexer closes it too.
      try {
        epub.close();
      } catch (e) {
        warn("failed to close EPUB reader", e);
      }
    }
  } catch (e) {
    warn("failed to extract EPUB text", attachmentItemID, e);
    return null;
  }
}

/** Full text of an EPUB, extracted with Zotero's own parser (cached). */
export function getEpubFullText(
  attachmentItemID: number | undefined,
): Promise<string | null> {
  if (!attachmentItemID || !Number.isFinite(attachmentItemID)) {
    return Promise.resolve(null);
  }
  const cached = epubCache.get(attachmentItemID);
  if (cached) {
    return cached;
  }
  const pending = readEpubText(attachmentItemID);
  epubCache.set(attachmentItemID, pending);
  if (epubCache.size > MAX_CACHE_ENTRIES) {
    const oldest = epubCache.keys().next();
    if (!oldest.done) {
      epubCache.delete(oldest.value);
    }
  }
  return pending;
}

/** Best-effort title of the parent item, used by the `{itemTitle}` variable. */
export function getItemTitle(attachmentItemID: number | undefined): string {
  if (!attachmentItemID) {
    return "";
  }
  try {
    const item = Zotero.Items.get(attachmentItemID);
    if (!item) {
      return "";
    }
    const parent = item.parentItem;
    if (parent) {
      return parent.getField("title") || "";
    }
    return item.getField("title") || "";
  } catch (e) {
    log("failed to read item title", e);
    return "";
  }
}
