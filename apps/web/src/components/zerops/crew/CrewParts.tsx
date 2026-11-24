/**
 * The Crew tab's small parts, shared by its column and its views: a press
 * with its line on hover, a blue word, a tooltip, the tab's ···, and a
 * change the tab watched arrive (`useArrived`) — never a first paint.
 */
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Button, InlineButton } from "../../ui/button";
import { Row } from "../../ui/row";
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

/**
 * One press with its line on hover: the system's Button, `primary` for a row's first, the rest
 * `secondary`, Cancel `ghost`, and `destructive` for what takes a crewmate off. `sm` in a row,
 * `md` in a view.
 */
export function CrewPress({
  label,
  line,
  variant = "primary",
  size = "sm",
  disabled = false,
  onPress,
  type = "button",
}: {
  readonly label: string;
  /** What it does, on hover. */
  readonly line?: string | null | undefined;
  readonly variant?: "primary" | "secondary" | "ghost" | "destructive";
  readonly size?: "sm" | "md";
  readonly disabled?: boolean;
  readonly onPress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly type?: "button" | "submit";
}) {
  return (
    <CrewTip tip={line ?? null}>
      <Button
        className="relative z-1"
        disabled={disabled}
        onClick={onPress}
        size={size}
        type={type}
        variant={variant}
      >
        {label}
      </Button>
    </CrewTip>
  );
}

/** A blue word in a line of words. */
export function CrewTextButton({
  label,
  line,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly line?: string | null | undefined;
  readonly disabled?: boolean;
  readonly onPress: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <CrewTip tip={line ?? null}>
      <InlineButton className="relative z-1" disabled={disabled} onClick={onPress}>
        {label}
      </InlineButton>
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
  return (
    <div className="px-4 font-medium text-muted-foreground text-caption leading-4">{children}</div>
  );
}

/**
 * A choice in a view (Start with a lead and two builders, More): a quiet card, its edge at rest
 * and the fill only under the pointer; one that waits sits back, its reason under its title.
 */
export function CrewChoice({
  lead,
  title,
  line,
  end,
  disabled = false,
  render,
}: {
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  readonly line?: ReactNode;
  /** At the row's end: a chevron unless said otherwise. */
  readonly end?: ReactNode;
  readonly disabled?: boolean;
  /** The press itself, with its handler and hooks. */
  readonly render: ReactElement;
}) {
  return (
    <div className={cn("rounded-card ring-1 ring-foreground/10", disabled && "opacity-55")}>
      <Row
        aria-disabled={disabled || undefined}
        lead={lead}
        line={line}
        lineWraps
        meta={end ?? <ChevronRightIcon aria-hidden="true" className="size-4" />}
        pressable
        render={render}
        title={title}
      />
    </div>
  );
}
