/**
 * Result panel.
 *
 * Rendered inside the reader iframe (plain HTML + inline styles) so it does not
 * depend on XUL windows and works for both PDF and EPUB readers.
 */

import { getString } from "../../utils/locale";
import type { SelectionKind } from "../reader/selectionKind";

export interface PanelCallbacks {
  onFlipKind: (next: SelectionKind) => void;
  /** Re-translate with another prompt preset of the current kind. */
  onSelectProfile: (profileId: string) => void;
  onRetry: (userPrompt: string) => void;
  onCopy: () => void;
  onClose: () => void;
}

export interface PanelState {
  status: "loading" | "done" | "error";
  kind: SelectionKind;
  profileId?: string;
  /** Presets of the current kind; the picker only shows when there are 2+. */
  profileOptions?: { id: string; name: string }[];
  profileName?: string;
  translation?: string;
  sentence?: string;
  hasContext?: boolean;
  truncated?: boolean;
  usedFallback?: boolean;
  meta?: string;
  errorMessage?: string;
  userPrompt?: string;
}

const PANEL_ID = "sense-lingo-panel";

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

const S = {
  root: [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "width:380px",
    "max-height:70vh",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "padding:12px",
    "border-radius:8px",
    "background:#ffffff",
    "color:#1a1a1a",
    "border:1px solid #d0d0d0",
    "box-shadow:0 8px 24px rgba(0,0,0,.18)",
    "font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif",
    "z-index:2147483647",
    "text-align:left",
  ].join(";"),
  header: "display:flex;align-items:center;gap:8px;",
  badge: [
    "padding:1px 6px",
    "border-radius:4px",
    "background:#e8f0fe",
    "color:#1a56db",
    "font-size:11px",
    "font-weight:600",
    "white-space:nowrap",
  ].join(";"),
  profileName:
    "flex:1;color:#666;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
  iconBtn: [
    "border:none",
    "background:transparent",
    "cursor:pointer",
    "color:#666",
    "font-size:14px",
    "padding:0 2px",
    "line-height:1",
  ].join(";"),
  body: "overflow:auto;white-space:pre-wrap;word-break:break-word;user-select:text;",
  context: [
    "border-left:2px solid #d0d0d0",
    "padding-left:8px",
    "color:#777",
    "font-size:12px",
    "font-style:italic",
    "max-height:6em",
    "overflow:auto",
    "user-select:text",
  ].join(";"),
  meta: "color:#999;font-size:11px;",
  profileRow: "display:none;align-items:center;gap:6px;",
  profileRowLabel: "color:#666;font-size:11px;white-space:nowrap;",
  select: [
    "flex:1",
    "min-width:0",
    "border:1px solid #d0d0d0",
    "border-radius:4px",
    "background:#f7f7f7",
    "color:#333",
    "font-size:11px",
    "padding:2px 4px",
  ].join(";"),
  footer: "display:flex;gap:6px;flex-wrap:wrap;",
  btn: [
    "border:1px solid #d0d0d0",
    "border-radius:4px",
    "background:#f7f7f7",
    "color:#333",
    "cursor:pointer",
    "font-size:12px",
    "padding:3px 8px",
  ].join(";"),
  editor: [
    "width:100%",
    "box-sizing:border-box",
    "font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
    "border:1px solid #d0d0d0",
    "border-radius:4px",
    "padding:6px",
    "resize:vertical",
    "min-height:72px",
  ].join(";"),
  error: "color:#b42318;white-space:pre-wrap;",
};

export class ResultPanel {
  private readonly doc: Document;
  private root: HTMLDivElement;
  private badge: HTMLSpanElement;
  private profileLabel: HTMLSpanElement;
  private body: HTMLDivElement;
  private context: HTMLDivElement;
  private meta: HTMLDivElement;
  private profileRow: HTMLDivElement;
  private profileSelect: HTMLSelectElement;
  /** Identity of the options currently rendered, to avoid rebuilding on every delta. */
  private profileOptionsKey = "";
  private flipBtn: HTMLButtonElement;
  private retryBtn: HTMLButtonElement;
  private copyBtn: HTMLButtonElement;
  private editor: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private state: PanelState;
  private callbacks: PanelCallbacks | null = null;
  private editorOpen = false;

  constructor(doc: Document, state: PanelState) {
    this.doc = doc;
    this.state = state;

    this.root = el(doc, "div", S.root);
    this.root.id = PANEL_ID;

    const header = el(doc, "div", S.header);
    this.badge = el(doc, "span", S.badge);
    this.profileLabel = el(doc, "span", S.profileName);
    const closeBtn = el(doc, "button", S.iconBtn, "×");
    closeBtn.title = getString("panel-btn-close");
    closeBtn.addEventListener("click", () => this.callbacks?.onClose());
    header.append(this.badge, this.profileLabel, closeBtn);

    this.body = el(doc, "div", S.body);
    this.context = el(doc, "div", S.context);
    this.meta = el(doc, "div", S.meta);

    this.profileRow = el(doc, "div", S.profileRow);
    const profileRowLabel = el(
      doc,
      "span",
      S.profileRowLabel,
      getString("panel-profile-label"),
    );
    this.profileSelect = el(doc, "select", S.select);
    this.profileSelect.addEventListener("change", () => {
      this.callbacks?.onSelectProfile(this.profileSelect.value);
    });
    this.profileRow.append(profileRowLabel, this.profileSelect);

    const footer = el(doc, "div", S.footer);
    this.flipBtn = el(doc, "button", S.btn);
    this.flipBtn.addEventListener("click", () => {
      const next: SelectionKind =
        this.state.kind === "word" ? "sentence" : "word";
      this.callbacks?.onFlipKind(next);
    });
    this.retryBtn = el(
      doc,
      "button",
      S.btn,
      getString("panel-btn-edit-prompt"),
    );
    this.retryBtn.addEventListener("click", () => this.toggleEditor());
    this.copyBtn = el(doc, "button", S.btn, getString("panel-btn-copy"));
    this.copyBtn.addEventListener("click", () => this.callbacks?.onCopy());
    footer.append(this.flipBtn, this.retryBtn, this.copyBtn);

    this.editor = el(doc, "textarea", S.editor);
    this.editor.style.display = "none";
    this.sendBtn = el(doc, "button", S.btn, getString("panel-btn-retry"));
    this.sendBtn.style.display = "none";
    this.sendBtn.addEventListener("click", () => {
      if (this.callbacks) {
        this.callbacks.onRetry(this.editor.value);
      }
    });

    this.root.append(
      header,
      this.body,
      this.context,
      this.meta,
      this.profileRow,
      footer,
      this.editor,
      this.sendBtn,
    );
    this.mount();
    this.render();
  }

  private mount(): void {
    this.doc.getElementById(PANEL_ID)?.remove();
    const body = this.doc.body;
    if (body) {
      body.appendChild(this.root);
    } else {
      this.doc.documentElement.appendChild(this.root);
    }
  }

  setCallbacks(callbacks: PanelCallbacks): void {
    this.callbacks = callbacks;
  }

  setState(patch: Partial<PanelState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  getState(): PanelState {
    return this.state;
  }

  private toggleEditor(): void {
    this.editorOpen = !this.editorOpen;
    this.editor.style.display = this.editorOpen ? "block" : "none";
    this.sendBtn.style.display = this.editorOpen ? "inline-block" : "none";
    if (this.editorOpen) {
      this.editor.value = this.state.userPrompt ?? "";
      this.editor.focus();
    }
  }

  private render(): void {
    const { status, kind } = this.state;
    const isWord = kind === "word";

    this.badge.textContent = getString(
      isWord ? "panel-kind-word" : "panel-kind-sentence",
    );
    this.badge.style.background = isWord ? "#e8f0fe" : "#ecfdf3";
    this.badge.style.color = isWord ? "#1a56db" : "#027a48";

    this.profileLabel.textContent = this.state.profileName ?? "";
    this.profileLabel.title = this.state.usedFallback
      ? getString("panel-profile-fallback")
      : (this.state.profileName ?? "");

    this.flipBtn.textContent = getString(
      isWord ? "panel-btn-switch-sentence" : "panel-btn-switch-word",
    );

    if (status === "loading") {
      // Streaming fills `translation` while the request is still open; show it
      // instead of the placeholder so the text grows in place.
      const partial = this.state.translation ?? "";
      this.body.textContent = partial || getString("panel-loading");
      this.body.style.color = partial ? "#1a1a1a" : "#666";
    } else if (status === "error") {
      this.body.textContent =
        this.state.errorMessage || getString("error-generic");
      this.body.style.color = "#b42318";
    } else {
      this.body.textContent = this.state.translation ?? "";
      this.body.style.color = "#1a1a1a";
    }

    const contextText = isWord ? (this.state.sentence ?? "") : "";
    const showContextHint =
      isWord && status === "done" && !contextText && !this.state.hasContext;
    this.context.textContent =
      contextText || (showContextHint ? getString("panel-no-context") : "");
    this.context.style.display = this.context.textContent ? "block" : "none";
    this.context.style.fontStyle = showContextHint ? "normal" : "italic";

    const meta: string[] = [];
    if (this.state.meta) {
      meta.push(this.state.meta);
    }
    if (this.state.truncated) {
      meta.push(getString("panel-context-truncated"));
    }
    this.meta.textContent = meta.join(" · ");
    this.meta.style.display = meta.length ? "block" : "none";

    this.renderProfilePicker(status);

    this.copyBtn.disabled = status !== "done" || !this.state.translation;
    this.retryBtn.disabled = status === "loading";
  }

  /**
   * Sync the preset picker.
   *
   * Options are rebuilt only when the list itself changes: `render()` runs for
   * every streamed chunk, and recreating the `<select>` there would close it
   * while the user is picking another preset.
   */
  private renderProfilePicker(status: PanelState["status"]): void {
    const options = this.state.profileOptions ?? [];
    const key = options
      .map((option) => `${option.id}\u0000${option.name}`)
      .join("\u0001");
    if (key !== this.profileOptionsKey) {
      this.profileOptionsKey = key;
      this.profileSelect.textContent = "";
      for (const option of options) {
        const node = this.doc.createElement("option");
        node.value = option.id;
        node.textContent = option.name;
        this.profileSelect.appendChild(node);
      }
    }

    this.profileRow.style.display = options.length > 1 ? "flex" : "none";
    const selected = this.state.profileId;
    if (selected && this.profileSelect.value !== selected) {
      this.profileSelect.value = selected;
    }
    this.profileSelect.disabled = status === "loading";
    this.profileSelect.title = this.state.usedFallback
      ? getString("panel-profile-fallback")
      : (this.state.profileName ?? "");
  }

  destroy(): void {
    this.root.remove();
    this.callbacks = null;
  }
}

const registry = new WeakMap<Document, ResultPanel>();

/** Show (or refresh) the panel in a given reader document. */
export function showPanel(
  doc: Document,
  state: PanelState,
  callbacks: PanelCallbacks,
): ResultPanel {
  let panel = registry.get(doc);
  if (!panel) {
    panel = new ResultPanel(doc, state);
    registry.set(doc, panel);
  }
  panel.setCallbacks(callbacks);
  panel.setState(state);
  return panel;
}

export function hidePanel(doc: Document): void {
  registry.get(doc)?.destroy();
  registry.delete(doc);
}
