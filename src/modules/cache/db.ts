/**
 * Plugin-private SQLite cache.
 *
 * `new Zotero.DBConnection("sense-lingo-cache")` resolves to
 * `<data dir>/sense-lingo-cache.sqlite` (`Zotero.DataDirectory.getDatabase()`
 * appends the extension), so the cache is fully isolated from `zotero.sqlite`:
 * deleting the file clears it, and a Zotero upgrade never touches it.
 *
 * The cache is an accelerator, never the source of truth. Every failure here
 * degrades to "this lookup missed": the connection is remembered as
 * unavailable for the rest of the session and the AI path takes over.
 */

import { warn } from "../../utils/logger";
import { log } from "../../utils/logger";

const DB_NAME = "sense-lingo-cache";
const SCHEMA_VERSION = 1;

type Connection = _ZoteroTypes.DB;

/** `undefined` = not tried yet, `null` = tried and unavailable. */
let conn: Connection | null | undefined;

const DDL = [
  `CREATE TABLE IF NOT EXISTS slEntry (
    id           INTEGER PRIMARY KEY,
    attachmentID INTEGER NOT NULL,
    wordKey      TEXT    NOT NULL,
    word         TEXT    NOT NULL,
    sentenceKey  TEXT    NOT NULL,
    sentence     TEXT    NOT NULL,
    translation  TEXT    NOT NULL,
    promptHash   TEXT    NOT NULL,
    targetLang   TEXT    NOT NULL,
    profileId    TEXT    NOT NULL,
    model        TEXT,
    source       TEXT    NOT NULL,
    createdAt    INTEGER NOT NULL,
    updatedAt    INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slEntry_uniq
    ON slEntry (attachmentID, wordKey, sentenceKey, promptHash, targetLang)`,
  `CREATE INDEX IF NOT EXISTS slEntry_lookup
    ON slEntry (attachmentID, wordKey)`,
  `CREATE TABLE IF NOT EXISTS slAttachment (
    attachmentID  INTEGER PRIMARY KEY,
    state         TEXT    NOT NULL,
    signature     TEXT    NOT NULL,
    textLength    INTEGER NOT NULL,
    total         INTEGER NOT NULL,
    done          INTEGER NOT NULL,
    failed        INTEGER NOT NULL,
    expectedLines INTEGER,
    updatedAt     INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS slMeta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

/**
 * Open (once) and migrate the cache database.
 * Returns `null` when SQLite is unavailable or migration failed.
 */
export async function getCacheDb(): Promise<Connection | null> {
  if (conn !== undefined) {
    return conn;
  }
  try {
    if (
      typeof Zotero === "undefined" ||
      typeof Zotero.DBConnection !== "function"
    ) {
      conn = null;
      return null;
    }
    if (!Zotero.DataDirectory?.dir) {
      conn = null;
      return null;
    }
    const db = new Zotero.DBConnection(DB_NAME);
    await migrate(db);
    conn = db;
    log("cache db ready", db.path);
  } catch (e) {
    warn("cache db unavailable, falling back to AI", e);
    conn = null;
  }
  return conn;
}

async function migrate(db: Connection): Promise<void> {
  // `queryAsync` runs one statement at a time, so the DDL is executed one by
  // one instead of through `executeSQLFile` (which wraps everything in one
  // transaction and aborts the whole schema on a single failure).
  for (const sql of DDL) {
    await db.queryAsync(sql);
  }
  await db.queryAsync(
    "INSERT OR REPLACE INTO slMeta (key, value) VALUES (?, ?)",
    ["schemaVersion", String(SCHEMA_VERSION)],
  );
}

/** Close the connection (called from `hooks.onShutdown`). */
export async function closeCacheDb(): Promise<void> {
  const db = conn;
  conn = undefined;
  if (!db) {
    return;
  }
  try {
    await db.closeDatabase(false);
  } catch (e) {
    warn("failed to close cache db", e);
  }
}

/** Test seam: forget the cached connection state. */
export function resetCacheDb(): void {
  conn = undefined;
}

export interface CacheEntryInput {
  attachmentID: number;
  wordKey: string;
  word: string;
  sentenceKey: string;
  sentence: string;
  translation: string;
  promptHash: string;
  targetLang: string;
  profileId: string;
  model?: string;
  source: "preprocess" | "click";
}

export interface CacheEntryRow {
  wordKey: string;
  word: string;
  sentenceKey: string;
  sentence: string;
  translation: string;
  model: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

const INSERT_SQL = `INSERT INTO slEntry (
  attachmentID, wordKey, word, sentenceKey, sentence, translation,
  promptHash, targetLang, profileId, model, source, createdAt, updatedAt
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (attachmentID, wordKey, sentenceKey, promptHash, targetLang)
DO UPDATE SET
  translation = excluded.translation,
  model = excluded.model,
  source = excluded.source,
  updatedAt = excluded.updatedAt`;

const WRITE_CHUNK = 200;

/**
 * Insert or refresh entries. `INSERT ... ON CONFLICT DO UPDATE` keeps the
 * original `id`/`createdAt`, so re-running a job does not lose history.
 */
export async function putEntries(
  rows: readonly CacheEntryInput[],
): Promise<number> {
  if (!rows.length) {
    return 0;
  }
  const db = await getCacheDb();
  if (!db) {
    return 0;
  }
  const now = Date.now();
  let written = 0;
  for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
    const slice = rows.slice(start, start + WRITE_CHUNK);
    try {
      await db.executeTransaction(async () => {
        for (const row of slice) {
          await db.queryAsync(INSERT_SQL, [
            row.attachmentID,
            row.wordKey,
            row.word,
            row.sentenceKey,
            row.sentence,
            row.translation,
            row.promptHash,
            row.targetLang,
            row.profileId,
            row.model ?? "",
            row.source,
            now,
            now,
          ]);
        }
      });
      written += slice.length;
    } catch (e) {
      warn("failed to write cache entries", e);
    }
  }
  return written;
}

export interface EntryScope {
  attachmentID: number;
  promptHash: string;
  targetLang: string;
}

export interface EntryQuery extends EntryScope {
  wordKey: string;
}

/**
 * Candidates for one live selection, newest first.
 *
 * Rows are copied into plain objects: Zotero returns proxied storage rows, and
 * spreading one (as the scoring code does) does not enumerate its columns.
 */
export async function queryEntries(
  query: EntryQuery,
): Promise<CacheEntryRow[]> {
  const db = await getCacheDb();
  if (!db) {
    return [];
  }
  try {
    const rows = await db.queryAsync(
      `SELECT wordKey, word, sentenceKey, sentence, translation, model,
              source, createdAt, updatedAt
         FROM slEntry
        WHERE attachmentID = ? AND wordKey = ? AND targetLang = ?
          AND promptHash = ?
        ORDER BY updatedAt DESC
        LIMIT 50`,
      [query.attachmentID, query.wordKey, query.targetLang, query.promptHash],
    );
    return (rows ?? []).map((row) => ({
      wordKey: String(row.wordKey ?? ""),
      word: String(row.word ?? ""),
      sentenceKey: String(row.sentenceKey ?? ""),
      sentence: String(row.sentence ?? ""),
      translation: String(row.translation ?? ""),
      model: String(row.model ?? ""),
      source: String(row.source ?? ""),
      createdAt: Number(row.createdAt) || 0,
      updatedAt: Number(row.updatedAt) || 0,
    }));
  } catch (e) {
    warn("cache lookup failed", e);
    return [];
  }
}

/** `wordKey\u0000sentenceKey` of every entry a resumed job may skip. */
export async function existingEntryKeys(
  query: EntryScope,
): Promise<Set<string>> {
  const db = await getCacheDb();
  const keys = new Set<string>();
  if (!db) {
    return keys;
  }
  try {
    const rows = await db.queryAsync(
      `SELECT wordKey, sentenceKey
         FROM slEntry
        WHERE attachmentID = ? AND targetLang = ? AND promptHash = ?`,
      [query.attachmentID, query.targetLang, query.promptHash],
    );
    for (const row of (rows ?? []) as Array<{
      wordKey: string;
      sentenceKey: string;
    }>) {
      keys.add(`${row.wordKey}\u0000${row.sentenceKey}`);
    }
  } catch (e) {
    warn("failed to read existing cache keys", e);
  }
  return keys;
}

/** How many entries of one attachment/prompt are already stored. */
export async function countEntries(query: EntryScope): Promise<number> {
  const db = await getCacheDb();
  if (!db) {
    return 0;
  }
  try {
    const value = await db.valueQueryAsync<number>(
      `SELECT COUNT(*) FROM slEntry
        WHERE attachmentID = ? AND targetLang = ? AND promptHash = ?`,
      [query.attachmentID, query.targetLang, query.promptHash],
    );
    return typeof value === "number" ? value : 0;
  } catch (e) {
    warn("failed to count cache entries", e);
    return 0;
  }
}

export interface AttachmentState {
  attachmentID: number;
  state: "idle" | "running" | "paused" | "done" | "failed";
  signature: string;
  textLength: number;
  total: number;
  done: number;
  failed: number;
  expectedLines?: number;
  updatedAt: number;
}

export async function saveAttachmentState(
  state: AttachmentState,
): Promise<void> {
  const db = await getCacheDb();
  if (!db) {
    return;
  }
  try {
    await db.queryAsync(
      `INSERT OR REPLACE INTO slAttachment
        (attachmentID, state, signature, textLength, total, done, failed,
         expectedLines, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.attachmentID,
        state.state,
        state.signature,
        state.textLength,
        state.total,
        state.done,
        state.failed,
        state.expectedLines ?? null,
        Date.now(),
      ],
    );
  } catch (e) {
    warn("failed to save attachment state", e);
  }
}

export async function readAttachmentState(
  attachmentItemID: number,
): Promise<AttachmentState | null> {
  const db = await getCacheDb();
  if (!db) {
    return null;
  }
  try {
    const row = await db.rowQueryAsync(
      `SELECT attachmentID, state, signature, textLength, total, done, failed,
              expectedLines, updatedAt
         FROM slAttachment WHERE attachmentID = ?`,
      [attachmentItemID],
    );
    if (!row || row === true) {
      return null;
    }
    const record = row as Record<string, unknown>;
    return {
      attachmentID: Number(record.attachmentID) || attachmentItemID,
      state: String(record.state ?? "idle") as AttachmentState["state"],
      signature: String(record.signature ?? ""),
      textLength: Number(record.textLength) || 0,
      total: Number(record.total) || 0,
      done: Number(record.done) || 0,
      failed: Number(record.failed) || 0,
      expectedLines:
        record.expectedLines == null ? undefined : Number(record.expectedLines),
      updatedAt: Number(record.updatedAt) || 0,
    };
  } catch (e) {
    warn("failed to read attachment state", e);
    return null;
  }
}

/**
 * A job cannot survive a Zotero shutdown; any row still marked `running` is
 * turned into `paused` so the next launch offers to resume it.
 */
export async function pauseInterruptedJobs(): Promise<void> {
  const db = await getCacheDb();
  if (!db) {
    return;
  }
  try {
    await db.queryAsync(
      "UPDATE slAttachment SET state = 'paused' WHERE state = 'running'",
    );
  } catch (e) {
    warn("failed to reset interrupted jobs", e);
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getCacheDb();
  if (!db) {
    return null;
  }
  try {
    const value = await db.valueQueryAsync<string>(
      "SELECT value FROM slMeta WHERE key = ?",
      [key],
    );
    return typeof value === "string" ? value : null;
  } catch (e) {
    warn("failed to read cache meta", key, e);
    return null;
  }
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getCacheDb();
  if (!db) {
    return;
  }
  try {
    await db.queryAsync(
      "INSERT OR REPLACE INTO slMeta (key, value) VALUES (?, ?)",
      [key, value],
    );
  } catch (e) {
    warn("failed to write cache meta", key, e);
  }
}

export interface CacheStats {
  entries: number;
  attachments: number;
  bytes: number;
}

export async function getCacheStats(): Promise<CacheStats> {
  const db = await getCacheDb();
  if (!db) {
    return { entries: 0, attachments: 0, bytes: 0 };
  }
  try {
    const row = (await db.rowQueryAsync(
      `SELECT COUNT(*) AS entries,
              COUNT(DISTINCT attachmentID) AS attachments,
              COALESCE(SUM(LENGTH(translation) + LENGTH(sentence) +
                           LENGTH(word)), 0) AS bytes
         FROM slEntry`,
    )) as { entries?: number; attachments?: number; bytes?: number } | boolean;
    if (!row || row === true) {
      return { entries: 0, attachments: 0, bytes: 0 };
    }
    return {
      entries: Number(row.entries) || 0,
      attachments: Number(row.attachments) || 0,
      bytes: Number(row.bytes) || 0,
    };
  } catch (e) {
    warn("failed to read cache stats", e);
    return { entries: 0, attachments: 0, bytes: 0 };
  }
}

/**
 * Delete cached entries, for one attachment or the whole book.
 * A failure is logged only: the user asked for a cleanup, not an error.
 */
export async function clearCache(attachmentID?: number): Promise<void> {
  const db = await getCacheDb();
  if (!db) {
    return;
  }
  try {
    if (attachmentID) {
      await db.queryAsync("DELETE FROM slEntry WHERE attachmentID = ?", [
        attachmentID,
      ]);
    } else {
      await db.queryAsync("DELETE FROM slEntry");
      await db.queryAsync("DELETE FROM slAttachment");
    }
    await db.vacuum();
  } catch (e) {
    warn("failed to clear cache", e);
  }
}
