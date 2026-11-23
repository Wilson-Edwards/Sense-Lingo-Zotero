/**
 * Live translation slots for Zotero's native selection popup.
 *
 * Zotero can render the selection popup more than once for the same selection
 * (annotation creation, page re-render, EPUB section switch), and every render
 * builds fresh DOM. A stream that keeps writing into the node from the first
 * render therefore becomes invisible: the newest popup shows the loading
 * placeholder and then the finished translation appears in one jump, which
 * looks exactly like streaming is off.
 *
 * Remembering every slot that belongs to a selection fixes that: the newest
 * popup shows the text produced so far as soon as it is rendered, and every
 * later chunk is written into all slots that are still in the DOM.
 *
 * A slot is only ever read through `isConnected`, so a minimal stub is enough
 * in unit tests.
 */

interface StreamState {
  /** Translation assembled so far; replayed into a re-rendered popup. */
  partial: string;
  slots: Set<HTMLDivElement>;
}

const states = new WeakMap<Document, Map<string, StreamState>>();

function byKey(doc: Document): Map<string, StreamState> {
  let map = states.get(doc);
  if (!map) {
    map = new Map();
    states.set(doc, map);
  }
  return map;
}

function stateFor(doc: Document, key: string): StreamState {
  const map = byKey(doc);
  let state = map.get(key);
  if (!state) {
    state = { partial: "", slots: new Set() };
    map.set(key, state);
  }
  return state;
}

/**
 * Register a freshly rendered slot.
 * @returns the translation the stream has produced so far, if any.
 */
export function trackSlot(
  doc: Document,
  key: string,
  slot: HTMLDivElement,
): string {
  const state = stateFor(doc, key);
  state.slots.add(slot);
  return state.partial;
}

/** Store the text assembled so far so a later render can replay it. */
export function rememberPartial(
  doc: Document,
  key: string,
  partial: string,
): void {
  stateFor(doc, key).partial = partial;
}

/** Current partial translation for a selection; `""` before the first chunk. */
export function partialFor(doc: Document, key: string): string {
  return states.get(doc)?.get(key)?.partial ?? "";
}

/** Forget the partial text when a fresh request replaces the old one. */
export function clearPartial(doc: Document, key: string): void {
  const state = states.get(doc)?.get(key);
  if (state) {
    state.partial = "";
  }
}

/**
 * Run `render` for every slot of this selection that is still mounted, and
 * drop the ones the popup already closed.
 */
export function forEachLiveSlot(
  doc: Document,
  key: string,
  render: (slot: HTMLDivElement) => void,
): void {
  const state = states.get(doc)?.get(key);
  if (!state) {
    return;
  }
  for (const slot of state.slots) {
    if (!slot.isConnected) {
      state.slots.delete(slot);
      continue;
    }
    render(slot);
  }
}
