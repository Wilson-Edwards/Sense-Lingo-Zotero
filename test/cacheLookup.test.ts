import { describe, expect, it } from "vitest";

import { sentenceKey } from "../src/modules/cache/keys";
import {
  pickBestCandidate,
  scoreCandidate,
  type Candidate,
} from "../src/modules/cache/lookup";
import type { CacheEntryRow } from "../src/modules/cache/db";

function row(overrides: Partial<CacheEntryRow> = {}): CacheEntryRow {
  return {
    wordKey: "proposed",
    word: "proposed",
    sentenceKey: "stale",
    sentence: "The proposed method works.",
    translation: "提出的（adj.）\n美式音标：/x/\n英式音标：/x/",
    model: "test",
    source: "preprocess",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const STRICT = { strict: true, singleCandidateFallback: false };

describe("scoreCandidate", () => {
  const live = "The proposed method works.";

  it("scores an identical sentence key as 1", () => {
    const stored = { sentence: live, sentenceKey: sentenceKey(live) };
    expect(scoreCandidate(stored, live)).toBe(1);
  });

  it("scores a normalized-equal sentence as 0.99", () => {
    const stored = {
      sentence: "The  proposed method works.",
      sentenceKey: "stale",
    };
    expect(scoreCandidate(stored, live)).toBe(0.99);
  });

  it("scores a whitespace-only difference as 0.95", () => {
    const stored = {
      sentence: "The pro posed method works.",
      sentenceKey: "x",
    };
    expect(scoreCandidate(stored, "The proposed method works.")).toBe(0.95);
  });

  it("scores a containing sentence as 0.9", () => {
    const stored = {
      sentence: "The proposed method works. It is fast.",
      sentenceKey: "x",
    };
    expect(scoreCandidate(stored, live)).toBe(0.9);
  });

  it("scores a long shared prefix/suffix as 0.85", () => {
    const stored = {
      sentence: "The proposed method works in practice.",
      sentenceKey: "x",
    };
    expect(scoreCandidate(stored, "The proposed method works in theory.")).toBe(
      0.85,
    );
  });

  it("scores unrelated text as 0", () => {
    expect(scoreCandidate(row(), "A completely different sentence.")).toBe(0);
  });
});

describe("pickBestCandidate", () => {
  const live = "The proposed method works.";

  it("returns the exact match", () => {
    const hit = pickBestCandidate(
      [row({ sentence: live, sentenceKey: sentenceKey(live) })],
      live,
      STRICT,
    );
    expect(hit?.score).toBe(1);
  });

  it("picks the highest score", () => {
    const hit: Candidate | null = pickBestCandidate(
      [
        row({ sentence: "Another one.", sentenceKey: "a" }),
        row({ sentence: live, sentenceKey: sentenceKey(live) }),
        row({ sentence: "The pro posed method works.", sentenceKey: "b" }),
      ],
      live,
      STRICT,
    );
    expect(hit?.sentence).toBe(live);
  });

  it("returns null below the strict threshold", () => {
    expect(
      pickBestCandidate(
        [row({ sentence: "The proposed method works in practice." })],
        "The proposed method works in theory.",
        STRICT,
      ),
    ).toBeNull();
  });

  it("accepts a weak match when strict is off", () => {
    const hit = pickBestCandidate(
      [row({ sentence: "The proposed method works in practice." })],
      "The proposed method works in theory.",
      { strict: false, singleCandidateFallback: false },
    );
    expect(hit?.score).toBe(0.85);
  });

  it("uses the only row only when the fallback is enabled", () => {
    const rows = [row({ sentence: "Unrelated text." })];
    expect(pickBestCandidate(rows, live, STRICT)).toBeNull();
    expect(
      pickBestCandidate(rows, live, {
        strict: true,
        singleCandidateFallback: true,
      }),
    ).not.toBeNull();
  });

  it("returns null without candidates", () => {
    expect(pickBestCandidate([], live, STRICT)).toBeNull();
  });
});
