/**
 * Settings › Automation's list: one bordered card, a row per thing the organization connects —
 * its mark, name and one line, a status pill, and one press. What the press opens (the steps to
 * connect, or what a connected one holds) unfolds inside the row, under its line, and folds back
 * on Cancel or a second press. The row's own line never changes height as what it reads lands:
 * the pill holds its width as *Checking…* and the line stays one line.
 */
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { useSettingsSearchTarget } from "./settingsLayout";

/** The rows, as one card with a hairline between each. */
export function IntegrationList({ children }: { readonly children: ReactNode }) {
  return (
    <Card variant="flat">
      <ul className="divide-y divide-border">{children}</ul>
    </Card>
  );
}

/** The limits on what automated Mates spend: their own card, a group apart from the connections. */
export function LimitsList({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mt-3">
      <IntegrationList>{children}</IntegrationList>
    </div>
  );
}

/** Where a row stands, as its pill says it; `none`: no pill (its line says why). */
export type IntegrationState =
  | { readonly kind: "checking" }
  | { readonly kind: "on"; readonly words: string }
  | { readonly kind: "off"; readonly words: string }
  | { readonly kind: "none" };

export function IntegrationStatus({ state }: { readonly state: IntegrationState }) {
  switch (state.kind) {
    case "checking":
      return (
        <span className="flex items-center">
          <Skeleton className="h-4 w-20" shape="pill" />
          <span className="sr-only">Checking…</span>
        </span>
      );
    case "on":
      return (
        <Badge dot tone="success">
          {state.words}
        </Badge>
      );
    case "off":
      return (
        <Badge dot tone="neutral">
          {state.words}
        </Badge>
      );
    case "none":
      return null;
  }
}

export function IntegrationRow({
  id,
  surface,
  mark,
  name,
  line,
  state,
  action,
  open,
  children,
}: {
  /** The settings search's anchor. */
  readonly id?: string;
  readonly surface: string;
  /** A 20 px monochrome mark. */
  readonly mark: ReactNode;
  readonly name: string;
  /** One line: what it does, or where it stands once connected. */
  readonly line: ReactNode;
  readonly state: IntegrationState;
  /** The row's one press. */
  readonly action?: ReactNode;
  /** Whether what the press opens is shown. */
  readonly open: boolean;
  /** What the press opens. */
  readonly children?: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLLIElement>(id);
  return (
    <li
      data-zerops-surface={surface}
      id={id}
      ref={targetRef}
      tabIndex={id === undefined ? undefined : -1}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
          {mark}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{line}</p>
        </div>
        <span className="flex w-32 shrink-0 justify-end text-xs">
          <IntegrationStatus state={state} />
        </span>
        <span className="flex w-24 shrink-0 justify-end">{action}</span>
      </div>
      <Reveal open={open}>
        <div className="grid gap-3 pe-4 pb-4 ps-12">{children}</div>
      </Reveal>
    </li>
  );
}

/**
 * A setting in the list's columns: its mark, name and value in words, and its fields with Save
 * where the status and the press stand in a connection's row; what it says of a save, under it.
 */
export function IntegrationSetting({
  id,
  surface,
  mark,
  name,
  line,
  control,
  children,
}: {
  readonly id?: string;
  readonly surface: string;
  readonly mark: ReactNode;
  readonly name: string;
  /** Its value in words. */
  readonly line: ReactNode;
  readonly control?: ReactNode;
  readonly children?: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLLIElement>(id);
  return (
    <li
      data-zerops-surface={surface}
      id={id}
      ref={targetRef}
      tabIndex={id === undefined ? undefined : -1}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
          {mark}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">{line}</p>
        </div>
        <div className="flex shrink-0 justify-end">{control}</div>
      </div>
      {children ? <div className="pe-4 pb-3 ps-12">{children}</div> : null}
    </li>
  );
}

/**
 * A row's press: *Connect* while it is not, *Manage* or *Replace* once it is — and, while what it
 * opened shows, the press that folds it (`closeWords`). `closeWords: null`: what it opened carries
 * its own Cancel, and the press holds its room unseen until it folds.
 */
export function IntegrationAction({
  primary,
  open,
  onToggle,
  disabled = false,
  closeWords = "Cancel",
  children,
}: {
  readonly primary: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly disabled?: boolean;
  readonly closeWords?: string | null;
  readonly children: ReactNode;
}) {
  if (open && closeWords === null)
    return (
      <span aria-hidden className="invisible">
        <Button size="sm" tabIndex={-1} variant={primary ? "primary" : "secondary"}>
          {children}
        </Button>
      </span>
    );
  return (
    <Button
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
      size="sm"
      variant={primary && !open ? "primary" : "secondary"}
    >
      {open ? closeWords : children}
    </Button>
  );
}

/**
 * What a row's press opens, clipped in from its top as the person opens it (200 ms, ease-out; no
 * travel where motion is reduced) and folded back the same way, then dropped: nothing typed into
 * it outlives its fold.
 */
function Reveal({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  // Without travel there is no transition's end to drop it at: it goes as it folds.
  if (!open && shown && reducedMotion()) setShown(false);
  if (!shown) return null;
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] starting:grid-rows-[0fr]" : "grid-rows-[0fr]",
      )}
      inert={!open}
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget) setShown(false);
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slack's mark, in the line's ink. */
export function SlackMark() {
  return (
    <svg aria-hidden className="size-5" fill="currentColor" viewBox="0 0 24 24">
      <rect height="18" rx="1.5" width="3" x="7" y="3" />
      <rect height="18" rx="1.5" width="3" x="14" y="3" />
      <rect height="3" rx="1.5" width="18" x="3" y="7" />
      <rect height="3" rx="1.5" width="18" x="3" y="14" />
    </svg>
  );
}

/** Discord's mark, in the line's ink. */
export function DiscordMark() {
  return (
    <svg aria-hidden className="size-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M19.3 5.4A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1a16.6 16.6 0 0 0-4.1 1.4C2.1 9.3 1.4 13.1 1.8 16.8a16.7 16.7 0 0 0 5 2.6l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5-2.6c.5-4.3-.7-8-2.9-11.4ZM8.7 14.6c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}
