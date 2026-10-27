import {
  formatInlineTerminalContextLabel as formatInlineTerminalContextSelectionLabel,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";

/** The parts of a parsed context entry an inline label is built from. */
type InlineLabelSource = Pick<ParsedTerminalContextEntry, "header"> &
  Partial<Pick<ParsedTerminalContextEntry, "kind" | "token">>;

const TERMINAL_CONTEXT_HEADER_PATTERN = /^(.*?)\s+line(?:s)?\s+(\d+)(?:-(\d+))?$/i;

export function buildInlineTerminalContextText(contexts: ReadonlyArray<InlineLabelSource>): string {
  const labels: Array<string> = [];
  for (const context of contexts) {
    if (context.header.trim().length > 0) {
      labels.push(formatInlineTerminalContextLabel(context));
    }
  }
  return labels.join(" ");
}

export function formatInlineTerminalContextLabel(context: InlineLabelSource): string {
  const trimmedHeader = context.header.trim();
  if (context.kind === "data") {
    return formatInlineTerminalContextSelectionLabel({
      kind: "data",
      terminalLabel: trimmedHeader,
      lineStart: 1,
      lineEnd: 1,
      ...(context.token !== undefined ? { token: context.token } : {}),
    });
  }
  const match = TERMINAL_CONTEXT_HEADER_PATTERN.exec(trimmedHeader);
  if (!match) {
    return `@${trimmedHeader.toLowerCase().replace(/\s+/g, "-")}`;
  }

  const lineStart = Number.parseInt(match[2] ?? "", 10);
  const lineEnd = Number.parseInt(match[3] ?? match[2] ?? "", 10);
  if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) {
    return `@${trimmedHeader.toLowerCase().replace(/\s+/g, "-")}`;
  }

  return formatInlineTerminalContextSelectionLabel({
    terminalLabel: match[1]?.trim() || "terminal",
    lineStart,
    lineEnd,
  });
}

export function textContainsInlineTerminalContextLabels(
  text: string,
  contexts: ReadonlyArray<InlineLabelSource>,
): boolean {
  let searchStartIndex = 0;

  for (const context of contexts) {
    const label = formatInlineTerminalContextLabel(context);
    const matchIndex = text.indexOf(label, searchStartIndex);
    if (matchIndex === -1) {
      return false;
    }
    searchStartIndex = matchIndex + label.length;
  }

  return true;
}
