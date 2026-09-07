import { type ThreadId } from "@t3tools/contracts";

/**
 * `kind` absent means a terminal selection — the original shape, where the
 * label and the wire block both carry a line range. A `"data"` context comes
 * from the Data panel or an `@` mention in a Zerops project thread: it has no
 * meaningful line range anywhere the user can see, and `token` is the mention
 * (`db.public.orders`) its inline chip materializes into.
 */
export interface TerminalContextSelection {
  terminalId: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  kind?: TerminalContextKind;
  token?: string;
}

export type TerminalContextKind = "terminal" | "data";

function isDataContext(selection: { kind?: TerminalContextKind }): boolean {
  return selection.kind === "data";
}

export interface TerminalContextDraft extends TerminalContextSelection {
  id: string;
  threadId: ThreadId;
  createdAt: string;
}

export interface ExtractedTerminalContexts {
  promptText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedTerminalContextEntry[];
}

export interface DisplayedUserMessageState {
  visibleText: string;
  copyText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedTerminalContextEntry[];
}

export interface ParsedTerminalContextEntry {
  header: string;
  body: string;
  kind: TerminalContextKind;
  /** A data context's mention (`db.public.orders`), read back off its block header. */
  token?: string;
}

export const INLINE_TERMINAL_CONTEXT_PLACEHOLDER = "\uFFFC";

const TRAILING_CONTEXT_BLOCK_PATTERN =
  /\n*<(terminal|data)_context>\n([\s\S]*?)\n<\/\1_context>\s*$/;

export function normalizeTerminalContextText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function hasTerminalContextText(context: { text: string }): boolean {
  return normalizeTerminalContextText(context.text).length > 0;
}

export function isTerminalContextExpired(context: { text: string }): boolean {
  return !hasTerminalContextText(context);
}

export function filterTerminalContextsWithText<T extends { text: string }>(
  contexts: ReadonlyArray<T>,
): T[] {
  return contexts.filter((context) => hasTerminalContextText(context));
}

function previewTerminalContextText(text: string): string {
  const normalized = normalizeTerminalContextText(text);
  if (normalized.length === 0) {
    return "";
  }
  const lines = normalized.split("\n");
  const visibleLines = lines.slice(0, 3);
  if (lines.length > 3) {
    visibleLines.push("...");
  }
  const preview = visibleLines.join("\n");
  return preview.length > 180 ? `${preview.slice(0, 177)}...` : preview;
}

export function normalizeTerminalContextSelection(
  selection: TerminalContextSelection,
): TerminalContextSelection | null {
  const text = normalizeTerminalContextText(selection.text);
  const terminalId = selection.terminalId.trim();
  const terminalLabel = selection.terminalLabel.trim();
  if (text.length === 0 || terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(selection.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(selection.lineEnd));
  const token = selection.token?.trim() ?? "";
  return {
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text,
    ...(selection.kind !== undefined ? { kind: selection.kind } : {}),
    ...(token.length > 0 ? { token } : {}),
  };
}

export function formatTerminalContextRange(selection: {
  lineStart: number;
  lineEnd: number;
}): string {
  return selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}-${selection.lineEnd}`;
}

export function formatTerminalContextLabel(selection: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  kind?: TerminalContextKind;
}): string {
  if (isDataContext(selection)) {
    return selection.terminalLabel;
  }
  return `${selection.terminalLabel} ${formatTerminalContextRange(selection)}`;
}

export function formatInlineTerminalContextLabel(selection: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  kind?: TerminalContextKind;
  token?: string;
}): string {
  const terminalLabel = selection.terminalLabel.trim().toLowerCase().replace(/\s+/g, "-");
  if (isDataContext(selection)) {
    const token = selection.token?.trim() ?? "";
    return `@${token.length > 0 ? token : terminalLabel}`;
  }
  const range =
    selection.lineStart === selection.lineEnd
      ? `${selection.lineStart}`
      : `${selection.lineStart}-${selection.lineEnd}`;
  return `@${terminalLabel}:${range}`;
}

export function buildTerminalContextPreviewTitle(
  contexts: ReadonlyArray<TerminalContextSelection>,
): string | null {
  if (contexts.length === 0) {
    return null;
  }
  const previewParts: string[] = [];
  for (const context of contexts) {
    const normalized = normalizeTerminalContextSelection(context);
    if (!normalized) continue;
    const preview = previewTerminalContextText(normalized.text);
    previewParts.push(
      preview.length > 0
        ? `${formatTerminalContextLabel(normalized)}\n${preview}`
        : formatTerminalContextLabel(normalized),
    );
  }
  const previews = previewParts.join("\n\n");
  return previews.length > 0 ? previews : null;
}

function buildTerminalContextBodyLines(selection: TerminalContextSelection): string[] {
  const lines = normalizeTerminalContextText(selection.text).split("\n");
  if (isDataContext(selection)) {
    return lines.map((line) => `  ${line}`);
  }
  return lines.map((line, index) => `  ${selection.lineStart + index} | ${line}`);
}

export function buildTerminalContextBlock(
  contexts: ReadonlyArray<TerminalContextSelection>,
): string {
  const normalizedContexts: TerminalContextSelection[] = [];
  for (const context of contexts) {
    const normalized = normalizeTerminalContextSelection(context);
    if (normalized !== null) {
      normalizedContexts.push(normalized);
    }
  }
  if (normalizedContexts.length === 0) {
    return "";
  }
  const blocks: string[] = [];
  for (const [tag, contexts] of [
    ["terminal", normalizedContexts.filter((context) => !isDataContext(context))],
    ["data", normalizedContexts.filter((context) => isDataContext(context))],
  ] as const) {
    if (contexts.length === 0) continue;
    const lines: string[] = [];
    for (let index = 0; index < contexts.length; index += 1) {
      const context = contexts[index]!;
      const token = isDataContext(context) ? (context.token ?? "") : "";
      lines.push(
        `- ${formatTerminalContextLabel(context)}${token.length > 0 ? ` (@${token})` : ""}:`,
      );
      lines.push(...buildTerminalContextBodyLines(context));
      if (index < contexts.length - 1) {
        lines.push("");
      }
    }
    blocks.push([`<${tag}_context>`, ...lines, `</${tag}_context>`].join("\n"));
  }
  return blocks.join("\n\n");
}

export function materializeInlineTerminalContextPrompt(
  prompt: string,
  contexts: ReadonlyArray<{
    terminalLabel: string;
    lineStart: number;
    lineEnd: number;
    kind?: TerminalContextKind;
    token?: string;
  }>,
): string {
  let nextContextIndex = 0;
  let result = "";

  for (const char of prompt) {
    if (char !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      result += char;
      continue;
    }
    const context = contexts[nextContextIndex] ?? null;
    nextContextIndex += 1;
    if (!context) {
      continue;
    }
    result += formatInlineTerminalContextLabel(context);
  }

  return result;
}

export function appendTerminalContextsToPrompt(
  prompt: string,
  contexts: ReadonlyArray<TerminalContextSelection>,
): string {
  const trimmedPrompt = materializeInlineTerminalContextPrompt(prompt, contexts).trim();
  const contextBlock = buildTerminalContextBlock(contexts);
  if (contextBlock.length === 0) {
    return trimmedPrompt;
  }
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${contextBlock}` : contextBlock;
}

export function extractTrailingTerminalContexts(prompt: string): ExtractedTerminalContexts {
  let remainder = prompt;
  const groups: ParsedTerminalContextEntry[][] = [];
  for (;;) {
    const match = TRAILING_CONTEXT_BLOCK_PATTERN.exec(remainder);
    if (!match) break;
    groups.unshift(
      parseTerminalContextEntries(match[2] ?? "", match[1] === "data" ? "data" : "terminal"),
    );
    remainder = remainder.slice(0, match.index);
  }
  if (groups.length === 0) {
    return {
      promptText: prompt,
      contextCount: 0,
      previewTitle: null,
      contexts: [],
    };
  }
  const promptText = remainder.replace(/\n+$/, "");
  const parsedContexts = groups.flat();
  return {
    promptText,
    contextCount: parsedContexts.length,
    previewTitle:
      parsedContexts.length > 0
        ? parsedContexts
            .map(({ header, body }) => (body.length > 0 ? `${header}\n${body}` : header))
            .join("\n\n")
        : null,
    contexts: parsedContexts,
  };
}

export function deriveDisplayedUserMessageState(prompt: string): DisplayedUserMessageState {
  const extractedTerminal = extractTrailingTerminalContexts(prompt);
  return {
    visibleText: extractedTerminal.promptText,
    copyText: prompt,
    contextCount: extractedTerminal.contextCount,
    previewTitle: extractedTerminal.previewTitle,
    contexts: extractedTerminal.contexts,
  };
}

const DATA_CONTEXT_HEADER_TOKEN_PATTERN = /^(.*?)\s+\(@([^\s()]+)\)$/;

function parseTerminalContextEntries(
  block: string,
  kind: TerminalContextKind,
): ParsedTerminalContextEntry[] {
  const entries: ParsedTerminalContextEntry[] = [];
  let current: { header: string; token?: string; bodyLines: string[] } | null = null;

  const commitCurrent = () => {
    if (!current) {
      return;
    }
    entries.push({
      header: current.header,
      body: current.bodyLines.join("\n").trimEnd(),
      kind,
      ...(current.token !== undefined ? { token: current.token } : {}),
    });
    current = null;
  };

  for (const rawLine of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(rawLine);
    if (headerMatch) {
      commitCurrent();
      const rawHeader = headerMatch[1]!;
      const tokenMatch = kind === "data" ? DATA_CONTEXT_HEADER_TOKEN_PATTERN.exec(rawHeader) : null;
      current = {
        header: tokenMatch ? (tokenMatch[1] ?? rawHeader) : rawHeader,
        bodyLines: [],
        ...(tokenMatch ? { token: tokenMatch[2]! } : {}),
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (rawLine.startsWith("  ")) {
      current.bodyLines.push(rawLine.slice(2));
      continue;
    }
    if (rawLine.length === 0) {
      current.bodyLines.push("");
    }
  }

  commitCurrent();
  return entries;
}

export function countInlineTerminalContextPlaceholders(prompt: string): number {
  let count = 0;
  for (const char of prompt) {
    if (char === INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      count += 1;
    }
  }
  return count;
}

export function ensureInlineTerminalContextPlaceholders(
  prompt: string,
  terminalContextCount: number,
): string {
  const missingCount = terminalContextCount - countInlineTerminalContextPlaceholders(prompt);
  if (missingCount <= 0) {
    return prompt;
  }
  return `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER.repeat(missingCount)}${prompt}`;
}

function isInlineTerminalContextBoundaryWhitespace(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\n" || char === "\t" || char === "\r";
}

export function insertInlineTerminalContextPlaceholder(
  prompt: string,
  cursorInput: number,
): { prompt: string; cursor: number; contextIndex: number } {
  const cursor = Math.max(0, Math.min(prompt.length, Math.floor(cursorInput)));
  const needsLeadingSpace = !isInlineTerminalContextBoundaryWhitespace(prompt[cursor - 1]);
  const replacement = `${needsLeadingSpace ? " " : ""}${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} `;
  const rangeEnd = prompt[cursor] === " " ? cursor + 1 : cursor;
  return {
    prompt: `${prompt.slice(0, cursor)}${replacement}${prompt.slice(rangeEnd)}`,
    cursor: cursor + replacement.length,
    contextIndex: countInlineTerminalContextPlaceholders(prompt.slice(0, cursor)),
  };
}

export function stripInlineTerminalContextPlaceholders(prompt: string): string {
  return prompt.replaceAll(INLINE_TERMINAL_CONTEXT_PLACEHOLDER, "");
}

export function removeInlineTerminalContextPlaceholder(
  prompt: string,
  contextIndex: number,
): { prompt: string; cursor: number } {
  if (contextIndex < 0) {
    return { prompt, cursor: prompt.length };
  }

  let placeholderIndex = 0;
  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }
    if (placeholderIndex === contextIndex) {
      return {
        prompt: prompt.slice(0, index) + prompt.slice(index + 1),
        cursor: index,
      };
    }
    placeholderIndex += 1;
  }

  return { prompt, cursor: prompt.length };
}
