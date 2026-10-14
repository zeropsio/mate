/**
 * The addresses sheet's small shared pieces: a section, a row, a face (mark and word together), a
 * copy button, what went wrong under the control it belongs to, and the ask before a write puts
 * somebody else's waiting change live with it.
 */
import type { WaitingChange } from "@t3tools/client-runtime/data";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";

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

/**
 * A section: its title, with the one thing it lets the person add at its end edge (blue: it
 * acts); what waits elsewhere above its rows; its rows grouped in one container; and the form or
 * prompt opened from it below them.
 */
export function SheetSection({
  title,
  action,
  part,
  notice,
  children,
  after,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly part: string;
  readonly notice?: ReactNode;
  readonly children?: ReactNode;
  readonly after?: ReactNode;
}) {
  const rows = Children.toArray(children);
  return (
    <section className="grid gap-2" data-addresses-part={part}>
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h3 className="font-semibold text-foreground text-sm">{title}</h3>
        {action}
      </header>
      {notice}
      {rows.length === 0 ? null : (
        <div className="rounded-xl border border-border/70 bg-card px-3.5">{rows}</div>
      )}
      {after}
    </section>
  );
}

/** One row: what it is, with its line under where it needs one, then its state, then its more. */
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
      className={`grid min-h-11 items-center gap-x-3 border-t border-border/60 py-1.5 first:border-t-0 ${more === undefined ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto_2rem]"}`}
      data-addresses-row={data}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 font-medium text-sm">{name}</div>
        {sub === undefined ? null : (
          <div className="mt-px truncate text-muted-foreground text-xs">{sub}</div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">{end}</div>
      {more === undefined ? null : <div className="flex justify-end">{more}</div>}
    </div>
  );
}

/** What kind of address a row holds, in the column its kind's rows share: "IPv6". */
export function RowKind({ children }: { readonly children: ReactNode }) {
  return <span className="w-9 shrink-0 font-medium text-muted-foreground text-xs">{children}</span>;
}

/** A row's facts beside its name or at its end, quieter than the name: "→ app · port 3000". */
export function RowMeta({ children }: { readonly children: ReactNode }) {
  return (
    <span className="min-w-0 truncate font-normal text-muted-foreground text-xs">{children}</span>
  );
}

/** A section with nothing in it yet, said once inside its container. */
export function SheetEmpty({ children }: { readonly children: ReactNode }) {
  return <p className="py-3 text-muted-foreground text-sm">{children}</p>;
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
/**
 * A form or prompt opened in place, brought whole into the sheet's view as it opens: one opened
 * from the bottom row would leave its buttons below the fold.
 */
export function useRevealed<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return ref;
}

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
  const revealed = useRevealed<HTMLDivElement>();
  return (
    <div className="mb-3" ref={revealed}>
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
