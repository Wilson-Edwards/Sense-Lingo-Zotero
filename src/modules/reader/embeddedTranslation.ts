/**
 * Translation nodes persisted by browser/reader translation extensions.
 *
 * Some EPUB files contain these nodes in the archive itself. They are not
 * source text and must not participate in sentence keys or context lookup.
 */
export const EMBEDDED_TRANSLATION_SELECTOR = [
  ".immersive-translate-target-wrapper",
  "[data-immersive-translate-translation-element-mark]",
].join(",");

/** Remove embedded translation subtrees from a parsed EPUB/document clone. */
export function removeEmbeddedTranslations(root: ParentNode): void {
  try {
    for (const translated of Array.from(
      root.querySelectorAll(EMBEDDED_TRANSLATION_SELECTOR),
    )) {
      translated.remove();
    }
  } catch {
    // A disappearing reader document must not make text extraction fail.
  }
}

/**
 * Read an element without persisted translation nodes, without mutating the
 * live reader DOM. This is primarily used for captured paragraph context.
 */
export function sourceTextOfElement(element: Element): string {
  try {
    const clone = element.cloneNode(true) as Element;
    removeEmbeddedTranslations(clone);
    return ((clone as HTMLElement).innerText || clone.textContent || "").trim();
  } catch {
    return "";
  }
}
