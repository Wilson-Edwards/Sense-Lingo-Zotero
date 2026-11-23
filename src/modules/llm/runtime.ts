/**
 * Where the HTTP plumbing comes from.
 *
 * Zotero does not expose `fetch` / `AbortController` / `TextDecoder` in the
 * same way in every scope. The plugin sandbox has a `fetch`, but its
 * `Response` can come back without a readable body (and it has no
 * `AbortController` at all), which silently turns streaming into one buffered
 * answer that appears only when the whole translation is done. A real window
 * owns a streaming `fetch`, so the client prefers that scope.
 *
 * All three APIs are taken from the *same* scope: an `AbortSignal` created in
 * one realm is rejected by a `fetch` that belongs to another.
 */

export interface WebApiScope {
  fetch?: unknown;
  AbortController?: unknown;
  TextDecoder?: unknown;
}

export interface WebApiCandidate {
  label: string;
  /**
   * The scope object itself, not a copy: `fetch` has to be called with its own
   * scope as `this`, otherwise Gecko throws "Illegal invocation".
   */
  scope?: WebApiScope | null;
}

export interface ResolvedWebApis {
  /** Which scope was picked, for the debug log. */
  label: string;
  fetch: typeof fetch;
  createAbortController: () => AbortController | null;
  createTextDecoder: () => TextDecoder;
}

const REQUIRED_APIS = ["fetch", "AbortController", "TextDecoder"] as const;

function hasApi(scope: WebApiScope | null | undefined, name: string): boolean {
  return (
    typeof (scope as Record<string, unknown> | null | undefined)?.[name] ===
    "function"
  );
}

/**
 * Pick the scope that can run one streaming request.
 *
 * A scope providing every API wins, because mixing realms breaks the abort
 * signal. A scope with only `fetch` is still usable — the request then simply
 * runs without a timeout, as it did inside the sandbox.
 */
export function pickWebApiScope(
  candidates: readonly WebApiCandidate[],
): WebApiCandidate | null {
  const usable = candidates.filter((candidate) =>
    hasApi(candidate.scope, "fetch"),
  );
  return (
    usable.find((candidate) =>
      REQUIRED_APIS.every((api) => hasApi(candidate.scope, api)),
    ) ??
    usable[0] ??
    null
  );
}

/** Read a scope without letting a missing/unavailable one abort the lookup. */
function candidate(label: string, read: () => unknown): WebApiCandidate {
  try {
    return { label, scope: (read() as WebApiScope) ?? null };
  } catch {
    // `Services.appShell.hiddenDOMWindow` throws on platforms without one, and
    // `Zotero.getMainWindow()` is null while the app is still starting up.
    return { label, scope: null };
  }
}

/**
 * Candidate scopes, best first. The plugin sandbox comes last: it is always
 * present, but it exposes no `AbortController` and its `Response` is not
 * readable as a stream on every build.
 */
export function zoteroWebApiCandidates(): WebApiCandidate[] {
  return [
    candidate("main window", () => Zotero.getMainWindow()),
    candidate(
      "hidden DOM window",
      () =>
        (Services as unknown as { appShell?: { hiddenDOMWindow?: unknown } })
          ?.appShell?.hiddenDOMWindow,
    ),
    candidate("zotero global", () => {
      const utils = (
        Components as unknown as {
          utils?: { getGlobalForObject?: (obj: unknown) => unknown };
        }
      )?.utils;
      return utils?.getGlobalForObject?.(Zotero);
    }),
    candidate("plugin sandbox", () => globalThis),
  ];
}

/** Resolve fetch / AbortController / TextDecoder from one scope. */
export function resolveWebApis(
  candidates: readonly WebApiCandidate[] = zoteroWebApiCandidates(),
): ResolvedWebApis | null {
  const chosen = pickWebApiScope(candidates);
  const scope = chosen?.scope;
  if (!chosen || !scope) {
    return null;
  }
  const fetchImpl = scope.fetch as typeof fetch;
  const AbortControllerCtor = scope.AbortController as
    (new () => AbortController) | undefined;
  const TextDecoderCtor = scope.TextDecoder as
    (new (label?: string) => TextDecoder) | undefined;
  return {
    label: chosen.label,
    fetch: (input, init) => fetchImpl.call(scope, input, init),
    createAbortController: () =>
      typeof AbortControllerCtor === "function"
        ? new AbortControllerCtor()
        : null,
    createTextDecoder: () =>
      typeof TextDecoderCtor === "function"
        ? new TextDecoderCtor("utf-8")
        : new TextDecoder(),
  };
}
