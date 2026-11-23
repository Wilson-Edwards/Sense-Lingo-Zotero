/**
 * Variable rendering for prompt templates.
 *
 * Only plain text substitution happens here: an unknown `{token}` is left
 * untouched so LaTeX and formulas in user templates survive intact.
 */

import type { SelectionKind } from "../reader/selectionKind";
import type { SentenceContext } from "../reader/sentence";
import {
  getProfile,
  resolveProfileId,
  type PromptProfiles,
  type ResolvedProfile,
} from "./prompt";

export interface PromptVarsInput {
  kind: SelectionKind;
  text: string;
  context?: SentenceContext | null;
  /** Only meaningful for sentences: include prev/next sentence. */
  includeNeighbors?: boolean;
  sourceLang?: string;
  targetLang?: string;
  itemTitle?: string;
}

/**
 * Build the substitution table.
 *
 * `{sentence}` deliberately stays empty in `sentence` mode: the selection *is*
 * the sentence, and injecting it twice makes the model echo itself.
 */
export function buildVars(input: PromptVarsInput): Record<string, string> {
  const { kind, text, context } = input;
  const isWord = kind === "word";
  return {
    text,
    word: text,
    sentence: isWord ? (context?.sentence ?? "") : "",
    prevSentence:
      !isWord && input.includeNeighbors ? (context?.prevSentence ?? "") : "",
    nextSentence:
      !isWord && input.includeNeighbors ? (context?.nextSentence ?? "") : "",
    selectionType: kind,
    sourceLang: input.sourceLang ?? "auto",
    targetLang: input.targetLang ?? "zh-CN",
    itemTitle: input.itemTitle ?? "",
  };
}

const VAR_RE = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;

/** Replace known `{vars}` and leave everything else untouched. */
export function renderPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  if (!template) {
    return "";
  }
  return template.replace(VAR_RE, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}

export interface RenderPromptInput extends PromptVarsInput {
  profiles: PromptProfiles;
  wordProfileId?: string;
  sentenceProfileId?: string;
  /** Explicit preset for this run; wins over the per-kind default. */
  profileId?: string;
}

export interface RenderedPrompt {
  system: string;
  user: string;
  profileId: string;
  profileName: string;
  usedFallback: boolean;
  /** Vars after substitution, handy for logging without leaking the API key. */
  vars: Record<string, string>;
}

/** Route by kind, then render the profile's system/user templates. */
export function renderPromptFor(input: RenderPromptInput): RenderedPrompt {
  const profileId =
    input.profileId?.trim() ||
    resolveProfileId(input.kind, input.wordProfileId, input.sentenceProfileId);
  const resolved: ResolvedProfile = getProfile(
    input.profiles,
    profileId,
    input.kind,
  );
  const vars = buildVars(input);
  return {
    system: renderPrompt(resolved.profile.system, vars),
    user: renderPrompt(resolved.profile.user, vars),
    profileId: resolved.profileId,
    profileName: resolved.profileName,
    usedFallback: resolved.usedFallback,
    vars,
  };
}
