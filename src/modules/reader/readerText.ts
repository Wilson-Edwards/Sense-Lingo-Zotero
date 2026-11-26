/**
 * Text extraction from live reader documents.
 *
 * A reader document is not always the document that holds the text:
 * - PDF      -> the text layer lives in the PDF.js viewer document
 * - EPUB     -> each section is rendered inside a nested iframe (epub.js), so
 *               the outer document only contains UI chrome
 *
 * We therefore walk the frame tree and hand every candidate text back to the
 * caller, which tries them one by one against the selected text.
 */

import { sourceTextOfElement } from "./embeddedTranslation";

const MAX_DEPTH = 4;
/** Shorter texts are UI noise, not content. */
const MIN_USEFUL_LENGTH = 32;

function readDocumentText(doc: Document): string {
  try {
    const body = doc.body;
    if (!body) {
      return "";
    }
    return sourceTextOfElement(body);
  } catch {
    return "";
  }
}

function nestedDocuments(doc: Document): Document[] {
  const children: Document[] = [];
  try {
    for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
      try {
        const child = (frame as HTMLIFrameElement).contentDocument;
        if (child) {
          children.push(child);
        }
      } catch {
        // cross-origin frame, ignore
      }
    }
  } catch {
    // ignore
  }
  try {
    const win = doc.defaultView;
    if (win) {
      for (let i = 0; i < win.frames.length; i++) {
        try {
          const child = win.frames[i].document;
          if (child) {
            children.push(child);
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return children;
}

/** Reader root plus all reachable nested frame documents, breadth first. */
export function collectReaderDocuments(root: Document): Document[] {
  const results: Document[] = [];
  const visited = new Set<Document>();
  const queue: Array<{ doc: Document; depth: number }> = [
    { doc: root, depth: 0 },
  ];

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.doc)) {
      continue;
    }
    visited.add(current.doc);
    results.push(current.doc);

    if (current.depth < MAX_DEPTH) {
      for (const child of nestedDocuments(current.doc)) {
        queue.push({ doc: child, depth: current.depth + 1 });
      }
    }
  }

  return results;
}

export function collectDocumentTexts(root: Document): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const doc of collectReaderDocuments(root)) {
    const text = readDocumentText(doc);
    if (text.length >= MIN_USEFUL_LENGTH && !seen.has(text)) {
      seen.add(text);
      results.push(text);
    }
  }

  return results.sort((a, b) => b.length - a.length);
}
