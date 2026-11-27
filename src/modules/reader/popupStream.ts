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
  updatedAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const states = new WeakMap<Document, Map<string, StreamState>>();
const lifecycleAttached = new WeakSet<Document>();
export const POPUP_STREAM_TTL_MS = 60_000;
export const POPUP_STREAM_MAX_ENTRIES = 20;

function prune(map: Map<string, StreamState>, now = Date.now()): void {
  for (const [key, state] of map) {
    if (now - state.updatedAt >= POPUP_STREAM_TTL_MS) {
      if (state.cleanupTimer) {
        clearTimeout(state.cleanupTimer);
      }
      map.delete(key);
    }
  }
  while (map.size > POPUP_STREAM_MAX_ENTRIES) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    const state = map.get(oldest);
    if (state?.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
    }
    map.delete(oldest);
  }
}

function byKey(doc: Document): Map<string, StreamState> {
  let map = states.get(doc);
  if (!map) {
    map = new Map();
    states.set(doc, map);
    if (!lifecycleAttached.has(doc)) {
      lifecycleAttached.add(doc);
      doc.defaultView?.addEventListener(
        "pagehide",
        () => clearDocumentStreamState(doc),
        { once: true },
      );
    }
  }
  prune(map);
  return map;
}

function stateFor(doc: Document, key: string): StreamState {
  const map = byKey(doc);
  let state = map.get(key);
  if (!state) {
    state = { partial: "", slots: new Set(), updatedAt: Date.now() };
    map.set(key, state);
  }
  state.updatedAt = Date.now();
  map.delete(key);
  map.set(key, state);
  prune(map);
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

/** Keep a completed result briefly for popup re-renders, then release it. */
export function finishStream(doc: Document, key: string): void {
  const state = states.get(doc)?.get(key);
  if (!state) {
    return;
  }
  if (state.cleanupTimer) {
    clearTimeout(state.cleanupTimer);
  }
  state.updatedAt = Date.now();
  state.cleanupTimer = setTimeout(() => {
    const map = states.get(doc);
    if (map?.get(key) === state) {
      map.delete(key);
    }
  }, POPUP_STREAM_TTL_MS);
}

/** Release every slot/partial when its reader document is destroyed. */
export function clearDocumentStreamState(doc: Document): void {
  const map = states.get(doc);
  if (map) {
    for (const state of map.values()) {
      if (state.cleanupTimer) {
        clearTimeout(state.cleanupTimer);
      }
      state.slots.clear();
    }
  }
  states.delete(doc);
  lifecycleAttached.delete(doc);
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
