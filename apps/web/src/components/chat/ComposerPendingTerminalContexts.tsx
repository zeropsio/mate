import {
  type TerminalContextDraft,
  formatTerminalContextLabel,
  isTerminalContextExpired,
} from "~/lib/terminalContext";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";

interface ComposerPendingTerminalContextChipProps {
  context: TerminalContextDraft;
}

export function ComposerPendingTerminalContextChip({
  context,
}: ComposerPendingTerminalContextChipProps) {
  const label = formatTerminalContextLabel(context);
  const expired = isTerminalContextExpired(context);
  const kind = context.kind ?? "terminal";
  const tooltipText = expired
    ? kind === "data"
      ? `Data context expired. Remove and re-add ${label} to include it in your message.`
      : `Terminal context expired. Remove and re-add ${label} to include it in your message.`
    : context.text;

  return (
    <TerminalContextInlineChip
      label={label}
      tooltipText={tooltipText}
      expired={expired}
      kind={kind}
    />
  );
}
