/**
 * Per-book table names.
 *
 * SQLite has no partitioning, so "one table per attachment" is the closest
 * thing: `slEntry_<attachmentID>`. Two properties make the extra DDL worth it:
 * deleting a book is a `DROP TABLE` (instant, no `VACUUM`, no whole-file
 * rewrite), and every query path touches a table bounded by one book instead of
 * the whole library.
 *
 * The helpers here are pure and define the only contract the rest of the cache
 * relies on: a name is derived from a validated integer, and a name parses back
 * only when it is exactly `slEntry_<positive integer>`. That is also why the
 * name can be interpolated into SQL — it can never contain anything else.
 */

export const ENTRY_TABLE_PREFIX = "slEntry_";

/**
 * Table name for one attachment, or `null` when the id is unusable.
 *
 * Callers treat `null` as "this lookup missed". The id is coerced to a safe
 * integer first, so a fractional, `NaN`, infinite, non-positive or out-of-range
 * value never produces an identifier.
 */
export function entryTableName(attachmentID: number): string | null {
  const id = Math.trunc(Number(attachmentID));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return `${ENTRY_TABLE_PREFIX}${id}`;
}

/**
 * Inverse of `entryTableName`.
 *
 * Index names (`slEntry_5_uniq`, `slEntry_5_lookup`), the legacy single
 * `slEntry` table and every other table in the file deliberately do not match,
 * so `listEntryTables` cannot pick up something it must not drop.
 */
export function attachmentIdFromTableName(name: string): number | null {
  if (!name.startsWith(ENTRY_TABLE_PREFIX)) {
    return null;
  }
  const suffix = name.slice(ENTRY_TABLE_PREFIX.length);
  // `[1-9][0-9]*` rejects "0", "01", "-3", "" and the index suffixes.
  if (!/^[1-9][0-9]*$/.test(suffix)) {
    return null;
  }
  const id = Number(suffix);
  return Number.isSafeInteger(id) ? id : null;
}
