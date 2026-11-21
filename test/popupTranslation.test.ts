import { describe, expect, it, vi } from "vitest";

import {
  POPUP_RESULT_TTL_MS,
  peekPopupTranslation,
  translateInPopup,
} from "../src/modules/reader/popupTranslation";

// The cache only keys off the document identity, so any object works as a doc.
const makeDoc = () => ({}) as Document;

const succeeds = (translation: string) =>
  Promise.resolve({ ok: true as const, translation });

describe("translateInPopup", () => {
  it("shares one request across popup re-renders", async () => {
    const doc = makeDoc();
    const request = vi.fn(() => succeeds("减轻"));
    const first = translateInPopup(doc, "mitigate", request, 1000);
    const second = translateInPopup(doc, "mitigate", request, 1010);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ ok: true, translation: "减轻" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reuses a successful result inside the ttl window", async () => {
    const doc = makeDoc();
    const request = vi.fn(() => succeeds("减轻"));
    await translateInPopup(doc, "mitigate", request, 1000);
    await translateInPopup(
      doc,
      "mitigate",
      request,
      1000 + POPUP_RESULT_TTL_MS - 1,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("requests again after the ttl window", async () => {
    const doc = makeDoc();
    const request = vi.fn(() => succeeds("减轻"));
    await translateInPopup(doc, "mitigate", request, 1000);
    await translateInPopup(
      doc,
      "mitigate",
      request,
      1000 + POPUP_RESULT_TTL_MS,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("starts a new request when the cache key changes", async () => {
    const doc = makeDoc();
    const request = vi.fn(() => succeeds("减轻"));
    await translateInPopup(doc, "mitigate", request, 1000);
    await translateInPopup(doc, "inherent", request, 1010);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries failures instead of caching them", async () => {
    const doc = makeDoc();
    const request = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: false as const, message: "network" }),
      )
      .mockImplementationOnce(() => succeeds("减轻"));

    await expect(
      translateInPopup(doc, "mitigate", request, 1000),
    ).resolves.toEqual({ ok: false, message: "network" });
    await expect(
      translateInPopup(doc, "mitigate", request, 1001),
    ).resolves.toEqual({ ok: true, translation: "减轻" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("peekPopupTranslation", () => {
  it("returns nothing before a translation was requested", () => {
    expect(peekPopupTranslation(makeDoc(), "mitigate", 1000)).toBeUndefined();
  });

  it("returns the in-flight promise for the same key", () => {
    const doc = makeDoc();
    const promise = translateInPopup(
      doc,
      "mitigate",
      () => succeeds("减轻"),
      1000,
    );
    expect(peekPopupTranslation(doc, "mitigate", 1000)).toBe(promise);
  });

  it("ignores another key", async () => {
    const doc = makeDoc();
    await translateInPopup(doc, "mitigate", () => succeeds("减轻"), 1000);
    expect(peekPopupTranslation(doc, "inherent", 1010)).toBeUndefined();
  });

  it("ignores results older than the ttl", async () => {
    const doc = makeDoc();
    await translateInPopup(doc, "mitigate", () => succeeds("减轻"), 1000);
    expect(
      peekPopupTranslation(doc, "mitigate", 1000 + POPUP_RESULT_TTL_MS),
    ).toBeUndefined();
  });

  it("returns nothing after a failure was cleared", async () => {
    const doc = makeDoc();
    await translateInPopup(
      doc,
      "mitigate",
      () => Promise.resolve({ ok: false as const, message: "network" }),
      1000,
    );
    expect(peekPopupTranslation(doc, "mitigate", 1001)).toBeUndefined();
  });
});
