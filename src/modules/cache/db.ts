/**
 * Plugin-private SQLite cache.
 *
 * The file is `<data dir>/sense-lingo-cache.sqlite`
 * (`Zotero.DataDirectory.getDatabase()` appends the extension), so the cache is
 * fully isolated from `zotero.sqlite`: deleting the file clears it, and a
 * Zotero upgrade never touches it.
 *
 * The connection is opened by absolute path on purpose. A name-based
 * `Zotero.DBConnection` runs `PRAGMA integrity_check` on the next launch
 * whenever the previous session left a non-empty `-wal` file (Dock quit that
 * didn't finish its checkpoint, a crash, or a plugin reload). That check runs
 * synchronously on the main thread and freezes the UI behind a
 * "checking database integrity" progress bar. A path-based connection is
 * treated as an external database and skips the check; the cache is disposable,
 * so nothing here needs verifying, and WAL is still enabled below for writes.
 *
 * Translations live in one table per attachment (`slEntry_<attachmentID>`, see
 * `./table.ts`): a book's rows never share pages with another book, every query
 * touches a table bounded by one book, and dropping a book is a `DROP TABLE`
 * instead of a full-table `DELETE` followed by a whole-file `VACUUM`.
 * `slAttachment` and `slMeta` stay global because they hold one row per book
 * and a handful of keys.
 *
 * The cache is an accelerator, never the source of truth. Every failure here
 * degrades to "this lookup missed": the connection is remembered as
 * unavailable for the rest of the session and the AI path takes over.
 */

import { warn } from "../../utils/logger";
import { log } from "../../utils/logger";
import { attachmentIdFromTableName, entryTableName } from "./table";

const DB_NAME = "sense-lingo-cache";
/** 2 = one `slEntry_<attachmentID>` table per book instead of a single table. */
const SCHEMA_VERSION = 2;
/** Schema 1 kept every translation here; `migrate` splits it per book. */
const LEGACY_ENTRY_TABLE = "slEntry";

type Connection = _ZoteroTypes.DB;

/** `undefined` = not tried yet, `null` = tried and unavailable. */
let conn: Connection | null | undefined;

/**
 * Global tables. The translation tables are created on demand by `entryTable`.
 */
const DDL = [
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
 * DDL for one book's translation table.
 *
 * `attachmentID` is no longer a column: the table name carries it, which also
 * removes the extra column from the unique index and from every row.
 * Index names are global in SQLite, hence the `<table>_uniq` / `<table>_lookup`
 * suffixes.
 */
function entryDdl(table: string): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${table} (
      id           INTEGER PRIMARY KEY,
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
    `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_uniq
      ON ${table} (wordKey, sentenceKey, promptHash, targetLang)`,
    `CREATE INDEX IF NOT EXISTS ${table}_lookup
      ON ${table} (wordKey, targetLang, promptHash)`,
  ];
}

/**
 * Table existence learned this session by book.
 *
 * `knownTables` avoids repeating DDL/`sqlite_master` lookups on the hot click
 * path; `absentTables` keeps a book that was never cached from being probed
 * again and again.
 */
const knownTables = new Set<string>();
const absentTables = new Set<string>();

/** `queryAsync` returns `false` instead of an empty array on some versions. */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : [];
}

/**
 * The book's table, if it already exists.
 *
 * Reads must never create schema: clicking a word in a book that was never
 * cached is a plain miss, not a reason to add an empty table.
 */
async function existingEntryTable(
  db: Connection,
  attachmentID: number,
): Promise<string | null> {
  const table = entryTableName(attachmentID);
  if (!table) {
    return null;
  }
  if (knownTables.has(table)) {
    return table;
  }
  if (absentTables.has(table)) {
    return null;
  }
  try {
    const rows = rowsOf(
      await db.queryAsync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      ),
    );
    if (!rows.length) {
      absentTables.add(table);
      return null;
    }
    knownTables.add(table);
    return table;
  } catch (e) {
    warn("failed to look up cache table", table, e);
    return null;
  }
}

/**
 * The book's table, created on first use.
 *
 * `null` means "no cache for this attachment" (unusable id or a failed DDL),
 * which the write path reports as "nothing written".
 */
async function ensureEntryTable(
  db: Connection,
  attachmentID: number,
): Promise<string | null> {
  const table = entryTableName(attachmentID);
  if (!table) {
    return null;
  }
  if (knownTables.has(table)) {
    return table;
  }
  try {
    for (const sql of entryDdl(table)) {
      await db.queryAsync(sql);
    }
    absentTables.delete(table);
    knownTables.add(table);
    return table;
  } catch (e) {
    warn("failed to create cache table", table, e);
    return null;
  }
}

/** Every `slEntry_<id>` table in the file, in a stable order. */
async function listEntryTables(db: Connection): Promise<string[]> {
  try {
    const rows = rowsOf(
      await db.queryAsync(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ),
    );
    const names: string[] = [];
    for (const row of rows) {
      const name = String(row.name ?? "");
      if (attachmentIdFromTableName(name) !== null) {
        names.push(name);
      }
    }
    return names.sort();
  } catch (e) {
    warn("failed to list cache tables", e);
    return [];
  }
}

/**
 * Drop one book's table.
 *
 * `DROP TABLE` releases the pages without rewriting the file, so no `VACUUM`
 * is needed here — that is the whole point of one table per book.
 */
async function dropEntryTable(db: Connection, table: string): Promise<void> {
  try {
    await db.queryAsync(`DROP TABLE IF EXISTS ${table}`);
    knownTables.delete(table);
    absentTables.add(table);
  } catch (e) {
    warn("failed to drop cache table", table, e);
  }
}

/**
 * Open (once) and migrate the cache database.
 * Returns `null` when SQLite is unavailable or migration failed.
 */
export async function getCacheDb(): Promise<Connection | null> {
  if (conn !== undefined) {
    return conn;
  }
  let db: Connection | undefined;
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
    db = new Zotero.DBConnection(Zotero.DataDirectory.getDatabase(DB_NAME));
    // A path-based connection is external, so Zotero leaves the journal mode
    // alone. Set it here to keep bulk writes from paying an fsync per commit.
    try {
      await db.queryAsync("PRAGMA journal_mode=WAL");
      await db.queryAsync("PRAGMA synchronous=NORMAL");
    } catch (e) {
      // A filesystem that can't do WAL (e.g. a network share) still works with
      // the default journal mode; it only writes slower.
      warn("cache db: WAL unavailable, using the default journal mode", e);
    }
    await migrate(db);
    conn = db;
    log("cache db ready", db.path);
  } catch (e) {
    warn("cache db unavailable, falling back to AI", e);
    conn = null;
    if (db) {
      try {
        await db.closeDatabase(false);
      } catch (closeError) {
        warn("failed to close unusable cache db", closeError);
      }
    }
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
  await splitLegacyEntryTable(db);
  await db.queryAsync(
    "INSERT OR REPLACE INTO slMeta (key, value) VALUES (?, ?)",
    ["schemaVersion", String(SCHEMA_VERSION)],
  );
}

/**
 * Move schema 1's single `slEntry` table into one table per attachment.
 *
 * The copy is `INSERT OR IGNORE` into the per-book tables, so it is reentrant:
 * a crash halfway through leaves the legacy table in place and the next start
 * redoes the copy without duplicating rows. The legacy table is dropped only
 * after every book has been copied.
 */
async function splitLegacyEntryTable(db: Connection): Promise<void> {
  const exists = rowsOf(
    await db.queryAsync(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [LEGACY_ENTRY_TABLE],
    ),
  );
  if (!exists.length) {
    return;
  }

  const attachmentIDs = new Set<number>();
  for (const row of rowsOf(
    await db.queryAsync(
      `SELECT DISTINCT attachmentID FROM ${LEGACY_ENTRY_TABLE}`,
    ),
  )) {
    const id = Number(row.attachmentID);
    if (!entryTableName(id)) {
      // Nothing can look these up (every query needs a real attachment), so
      // they go away with the legacy table.
      warn(
        "dropping cache rows with an invalid attachment id",
        row.attachmentID,
      );
      continue;
    }
    attachmentIDs.add(id);
  }

  for (const id of attachmentIDs) {
    const table = await ensureEntryTable(db, id);
    if (!table) {
      // Leave the legacy table untouched; the next start retries.
      throw new Error(`cannot create the cache table for attachment ${id}`);
    }
    await db.queryAsync(
      `INSERT OR IGNORE INTO ${table}
         (wordKey, word, sentenceKey, sentence, translation, promptHash,
          targetLang, profileId, model, source, createdAt, updatedAt)
       SELECT wordKey, word, sentenceKey, sentence, translation, promptHash,
              targetLang, profileId, model, source, createdAt, updatedAt
         FROM ${LEGACY_ENTRY_TABLE}
        WHERE attachmentID = ?`,
      [id],
    );
  }

  await db.queryAsync(`DROP TABLE ${LEGACY_ENTRY_TABLE}`);
  log("cache migrated to per-book tables", attachmentIDs.size);
}

/** Close the connection (called from `hooks.onShutdown`). */
export async function closeCacheDb(): Promise<void> {
  const db = conn;
  conn = undefined;
  knownTables.clear();
  absentTables.clear();
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
  knownTables.clear();
  absentTables.clear();
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

/**
 * Insert/refresh SQL for one book's table.
 *
 * The table name comes from `entryTableName`, so it is always
 * `slEntry_<positive integer>` — safe to interpolate.
 */
function insertSql(table: string): string {
  return `INSERT INTO ${table} (
    wordKey, word, sentenceKey, sentence, translation,
    promptHash, targetLang, profileId, model, source, createdAt, updatedAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (wordKey, sentenceKey, promptHash, targetLang)
  DO UPDATE SET
    translation = excluded.translation,
    model = excluded.model,
    source = excluded.source,
    updatedAt = excluded.updatedAt`;
}

const WRITE_CHUNK = 200;

/**
 * Insert or refresh entries, grouped by book.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` keeps the original `id`/`createdAt`, so
 * re-running a job does not lose history. Rows for different attachments go to
 * different tables, so they cannot share a transaction; each write chunk still
 * gets its own transaction, exactly as before.
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
  const byAttachment = new Map<number, CacheEntryInput[]>();
  for (const row of rows) {
    const bucket = byAttachment.get(row.attachmentID);
    if (bucket) {
      bucket.push(row);
    } else {
      byAttachment.set(row.attachmentID, [row]);
    }
  }

  let written = 0;
  for (const [attachmentID, group] of byAttachment) {
    const table = await ensureEntryTable(db, attachmentID);
    if (!table) {
      continue;
    }
    const sql = insertSql(table);
    for (let start = 0; start < group.length; start += WRITE_CHUNK) {
      const slice = group.slice(start, start + WRITE_CHUNK);
      try {
        await db.executeTransaction(async () => {
          for (const row of slice) {
            await db.queryAsync(sql, [
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
  const table = await existingEntryTable(db, query.attachmentID);
  if (!table) {
    return [];
  }
  try {
    const rows = rowsOf(
      await db.queryAsync(
        `SELECT wordKey, word, sentenceKey, sentence, translation, model,
                source, createdAt, updatedAt
           FROM ${table}
          WHERE wordKey = ? AND targetLang = ? AND promptHash = ?
          ORDER BY updatedAt DESC
          LIMIT 50`,
        [query.wordKey, query.targetLang, query.promptHash],
      ),
    );
    return rows.map((row) => ({
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
  const table = await existingEntryTable(db, query.attachmentID);
  if (!table) {
    return keys;
  }
  try {
    const rows = rowsOf(
      await db.queryAsync(
        `SELECT wordKey, sentenceKey
           FROM ${table}
          WHERE targetLang = ? AND promptHash = ?`,
        [query.targetLang, query.promptHash],
      ),
    );
    for (const row of rows) {
      keys.add(
        `${String(row.wordKey ?? "")}\u0000${String(row.sentenceKey ?? "")}`,
      );
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
  const table = await existingEntryTable(db, query.attachmentID);
  if (!table) {
    return 0;
  }
  try {
    const value = await db.valueQueryAsync<number>(
      `SELECT COUNT(*) FROM ${table}
        WHERE targetLang = ? AND promptHash = ?`,
      [query.targetLang, query.promptHash],
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

/**
 * Cache size, summed over the per-book tables.
 *
 * Each term is one query bounded by a single book, so one huge or corrupt book
 * cannot block the number the pane shows. The total is still proportional to the
 * cached text, because `SUM(LENGTH(...))` has to read the text columns — but it
 * never walks another book's rows to do it.
 */
export async function getCacheStats(): Promise<CacheStats> {
  const db = await getCacheDb();
  if (!db) {
    return { entries: 0, attachments: 0, bytes: 0 };
  }
  let entries = 0;
  let attachments = 0;
  let bytes = 0;
  for (const table of await listEntryTables(db)) {
    try {
      const row = (await db.rowQueryAsync(
        `SELECT COUNT(*) AS entries,
                COALESCE(SUM(LENGTH(translation) + LENGTH(sentence) +
                             LENGTH(word)), 0) AS bytes
           FROM ${table}`,
      )) as { entries?: number; bytes?: number } | boolean | null;
      if (!row || row === true) {
        continue;
      }
      const count = Number(row.entries) || 0;
      entries += count;
      bytes += Number(row.bytes) || 0;
      if (count > 0) {
        attachments += 1;
      }
    } catch (e) {
      // One unreadable table must not hide the size of the others.
      warn("failed to read cache stats", table, e);
    }
  }
  return { entries, attachments, bytes };
}

/**
 * Delete cached entries: one book (`DROP TABLE` + drop its job state) or every
 * book (drop all tables, then `VACUUM` once).
 *
 * Only the full wipe pays for a `VACUUM`: dropping a single table already
 * releases its pages for reuse, and rewriting a multi-hundred-megabyte file to
 * remove one book is exactly what the per-book layout avoids.
 * A failure is logged only: the user asked for a cleanup, not an error.
 */
export async function clearCache(attachmentID?: number): Promise<void> {
  const db = await getCacheDb();
  if (!db) {
    return;
  }
  try {
    if (attachmentID) {
      const table = entryTableName(attachmentID);
      if (table) {
        await dropEntryTable(db, table);
      }
      await db.queryAsync("DELETE FROM slAttachment WHERE attachmentID = ?", [
        attachmentID,
      ]);
      return;
    }
    for (const table of await listEntryTables(db)) {
      await dropEntryTable(db, table);
    }
    await db.queryAsync("DELETE FROM slAttachment");
    await db.vacuum();
  } catch (e) {
    warn("failed to clear cache", e);
  }
}
