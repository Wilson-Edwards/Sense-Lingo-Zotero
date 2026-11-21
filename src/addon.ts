import { config } from "../package.json";
import hooks from "./hooks";
import type { ResultPanel } from "./modules/ui/resultPanel";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    /** Set by the bundler through `define: { __env__ }`. */
    env: "development" | "production";
    initialized?: boolean;
    /** Cleanup callbacks collected during startup. */
    disposers: Array<() => void>;
    /** Panels alive per reader document (diagnostics only). */
    lastPanel?: ResultPanel;
    prefsWindow?: Window;
  };

  public hooks: typeof hooks;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      disposers: [],
    };
    this.hooks = hooks;
  }
}

export default Addon;
