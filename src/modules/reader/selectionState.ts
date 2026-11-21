/** Remembers the latest selection (text + DOM anchor) per reader document. */

import type { SelectionAnchor } from "./selectionAnchor";

export interface SelectionRecord {
  text: string;
  anchor?: SelectionAnchor;
}

const selections = new WeakMap<Document, SelectionRecord>();

export function rememberSelection(
  doc: Document,
  text: string,
  anchor?: SelectionAnchor,
): void {
  selections.set(doc, { text, anchor });
}

export function getLastSelection(doc: Document): SelectionRecord | undefined {
  return selections.get(doc);
}
