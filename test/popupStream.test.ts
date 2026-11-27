import { describe, expect, it } from "vitest";

import {
  clearPartial,
  clearDocumentStreamState,
  forEachLiveSlot,
  partialFor,
  rememberPartial,
  POPUP_STREAM_MAX_ENTRIES,
  trackSlot,
} from "../src/modules/reader/popupStream";

// State is keyed by document identity, so any object works as a doc.
const makeDoc = () => ({}) as Document;

// The module only reads `isConnected`, so a stub is enough for a slot.
const makeSlot = (isConnected = true) =>
  ({ isConnected }) as unknown as HTMLDivElement;

const KEY = "mitigate\u0000before\u0000after";

describe("popupStream", () => {
  it("replays the partial text into a re-rendered popup", () => {
    const doc = makeDoc();
    rememberPartial(doc, KEY, "减");
    rememberPartial(doc, KEY, "减轻");

    expect(trackSlot(doc, KEY, makeSlot())).toBe("减轻");
    expect(partialFor(doc, KEY)).toBe("减轻");
  });

  it("renders every chunk into all mounted slots", () => {
    const doc = makeDoc();
    const first = makeSlot();
    const second = makeSlot();
    trackSlot(doc, KEY, first);
    trackSlot(doc, KEY, second);

    rememberPartial(doc, KEY, "减轻");
    const painted: Array<HTMLDivElement> = [];
    forEachLiveSlot(doc, KEY, (slot) => painted.push(slot));

    expect(painted).toEqual([first, second]);
  });

  it("skips the slot whose popup was closed", () => {
    const doc = makeDoc();
    const open = makeSlot();
    const closed = makeSlot(false);
    trackSlot(doc, KEY, open);
    trackSlot(doc, KEY, closed);

    const painted: Array<HTMLDivElement> = [];
    forEachLiveSlot(doc, KEY, (slot) => painted.push(slot));

    expect(painted).toEqual([open]);
  });

  it("keeps selections and documents apart", () => {
    const doc = makeDoc();
    const other = makeDoc();
    rememberPartial(doc, KEY, "减轻");
    rememberPartial(doc, "another\u0000\u0000", "固有的");

    expect(partialFor(doc, "another\u0000\u0000")).toBe("固有的");
    expect(partialFor(other, KEY)).toBe("");
    expect(trackSlot(other, KEY, makeSlot())).toBe("");
  });

  it("forgets the partial text when a new request starts", () => {
    const doc = makeDoc();
    rememberPartial(doc, KEY, "减轻");
    clearPartial(doc, KEY);

    expect(trackSlot(doc, KEY, makeSlot())).toBe("");
  });

  it("does nothing for a selection it never saw", () => {
    const doc = makeDoc();
    let calls = 0;
    forEachLiveSlot(doc, KEY, () => {
      calls += 1;
    });

    expect(calls).toBe(0);
    expect(partialFor(doc, KEY)).toBe("");
  });

  it("releases all state for a destroyed reader document", () => {
    const doc = makeDoc();
    rememberPartial(doc, KEY, "减轻");
    clearDocumentStreamState(doc);
    expect(partialFor(doc, KEY)).toBe("");
  });

  it("bounds remembered selection streams per document", () => {
    const doc = makeDoc();
    for (let index = 0; index <= POPUP_STREAM_MAX_ENTRIES; index += 1) {
      rememberPartial(doc, `key-${index}`, String(index));
    }
    expect(partialFor(doc, "key-0")).toBe("");
    expect(partialFor(doc, `key-${POPUP_STREAM_MAX_ENTRIES}`)).toBe(
      String(POPUP_STREAM_MAX_ENTRIES),
    );
  });
});
