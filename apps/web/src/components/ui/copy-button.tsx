"use client";

import { CheckIcon, CopyIcon } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { Button } from "./button";

/**
 * The one Copy press for a literal: a quiet icon that copies `value` whole and turns to a check
 * for two seconds. `label` names what it copies, for the reader of the page ("Copy the command",
 * "Copy zerops.yaml"). It stands at the end of what it copies: a `CodeBlock`'s corner, a
 * `CopyLine`'s end, a log's header. A press that copies a whole document beside other presses
 * ("Copy manifest") is a `Button` with its words.
 */
function CopyButton({
  value,
  label,
  disabled = false,
  className,
}: {
  /**
   * The text copied; `null` while it is read: the press waits, disabled. A function is read only
   * when pressed, for text joined from many parts (a log's lines).
   */
  readonly value: string | null | (() => string);
  /** What it copies, after "Copy": "the command", "zerops.yaml". */
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: label });
  return (
    <Button
      aria-label={isCopied ? "Copied" : `Copy ${label}`}
      className={className}
      data-copied={isCopied ? "" : undefined}
      data-slot="copy-button"
      disabled={disabled || value === null || value === ""}
      onClick={() => {
        if (value === null) return;
        copyToClipboard(typeof value === "function" ? value() : value, undefined);
      }}
      size="icon-sm"
      variant="ghost-muted"
    >
      {isCopied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
    </Button>
  );
}

export { CopyButton };
