/**
 * The Crew tab's small parts, shared by its column and its views: a press
 * with its line on hover, a blue word, a tooltip, the tab's ···, and a
 * change the tab watched arrive (`useArrived`) — never a first paint.
 */
import { EllipsisIcon } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";

/** A tooltip saying what a press does; nothing around it while there is nothing to say. */
export function CrewTip({
  tip,
  side = "top",
  children,
}: {
  readonly tip: string | null;
  readonly side?: "top" | "bottom" | "left" | "right";
  /** The element the tip is about, rendered as it is. */
  readonly children: ReactElement;
}) {
  if (tip === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side={side}>{tip}</TooltipPopup>
    </Tooltip>
  );
}

export type CrewPressTone = "primary" | "quiet" | "muted" | "failed";

/** One press: the first of a row's filled in the action blue, the rest its words. */
export function CrewPress({
  label,
  line,
  tone = "primary",
  size = "row",
  disabled = false,
  onPress,
  type = "button",
}: {
  readonly label: string;
  /** What it does, on hover. */
  readonly line?: string | null | undefined;
  readonly tone?: CrewPressTone;
  /** A row's 28 px, or a view's 32. */
  readonly size?: "row" | "view";
  readonly disabled?: boolean;
  readonly onPress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly type?: "button" | "submit";
}) {
  return (
    <CrewTip tip={line ?? null}>
      <button
        className="crew-press crew-row-above"
        data-failed={tone === "failed" ? "" : undefined}
        data-muted={tone === "muted" ? "" : undefined}
        data-quiet={tone === "quiet" ? "" : undefined}
        data-size={size === "view" ? "view" : undefined}
        disabled={disabled}
        onClick={onPress}
        type={type}
      >
        {label}
      </button>
    </CrewTip>
  );
}

/** A blue word in a line of words. */
export function CrewTextButton({
  label,
  line,
  onPress,
}: {
  readonly label: string;
  readonly line?: string | null | undefined;
  readonly onPress: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <CrewTip tip={line ?? null}>
      <button className="crew-textbtn crew-row-above" onClick={onPress} type="button">
        {label}
      </button>
    </CrewTip>
  );
}

/** The ···, the tab's and a row's. */
export function CrewDots({ className }: { readonly className?: string }) {
  return <EllipsisIcon aria-hidden="true" className={className ?? "size-4"} />;
}

/**
 * Whether `value` changed while the tab watched: `true` from the render the
 * change arrives in until the next change — never on the first paint, so a
 * reload or a remount draws what stands, still.
 */
export function useArrived<T>(value: T): boolean {
  const [seen, setSeen] = useState<{ readonly value: T; readonly arrived: boolean }>({
    value,
    arrived: false,
  });
  if (!Object.is(seen.value, value)) {
    setSeen({ value, arrived: true });
    return true;
  }
  return seen.arrived;
}

/** A heading over one of the tab's groups: 12/500, muted. */
export function CrewHeading({ children }: { readonly children: ReactNode }) {
  return <div className="px-4 font-medium text-muted-foreground text-xs leading-4">{children}</div>;
}
