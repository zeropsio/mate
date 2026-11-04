/**
 * The two places a hidden value meets an ask, and the only ones it lives in: the field the person
 * types it into, on its way from the card to where it is stored, and a value revealed on the
 * person's own screen for a moment. Neither keeps a copy: the field holds what is typed until the
 * write takes it, and the revealed value goes when it hides.
 */
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { KEEP_HIDDEN } from "./ask.logic";
import type { AskDensity } from "./AskCard";

/** No browser or password manager offers to save or fill what is typed here, shown or masked. */
const NOT_A_PASSWORD = {
  autoComplete: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-bwignore": "",
  "data-form-type": "other",
  "data-lpignore": "true",
} as const;

export interface AskSecretFieldProps {
  readonly density: AskDensity;
  /** What the value is, in people's words: the field's name, shown above it in full. */
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  /** Enter presses the main action. */
  readonly onEnter: () => void;
  readonly disabled: boolean;
  readonly keepHidden: boolean;
  readonly onKeepHidden: (keepHidden: boolean) => void;
  /** Kept hidden already where it is stored: not the person's to make plain here. */
  readonly hiddenAlready: boolean;
}

/**
 * A masked field for a value only the person has, with its eye to check what was typed and
 * "Keep hidden" for how it is stored. The field is masked until the person shows it.
 */
export function AskSecretField(props: AskSecretFieldProps) {
  const id = useId();
  const hiddenId = useId();
  const [shown, setShown] = useState(false);
  const compact = props.density === "compact";
  const field = (
    <div className="flex min-w-48 flex-1 items-center gap-1">
      <Input
        {...NOT_A_PASSWORD}
        aria-label={compact ? props.label : undefined}
        disabled={props.disabled}
        id={id}
        onChange={(event) => props.onValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          props.onEnter();
        }}
        placeholder={compact ? props.label : undefined}
        size="sm"
        type={shown ? "text" : "password"}
        value={props.value}
      />
      <Button
        aria-label={shown ? "Hide" : "Show"}
        aria-pressed={shown}
        disabled={props.disabled}
        onClick={() => setShown((current) => !current)}
        size="icon-sm"
        variant="ghost"
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
  const keepHidden = (
    <span className="flex shrink-0 items-center gap-2 text-caption text-muted-foreground">
      <Checkbox
        aria-labelledby={hiddenId}
        checked={props.hiddenAlready || props.keepHidden}
        disabled={props.hiddenAlready || props.disabled}
        onCheckedChange={(checked) => props.onKeepHidden(checked === true)}
      />
      <span id={hiddenId}>{KEEP_HIDDEN}</span>
    </span>
  );
  if (compact) {
    return (
      // The field keeps a width to type in; Keep hidden goes under it where both do not fit.
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {field}
        {keepHidden}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-1.5">
      <label className="text-caption text-muted-foreground" htmlFor={id}>
        {props.label}
      </label>
      {field}
      {keepHidden}
    </div>
  );
}

/** How long a revealed value stays on screen. */
export const REVEAL_SECONDS = 30;

/**
 * A value revealed on the person's screen: its words, Copy, and how long until it hides — after
 * `seconds`, or at once when the person leaves the tab or the window. `onHide` says it went.
 */
export function AskRevealed({
  value,
  onHide,
  seconds = REVEAL_SECONDS,
}: {
  readonly value: string;
  readonly onHide: () => void;
  readonly seconds?: number;
}) {
  const [left, setLeft] = useState(seconds);
  const [copied, setCopied] = useState(false);
  const hide = useEffectEvent(onHide);
  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => {
      const remaining = seconds - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) hide();
      else setLeft(remaining);
    }, 1000);
    const leave = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) hide();
    };
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", leave);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", leave);
    };
  }, [seconds]);
  useEffect(() => {
    if (!copied) return;
    const reset = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(reset);
  }, [copied]);
  return (
    <div className="grid min-w-0 gap-1.5" data-ask-revealed>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-control bg-muted px-2.5 py-1.5 font-mono text-body">
          {value}
        </code>
        <Button
          onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
          size="sm"
          variant="secondary"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-caption text-muted-foreground" aria-live="off">
        Hides in {left} s or when you leave
      </p>
    </div>
  );
}
