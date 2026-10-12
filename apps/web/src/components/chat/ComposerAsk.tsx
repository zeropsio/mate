/**
 * What the Mate waits on the person for, at the composer's top, in one look for every ask: its
 * face in its needs pose, what it asks in one sentence, its detail under it, and its one blue
 * button — one at a time, as the change waiting for review has stood there (the owner's pick on
 * the "Composer Strips" board, S6, 2026-10-12: "I have a feeling they all look different,
 * especially when stacked they look extremely stupid").
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";

import { useKnownMate } from "~/zerops/useZeropsMates";

import { MateFace } from "../zerops/primitives";

/** A plain agent's mark where no Mate lives: the amber of who is next. */
export function ComposerAskMark() {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 justify-self-center rounded-full bg-status-attention"
    />
  );
}

/** The asking Mate's face, waiting on the person; a plain agent's mark where no Mate lives here. */
export function ComposerAskFace({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const mate = useKnownMate(environmentId);
  return mate === undefined ? (
    <ComposerAskMark />
  ) : (
    <MateFace shape={mate.shape} size="md" state="needs" tint={mate.tint} />
  );
}

/** The ask's one blue button: Review, Approve, Save to vault. */
export function ComposerAskButton({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return <button className={cn("composer-top-button", className)} type={type} {...props} />;
}

/** Who asks, by name: the Mate living here, else the agent. */
export function useComposerAskName(environmentId: EnvironmentId): string {
  return useKnownMate(environmentId)?.name ?? "The agent";
}

export function ComposerAsk({
  label,
  kind,
  face,
  title,
  detail,
  actions,
  children,
}: {
  /** What a screen reader calls it. */
  readonly label: string;
  /** Which ask it is, for what reads the composer's top (`data-composer-top`). */
  readonly kind: string;
  readonly face: ReactNode;
  /** What it asks, in one sentence. */
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  /** Its one blue button, and any quiet ones before it. */
  readonly actions?: ReactNode;
  /** What it asks with: the options, a value's field. */
  readonly children?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-foreground/8 border-b pt-3 pe-2 pb-3 ps-4"
      // What it asks stands over the conversation's end: it never moves it (`ChatView`).
      data-chat-composer-asks="true"
      data-composer-top={kind}
      role="group"
    >
      {face}
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground text-line leading-4.5">{title}</p>
        {detail === undefined ? null : (
          <div className="min-w-0 text-muted-foreground text-line leading-4.5">{detail}</div>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">{actions}</div>
      )}
      {/* A folded panel leaves it empty, and an empty row would still take the grid's gap. */}
      {children === undefined ? null : (
        <div className="col-start-2 col-end-4 min-w-0 empty:hidden">{children}</div>
      )}
    </section>
  );
}
