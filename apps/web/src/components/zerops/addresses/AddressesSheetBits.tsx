/**
 * The addresses sheet's small shared pieces: a section and the groups in it, a row, a state's
 * pill, the stages of an address's way to answering, a tile for a value that stands alone, a copy
 * button, what went wrong under the control it belongs to, and the ask before a write puts
 * somebody else's waiting change live with it.
 */
import type { WaitingChange } from "@t3tools/client-runtime/data";
import { CheckIcon, CopyIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Children, useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Row } from "../../ui/row";
import { Section } from "../../ui/section";
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
  /**
   * Resolves `true` once Zerops took the write, `false` where it did not (the trouble says why,
   * unless the sheet asked by itself: `quiet`).
   */
  readonly onWrite: (write: AddressWrite, how?: { readonly quiet: boolean }) => Promise<boolean>;
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
 * A section: its title with the one thing it lets the person add at its end edge, and one short
 * line saying what its addresses are for; what waits elsewhere, then the form its action opens,
 * above its rows, where the press was; its groups in one container, a hairline between two; and
 * what belongs to no row below them.
 */
export function SheetSection({
  title,
  caption,
  action,
  part,
  notice,
  lead,
  children,
  after,
  apart = false,
}: {
  readonly title: string;
  readonly caption?: string;
  /** Each group is a thing of its own: a card each, instead of one container's lines. */
  readonly apart?: boolean;
  readonly action?: ReactNode;
  readonly part: string;
  readonly notice?: ReactNode;
  /** The form the section's action opens, right under its title. */
  readonly lead?: ReactNode;
  readonly children?: ReactNode;
  readonly after?: ReactNode;
}) {
  const groups = Children.toArray(children);
  return (
    <Section action={action} data-addresses-part={part} level={3} title={title}>
      {caption === undefined ? null : (
        <p className="-mt-1.5 max-w-xl text-muted-foreground text-xs">{caption}</p>
      )}
      {notice}
      {lead}
      {groups.length === 0 ? null : apart ? (
        <div className="grid gap-2">
          {groups.map((group, index) => (
            // The groups are the section's own children, in their order.
            // oxlint-disable-next-line react/no-array-index-key
            <Card key={index} variant="flat">
              {group}
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="flat">
          <div className="divide-y divide-border/60">{groups}</div>
        </Card>
      )}
      {after}
    </Section>
  );
}

/**
 * What one hairline sets apart in a section: one address's row, or the rows of one domain setup
 * with what they need under them. Its rows stand together, with no line between them.
 */
export function SheetGroup({
  children,
  data,
  ref,
}: {
  readonly children: ReactNode;
  readonly data?: string;
  readonly ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div className="min-w-0 scroll-mt-2" data-addresses-group={data} ref={ref}>
      {children}
    </div>
  );
}

/** What a group holds under its rows, on the rows' own text edge: a prompt, a guide, a line. */
export function GroupBody({ children }: { readonly children: ReactNode }) {
  return <div className="grid gap-2 px-3 pb-3">{children}</div>;
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
    <Row
      control={more}
      data-addresses-row={data}
      line={sub}
      meta={end}
      size="sm"
      title={<span className="flex min-w-0 items-center gap-2">{name}</span>}
    />
  );
}

/** A row's facts beside its name or at its end, quieter than the name: "→ app · port 3000". */
export function RowMeta({ children }: { readonly children: ReactNode }) {
  return (
    <span className="min-w-0 truncate font-normal text-muted-foreground text-xs">{children}</span>
  );
}

/** A real thing's own name (a hostname, an address) in the mono face, in the ink around it. */
export function RealName({ children }: { readonly children: ReactNode }) {
  return <span className="real-name min-w-0 truncate">{children}</span>;
}

/** Where a stage of a journey stands: behind, the person's move, Zerops's move, refused, ahead. */
export type StageState = "done" | "you" | "busy" | "failed" | "next";

/**
 * An address's way to answering, top to bottom: each stage a bead on one rail with its words
 * beside it, the one that is current carrying what it needs under them. The stages ahead stay
 * listed, so the whole way is read before it is walked.
 */
export function Journey({ children }: { readonly children: ReactNode }) {
  // In from the group's edge so each bead stands under the row's mark, centre on centre.
  return <ol className="m-0 grid list-none p-0 ps-1.5">{children}</ol>;
}

export function Stage({
  state,
  title,
  action,
  children,
}: {
  readonly state: StageState;
  readonly title: ReactNode;
  /** The one press the stage asks for, at its title's end. */
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}) {
  const ahead = state === "next" || state === "done";
  return (
    <li
      aria-current={ahead ? undefined : "step"}
      className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-5 pb-4 before:absolute before:top-6 before:bottom-1 before:left-2.5 before:w-px before:-translate-x-1/2 before:bg-border last:pb-0 last:before:hidden"
      data-addresses-stage={state}
    >
      <StageBead state={state} />
      <div className="grid min-w-0 gap-2.5">
        <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={
              ahead
                ? "min-w-0 flex-1 basis-56 text-muted-foreground text-sm leading-5"
                : "min-w-0 flex-1 basis-56 font-medium text-foreground text-sm leading-5"
            }
          >
            {/* The bead says the stage's state to the eye only. */}
            <span className="sr-only">{STAGE_SAID[state]} </span>
            {title}
          </span>
          {action === undefined || action === null ? null : (
            <span className="-my-1 flex shrink-0 items-center">{action}</span>
          )}
        </div>
        {children}
      </div>
    </li>
  );
}

const STAGE_SAID: Readonly<Record<StageState, string>> = {
  done: "Done:",
  you: "Your step:",
  busy: "Under way:",
  failed: "Failed:",
  next: "Later:",
};

function StageBead({ state }: { readonly state: StageState }) {
  const seat = "flex size-5 items-center justify-center rounded-full";
  switch (state) {
    case "done":
      return (
        <span aria-hidden="true" className={`${seat} bg-status-ok-surface text-status-ok-text`}>
          <CheckIcon className="size-3" strokeWidth={3} />
        </span>
      );
    case "you":
      return (
        <span aria-hidden="true" className={`${seat} bg-status-attention-surface`}>
          <span className="size-2 rounded-full bg-status-attention" />
        </span>
      );
    case "busy":
      return (
        <span aria-hidden="true" className={`${seat} bg-status-busy-surface text-status-busy-text`}>
          <Spinner size="xs" />
        </span>
      );
    case "failed":
      return (
        <span
          aria-hidden="true"
          className={`${seat} bg-status-failed-surface text-status-failed-text`}
        >
          <XIcon className="size-3" strokeWidth={3} />
        </span>
      );
    case "next":
      return (
        <span aria-hidden="true" className={seat}>
          <span className="size-2.5 rounded-full border border-muted-foreground/45" />
        </span>
      );
  }
}

/**
 * One value that stands for itself, as a tile: what it is, the value to copy, and what to know
 * of it in a few words. Tiles of one kind stand side by side.
 */
export function Tile({
  label,
  value,
  caption,
  action,
  data,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly caption: ReactNode;
  /** At the label's end: its copy, or the press it offers. */
  readonly action?: ReactNode;
  readonly data?: string;
}) {
  return (
    <Card data-addresses-tile={data} size="sm" variant="flat">
      <div className="flex min-h-7 min-w-0 items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground text-xs">{label}</span>
        {action}
      </div>
      <div className="grid min-w-0 gap-0.5">
        <div className="min-w-0 break-all text-foreground text-sm">{value}</div>
        <div className="text-muted-foreground text-xs">{caption}</div>
      </div>
    </Card>
  );
}

/** A state's word on its tone's pill, with a spinner while work is under way. */
export function Face({ word, tone }: { readonly word: string; readonly tone: FaceTone }) {
  return (
    <Badge data-face={tone} tone={FACE_TONE[tone]}>
      {tone === "busy" ? <Spinner aria-hidden="true" size="xs" /> : null}
      {word}
    </Badge>
  );
}

const FACE_TONE = { ok: "success", warn: "warning", busy: "info", fail: "danger" } as const;

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
      size="icon-sm"
      variant="ghost"
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
    <div ref={revealed}>
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
              variant={destructive ? "destructive" : "primary"}
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

/** Changes made elsewhere that wait to go live, and the press that puts them live. */
export function WaitingNotice({
  others: waiting,
  kind,
  placeName,
  busy,
  held,
  trouble,
  onPublish,
}: {
  readonly others: ReadonlyArray<WaitingChange>;
  readonly kind: "domain" | "port";
  readonly placeName: string;
  readonly busy: boolean;
  /** The place is still being read: nothing is sent. */
  readonly held: boolean;
  readonly trouble: string | undefined;
  /** `undefined` while a change of ours is under way: they go live with it. */
  readonly onPublish: (() => void) | undefined;
}) {
  return (
    <Card size="sm" variant="inset">
      <div className="font-medium text-sm">
        {waiting.length === 1
          ? "A change made elsewhere waits to go live"
          : "Changes made elsewhere wait to go live"}
      </div>
      <ul className="m-0 grid list-none gap-0.5 p-0 text-muted-foreground text-sm">
        {waiting.map((change) => (
          <li key={change.id}>{change.label}</li>
        ))}
      </ul>
      {onPublish === undefined ? (
        <p className="text-muted-foreground text-xs">
          {waiting.length === 1 ? "It goes" : "They go"} live with your change.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button disabled={busy || held} onClick={onPublish} size="sm" variant="secondary">
            {busy ? <Spinner aria-hidden="true" /> : null}
            {waiting.length === 1 ? "Put it live" : "Put them live"}
          </Button>
          <span className="text-muted-foreground text-xs">
            Zerops puts every waiting {kind} change of {placeName} live together.
          </span>
        </div>
      )}
      <Trouble text={trouble} />
    </Card>
  );
}
