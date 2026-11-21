import { describe, expect, it } from "vitest";

import {
  AUTO_TRANSLATE_DEDUP_MS,
  shouldStartAutoTranslate,
} from "../src/modules/reader/autoTranslate";

// The guard only keys off the document identity, so any object works as a doc.
const makeDoc = () => ({}) as Document;

describe("shouldStartAutoTranslate", () => {
  it("starts for the first selection", () => {
    const doc = makeDoc();
    expect(shouldStartAutoTranslate(doc, "mitigate", 1000)).toBe(true);
  });

  it("ignores a re-render of the same selection", () => {
    const doc = makeDoc();
    shouldStartAutoTranslate(doc, "mitigate", 1000);
    expect(
      shouldStartAutoTranslate(
        doc,
        "mitigate",
        1000 + AUTO_TRANSLATE_DEDUP_MS - 1,
      ),
    ).toBe(false);
  });

  it("starts again once the dedup window has passed", () => {
    const doc = makeDoc();
    shouldStartAutoTranslate(doc, "mitigate", 1000);
    expect(
      shouldStartAutoTranslate(doc, "mitigate", 1000 + AUTO_TRANSLATE_DEDUP_MS),
    ).toBe(true);
  });

  it("starts immediately for a different selection", () => {
    const doc = makeDoc();
    shouldStartAutoTranslate(doc, "mitigate", 1000);
    expect(shouldStartAutoTranslate(doc, "inherent", 1010)).toBe(true);
  });

  it("keeps documents independent", () => {
    const first = makeDoc();
    const second = makeDoc();
    shouldStartAutoTranslate(first, "mitigate", 1000);
    expect(shouldStartAutoTranslate(second, "mitigate", 1000)).toBe(true);
  });
});
