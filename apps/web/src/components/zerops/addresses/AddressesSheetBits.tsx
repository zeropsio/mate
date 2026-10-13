/**
 * The addresses sheet's small shared pieces: a section, a row, a face (mark and word together), a
 * copy button, what went wrong under the control it belongs to, and the ask before a write puts
 * somebody else's waiting change live with it.
 */
import type { WaitingChange } from "@t3tools/client-runtime/data";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import type { AddressWrite, FaceTone } from "./addresses.logic";

/** What every part of the sheet reads: whose place, what is under way, and how to write. */
export interface SheetContext {
  readonly projectId: string;
  /** The place as the person names it: "Production", a stage's name, "Fen's own project". */
  readonly placeName: string;
  /** The application (or the place, outside one) as copy names it: "Shop". */
  readonly projectName: string;
  /** Presses under way, by `writeKey`. */
  readonly busy: ReadonlySet<string>;
  /** Why the last write of a key failed, by `writeKey`. */
  readonly trouble: ReadonlyMap<string, string>;
  /** Resolves `true` once Zerops took the write, `false` where it did not (the trouble says why). */
  readonly onWrite: (write: AddressWrite) => Promise<boolean>;
  /**
   * Ends the change a write was asked from, once Zerops took it — only while that change is
   * still the one shown: an answer never closes what the person opened meanwhile.
   */
  readonly settle: (asked: object) => void;
  /** The place is still being read: what waits to go live may be unknown, so nothing is sent. */
  readonly hold: boolean;
  readonly nowMs: number;
}

export function SheetSection({
  title,
  words,
  part,
  children,
}: {
  readonly title: string;
  readonly words: string;
  readonly part: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid" data-addresses-part={part}>
      <header className="flex min-w-0 items-baseline gap-2.5 pb-1.5">
        <h3 className="shrink-0 font-semibold text-sm text-foreground">{title}</h3>
        <span className="truncate text-xs text-muted-foreground">{words}</span>
      </header>
      {children}
    </section>
  );
}

/** One row: what it is and its line under, then its state, then its more. */
export function SheetRow({
  name,
  sub,
  end,
  more,
  data,
}: {
  readonly name: ReactNode;
  readonly sub?: ReactNode;
  readonly end?: ReactNode;
  readonly more?: ReactNode;
  readonly data?: string;
}) {
  return (
    <div
      className="grid min-h-13 grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-x-3.5 border-t border-border/60 py-2"
      data-addresses-row={data}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 font-medium text-sm">{name}</div>
        {sub === undefined ? null : (
          <div className="mt-px truncate text-xs text-muted-foreground">{sub}</div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">{end}</div>
      <div className="flex justify-end">{more}</div>
    </div>
  );
}

/** A state's mark and its word, together. */
export function Face({ word, tone }: { readonly word: string; readonly tone: FaceTone }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
      data-face={tone}
    >
      {tone === "busy" ? (
        <Spinner aria-hidden="true" size="xs" tone="muted" />
      ) : (
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${tone === "ok" ? "bg-success" : "bg-warning"}`}
        />
      )}
      {word}
    </span>
  );
}

/** How long a copied value says so. */
const COPIED_MS = 1_200;

export function CopyButton({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
      onClick={() => {
        void writeTextToClipboard(value, value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      size="icon-xs"
      variant="ghost-muted"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** Why the last press of a control failed, under it; nothing when none did. */
export function Trouble({ text }: { readonly text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <p
      className="py-1.5 text-destructive-foreground text-xs"
      data-addresses-trouble=""
      role="alert"
    >
      {text}
    </p>
  );
}

/** A confirm's two presses, the change first; the press's own label says what it does. */
export function Confirm({
  title,
  icon,
  tone = "warning",
  children,
  confirm,
  cancel,
  busy,
  destructive = false,
  disabled = false,
  onConfirm,
  onCancel,
}: {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly tone?: "warning" | "default";
  readonly children: ReactNode;
  readonly confirm: string;
  readonly cancel: string;
  readonly busy: boolean;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="mb-3">
      <Alert controlAlignment="first-line" variant={tone}>
        {icon ?? <TriangleAlertIcon />}
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {children}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy || disabled}
              onClick={onConfirm}
              size="sm"
              variant={destructive ? "destructive" : "default"}
            >
              {busy ? <Spinner aria-hidden="true" /> : null}
              {confirm}
            </Button>
            <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
              {cancel}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

/** Somebody else's waiting changes a write would put live, by what they do. */
export function OthersList({
  others,
  kind,
  placeName,
}: {
  readonly others: ReadonlyArray<WaitingChange>;
  readonly kind: "domain" | "port";
  readonly placeName: string;
}) {
  return (
    <>
      <ul className="grid gap-0.5" data-addresses-others="">
        {others.map((change) => (
          <li className="font-medium text-foreground" key={change.id}>
            {change.label}
          </li>
        ))}
      </ul>
      <p>
        {others.length === 1 ? "It was made elsewhere and isn't live yet. " : ""}
        {others.length > 1 ? "They were made elsewhere and aren't live yet. " : ""}
        Zerops puts every waiting {kind} change of {placeName} live together, so Mate asks first.
      </p>
    </>
  );
}

/** "Adding shop.com also puts live a change made elsewhere". */
export const guardTitle = (doing: string, others: number) =>
  `${doing} also puts live ${others === 1 ? "a change" : `${others} changes`} made elsewhere`;

/** The guard's press: what the write does, and that the others go live with it. */
export const guardPress = (verb: string | null, others: number) => {
  const all = others === 1 ? "both" : "them all";
  return verb === null ? `Put ${all} live` : `${verb} it and put ${all} live`;
};
