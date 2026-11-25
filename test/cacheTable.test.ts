import { describe, expect, it } from "vitest";

import {
  attachmentIdFromTableName,
  entryTableName,
} from "../src/modules/cache/table";

describe("entryTableName", () => {
  it("derives one table per attachment", () => {
    expect(entryTableName(1)).toBe("slEntry_1");
    expect(entryTableName(123456)).toBe("slEntry_123456");
  });

  it("truncates a fractional id instead of emitting an identifier", () => {
    expect(entryTableName(42.9)).toBe("slEntry_42");
  });

  it("refuses ids that cannot scope a table", () => {
    expect(entryTableName(0)).toBeNull();
    expect(entryTableName(-7)).toBeNull();
    expect(entryTableName(Number.NaN)).toBeNull();
    expect(entryTableName(Number.POSITIVE_INFINITY)).toBeNull();
    expect(entryTableName(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });

  it("never turns a hostile id into a table name", () => {
    expect(entryTableName(Number("1; DROP TABLE slAttachment"))).toBeNull();
    expect(entryTableName(Number("1 OR 1=1"))).toBeNull();
  });
});

describe("attachmentIdFromTableName", () => {
  it("parses back what entryTableName produced", () => {
    expect(attachmentIdFromTableName("slEntry_1")).toBe(1);
    expect(attachmentIdFromTableName("slEntry_987654")).toBe(987654);
  });

  it("ignores index names, the legacy table and other tables", () => {
    expect(attachmentIdFromTableName("slEntry_5_uniq")).toBeNull();
    expect(attachmentIdFromTableName("slEntry_5_lookup")).toBeNull();
    expect(attachmentIdFromTableName("slEntry")).toBeNull();
    expect(attachmentIdFromTableName("slAttachment")).toBeNull();
    expect(attachmentIdFromTableName("slMeta")).toBeNull();
  });

  it("rejects zero-padded, signed and empty suffixes", () => {
    expect(attachmentIdFromTableName("slEntry_0")).toBeNull();
    expect(attachmentIdFromTableName("slEntry_01")).toBeNull();
    expect(attachmentIdFromTableName("slEntry_-3")).toBeNull();
    expect(attachmentIdFromTableName("slEntry_")).toBeNull();
    expect(attachmentIdFromTableName("slEntry_1x")).toBeNull();
  });
});
