import { describe, expect, it, vi } from "vitest";

import { pickWebApiScope, resolveWebApis } from "../src/modules/llm/runtime";

/** Build a scope object exposing only the named APIs. */
function scopeWith(apis: Array<"fetch" | "AbortController" | "TextDecoder">) {
  const scope: Record<string, unknown> = {};
  for (const api of apis) {
    if (api === "fetch") {
      scope.fetch = vi.fn(async () => ({ ok: true }));
    } else {
      scope[api] = api === "AbortController" ? AbortController : TextDecoder;
    }
  }
  return scope;
}

describe("pickWebApiScope", () => {
  it("prefers a scope that provides every API", () => {
    const fetchOnly = {
      label: "plugin sandbox",
      scope: scopeWith(["fetch"]),
    };
    const complete = {
      label: "main window",
      scope: scopeWith(["fetch", "AbortController", "TextDecoder"]),
    };

    expect(pickWebApiScope([fetchOnly, complete])).toBe(complete);
  });

  it("falls back to a scope with only fetch", () => {
    const fetchOnly = { label: "plugin sandbox", scope: scopeWith(["fetch"]) };
    expect(pickWebApiScope([fetchOnly])).toBe(fetchOnly);
  });

  it("ignores empty, missing and non-function entries", () => {
    const broken = { label: "broken", scope: { fetch: "yes" } };
    const missing = { label: "missing", scope: null };
    const complete = {
      label: "hidden DOM window",
      scope: scopeWith(["fetch", "AbortController", "TextDecoder"]),
    };

    expect(pickWebApiScope([broken, missing, complete])).toBe(complete);
    expect(pickWebApiScope([broken, missing])).toBeNull();
    expect(pickWebApiScope([])).toBeNull();
  });
});

describe("resolveWebApis", () => {
  it("calls fetch with its own scope as this", async () => {
    const calls: boolean[] = [];
    const scope: Record<string, unknown> = {
      fetch: function (this: unknown) {
        calls.push(this === scope);
        return Promise.resolve("ok");
      },
      AbortController,
      TextDecoder,
    };

    const apis = resolveWebApis([{ label: "main window", scope }]);
    expect(apis?.label).toBe("main window");
    await apis?.fetch("https://api.example.test/v1/chat/completions");

    expect(calls).toEqual([true]);
  });

  it("creates the abort controller and decoder from the same scope", () => {
    const apis = resolveWebApis([
      { label: "main window", scope: scopeWith(["fetch"]) },
      {
        label: "plugin sandbox",
        scope: scopeWith(["fetch", "AbortController", "TextDecoder"]),
      },
    ]);

    expect(apis?.label).toBe("plugin sandbox");
    expect(apis?.createAbortController()).toBeInstanceOf(AbortController);
    expect(
      apis?.createTextDecoder().decode(new TextEncoder().encode("减轻")),
    ).toBe("减轻");
  });

  it("runs without a timeout when the scope has no AbortController", () => {
    const apis = resolveWebApis([
      { label: "plugin sandbox", scope: scopeWith(["fetch"]) },
    ]);

    expect(apis?.createAbortController()).toBeNull();
    // TextDecoder is only read from the scope; the ambient one is enough here.
    expect(apis?.createTextDecoder()).toBeInstanceOf(TextDecoder);
  });

  it("returns null when no scope can fetch", () => {
    expect(resolveWebApis([{ label: "broken", scope: {} }])).toBeNull();
    expect(resolveWebApis([])).toBeNull();
  });
});
