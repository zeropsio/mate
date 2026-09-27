import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";
import type { MateTintId } from "@t3tools/shared/brand";
import {
  collectComposerInlineTokens,
  type ComposerInlineToken,
} from "@t3tools/shared/composerInlineTokens";

export type ComposerPromptSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "mention";
      path: string;
      source: string;
    }
  | {
      type: "skill";
      name: string;
      source: string;
    }
  | {
      type: "terminal-context";
      context: TerminalContextDraft | null;
    };

function rangeIncludesIndex(start: number, end: number, index: number): boolean {
  return start <= index && index < end;
}

function pushTextSegment(segments: ComposerPromptSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

function forEachPromptSegmentSlice(
  prompt: string,
  visitor: (
    slice:
      | {
          type: "text";
          text: string;
          promptOffset: number;
        }
      | {
          type: "terminal-context";
          promptOffset: number;
        },
  ) => boolean | void,
): boolean {
  let textCursor = 0;

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }

    if (
      index > textCursor &&
      visitor({
        type: "text",
        text: prompt.slice(textCursor, index),
        promptOffset: textCursor,
      }) === true
    ) {
      return true;
    }
    if (visitor({ type: "terminal-context", promptOffset: index }) === true) {
      return true;
    }
    textCursor = index + 1;
  }

  if (
    textCursor < prompt.length &&
    visitor({
      type: "text",
      text: prompt.slice(textCursor),
      promptOffset: textCursor,
    }) === true
  ) {
    return true;
  }

  return false;
}

function forEachPromptTextSlice(
  prompt: string,
  visitor: (text: string, promptOffset: number) => boolean | void,
): boolean {
  return forEachPromptSegmentSlice(prompt, (slice) => {
    if (slice.type !== "text") {
      return false;
    }
    return visitor(slice.text, slice.promptOffset);
  });
}

function forEachMentionMatch(
  prompt: string,
  visitor: (
    match: Extract<ComposerInlineToken, { type: "mention" }>,
    promptOffset: number,
  ) => boolean | void,
): boolean {
  return forEachPromptTextSlice(prompt, (text, promptOffset) => {
    for (const match of collectComposerInlineTokens(text)) {
      if (match.type !== "mention") {
        continue;
      }
      if (visitor(match, promptOffset) === true) {
        return true;
      }
    }
    return false;
  });
}

function splitPromptTextIntoComposerSegments(text: string): ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = [];
  if (!text) {
    return segments;
  }

  const tokenMatches = collectComposerInlineTokens(text);
  let cursor = 0;
  for (const match of tokenMatches) {
    if (match.start < cursor) {
      continue;
    }

    if (match.start > cursor) {
      pushTextSegment(segments, text.slice(cursor, match.start));
    }

    if (match.type === "mention") {
      segments.push({
        type: "mention",
        path: match.value,
        source: match.source,
      });
    } else {
      segments.push({ type: "skill", name: match.value, source: match.source });
    }

    cursor = match.end;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function selectionTouchesMentionBoundary(
  prompt: string,
  start: number,
  end: number,
): boolean {
  if (!prompt || start >= end) {
    return false;
  }

  return forEachMentionMatch(prompt, (match, promptOffset) => {
    const mentionStart = promptOffset + match.start;
    const mentionEnd = promptOffset + match.end;
    const beforeMentionIndex = mentionStart - 1;
    const afterMentionIndex = mentionEnd;

    if (
      beforeMentionIndex >= 0 &&
      /\s/.test(prompt[beforeMentionIndex] ?? "") &&
      rangeIncludesIndex(start, end, beforeMentionIndex)
    ) {
      return true;
    }

    if (
      afterMentionIndex < prompt.length &&
      /\s/.test(prompt[afterMentionIndex] ?? "") &&
      rangeIncludesIndex(start, end, afterMentionIndex)
    ) {
      return true;
    }
    return false;
  });
}

export function splitPromptIntoComposerSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft> = [],
): ComposerPromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: ComposerPromptSegment[] = [];
  let terminalContextIndex = 0;
  forEachPromptSegmentSlice(prompt, (slice) => {
    if (slice.type === "text") {
      segments.push(...splitPromptTextIntoComposerSegments(slice.text));
      return false;
    }

    segments.push({
      type: "terminal-context",
      context: terminalContexts[terminalContextIndex] ?? null,
    });
    terminalContextIndex += 1;
    return false;
  });

  return segments;
}

/** A crewmate's `@handle`, drawn as that crewmate where the composer offers crewmates. */
export interface ComposerCrewmateSegment {
  readonly type: "crewmate";
  readonly handle: string;
  readonly tint: MateTintId;
  readonly source: string;
}

export type ComposerEditorSegment = ComposerPromptSegment | ComposerCrewmateSegment;

/**
 * What the editor draws: the prompt's segments, a mention written exactly as
 * `@handle` of a crewmate the composer offers (the lead's chat, PRD §5.3)
 * drawn as that crewmate, every other mention a file's as ever. Only the
 * drawing differs: the text — and so every cursor offset the composer counts
 * on the prompt's own segments — stays the same.
 */
export function splitPromptIntoEditorSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft>,
  crewmates: ReadonlyArray<{ readonly handle: string; readonly tint: MateTintId }>,
): ComposerEditorSegment[] {
  const tints = new Map(crewmates.map((mate) => [mate.handle, mate.tint]));
  return splitPromptIntoComposerSegments(prompt, terminalContexts).map((segment) => {
    const tint = segment.type === "mention" ? tints.get(segment.path) : undefined;
    return segment.type === "mention" && tint !== undefined && segment.source === `@${segment.path}`
      ? { type: "crewmate", handle: segment.path, tint, source: segment.source }
      : segment;
  });
}

/** `@handle` at a word start, not part of an address, ending where a handle cannot go on. */
const CREWMATE_MENTION_REGEX = /(?<![\w@.-])@([a-z0-9-]{1,20})(?![a-z0-9-])/g;

/**
 * The crewmates a *Tell the crew* message names, as mention nodes with source
 * `crewmate` and the handle as their path (PRD §5.3): in the order typed, each
 * once, and only handles on the crew. Unlike a file mention, a crewmate mention
 * may end the message or touch punctuation ("@erik, write the plan").
 */
export function collectCrewmateMentions(
  prompt: string,
  handles: ReadonlyArray<string>,
): Array<Extract<ComposerPromptSegment, { type: "mention" }>> {
  const roster = new Set(handles);
  const seen = new Set<string>();
  const mentions: Array<Extract<ComposerPromptSegment, { type: "mention" }>> = [];
  for (const match of prompt.matchAll(CREWMATE_MENTION_REGEX)) {
    const handle = match[1] ?? "";
    if (!roster.has(handle) || seen.has(handle)) continue;
    seen.add(handle);
    mentions.push({ type: "mention", path: handle, source: "crewmate" });
  }
  return mentions;
}
