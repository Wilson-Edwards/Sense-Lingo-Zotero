import { config } from "../package.json";
import Addon from "./addon";

const zoteroGlobal = Zotero as unknown as Record<string, unknown>;

// The bundle may be re-evaluated (hot reload / re-enable). Reuse the existing
// instance when present, otherwise create one and expose it as the sandbox
// global `addon`.
const existing = zoteroGlobal[config.addonInstance] as Addon | undefined;
if (existing) {
  _globalThis.addon = existing;
} else {
  const instance = new Addon();
  _globalThis.addon = instance;
  zoteroGlobal[config.addonInstance] = instance;
}
