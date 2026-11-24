"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import {
  createContext,
  use,
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";

type RadioGroupProps = RadioGroupPrimitive.Props & {
  /**
   * `stack` lists its radios down; `columns` sets cards two to a row, 12 px apart (one to a row,
   * 8 px apart, on a phone); `row` sets like tiles side by side, as wide as each other, 8 px apart.
   */
  readonly layout?: "stack" | "columns" | "row";
};

function RadioGroup({ className, layout = "stack", ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      className={cn(
        layout === "stack" && "flex flex-col gap-3",
        layout === "columns" && "grid grid-cols-2 gap-3 max-sm:grid-cols-1 max-sm:gap-2",
        layout === "row" && "grid auto-cols-fr grid-flow-col gap-2",
        className,
      )}
      data-slot="radio-group"
      {...props}
    />
  );
}

function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-input bg-background not-dark:bg-clip-padding shadow-xs/5 outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-full not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/48 data-disabled:opacity-64 sm:size-4 dark:not-data-checked:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] [[data-disabled],[data-checked],[aria-invalid]]:shadow-none",
        className,
      )}
      data-slot="radio"
      {...props}
    >
      <RadioPrimitive.Indicator
        className="-inset-px absolute flex size-4.5 items-center justify-center rounded-full before:size-2 before:rounded-full before:bg-primary-foreground data-unchecked:hidden data-checked:bg-primary sm:size-4 sm:before:size-1.5"
        data-slot="radio-indicator"
      />
    </RadioPrimitive.Root>
  );
}

type RadioCardProps = Omit<RadioPrimitive.Root.Props, "children" | "title"> & {
  /** The choice's name, on the card's first line; an icon before it sits on its line. */
  readonly title: ReactNode;
  /** The quiet lines under the name, one column. */
  readonly children?: ReactNode;
  /** `center` stacks the name and its lines down the card's middle (a row of like tiles). */
  readonly align?: "start" | "center";
};

/** A choice drawn as a card on a tinted ground: its name and the lines under it, the chosen one outlined in blue on its surface's own ground. */
function RadioCard({ className, title, children, align = "start", ...props }: RadioCardProps) {
  return (
    <RadioPrimitive.Root
      className={cn(
        "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-card border-[1.5px] border-transparent bg-foreground/4 px-4 py-3.5 text-start outline-none transition-[background-color,border-color] duration-150 ease-out-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring not-data-checked:not-data-disabled:hover:bg-foreground/7 data-checked:border-primary data-checked:bg-transparent data-disabled:cursor-default data-disabled:not-data-checked:opacity-55 max-sm:gap-0.5 max-sm:py-3",
        align === "center" && "items-center text-center",
        className,
      )}
      data-slot="radio-card"
      {...props}
    >
      <span
        className="flex max-w-full min-w-0 items-center gap-1.5 font-medium text-emphasis leading-5 text-foreground"
        data-slot="radio-card-title"
      >
        {title}
      </span>
      {children === undefined ? null : (
        <span
          className={cn(
            "flex max-w-full min-w-0 flex-col text-caption leading-4.5 text-muted-foreground",
            align === "center" && "items-center",
          )}
          data-slot="radio-card-description"
        >
          {children}
        </span>
      )}
    </RadioPrimitive.Root>
  );
}

interface SwatchRow {
  readonly value: string;
  /** Picks the option at `from`'s place stepped `by` (0 picks `from` itself), and focuses it. */
  readonly step: (from: string, by: number) => void;
  readonly seat: (option: string, node: HTMLButtonElement | null) => void;
}

const RadioSwatchRowContext = createContext<SwatchRow | null>(null);

const SWATCH_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

type RadioSwatchGroupProps<T extends string> = Omit<
  ComponentProps<"div">,
  "role" | "onChange" | "defaultValue"
> & {
  /** Every option in the order the arrow keys walk them. */
  readonly options: ReadonlyArray<T>;
  readonly value: T;
  readonly onValueChange: (value: T) => void;
};

/**
 * A radio group of swatches: one Tab stop, the picked one, which follows the value even when it
 * changes from outside the group; the arrow keys walk the options and pick as they go.
 */
function RadioSwatchGroup<T extends string>({
  options,
  value,
  onValueChange,
  className,
  ...props
}: RadioSwatchGroupProps<T>) {
  const seats = useRef(new Map<string, HTMLButtonElement>());
  const row = useMemo<SwatchRow>(
    () => ({
      value,
      step: (from, by) => {
        const at = options.findIndex((option) => option === from);
        if (at === -1) return;
        const next = options[(at + by + options.length) % options.length];
        if (next === undefined) return;
        onValueChange(next);
        if (by !== 0) seats.current.get(next)?.focus();
      },
      seat: (option, node) => {
        if (node === null) seats.current.delete(option);
        else seats.current.set(option, node);
      },
    }),
    [onValueChange, options, value],
  );
  return (
    <RadioSwatchRowContext value={row}>
      <div className={className} data-slot="radio-swatch-group" role="radiogroup" {...props} />
    </RadioSwatchRowContext>
  );
}

type RadioSwatchProps = Omit<
  ComponentProps<"button">,
  "value" | "children" | "role" | "type" | "aria-label" | "style" | "ref"
> & {
  readonly value: string;
  /** What a screen reader says for the option: a swatch carries no words. */
  readonly "aria-label": string;
  /** Custom properties the mark reads (its tint). */
  readonly style?: CSSProperties;
  /** `default` is a 36 px press; `fill` takes its seat's whole box, for a seat its caller places. */
  readonly size?: "default" | "fill";
  /** The option's mark, an `svg` filling the press; its ring is the part marked `data-slot="radio-swatch-ring"`. */
  readonly children: ReactNode;
};

/**
 * A radio drawn as its own mark (a colour, a shape): the picked one's ring shows, faint under the
 * pointer on another, so picking never changes a size; pressed, it gives a little.
 */
function RadioSwatch({ value, size = "default", className, children, ...props }: RadioSwatchProps) {
  const row = use(RadioSwatchRowContext);
  if (row === null) throw new Error("RadioSwatch stands in a RadioSwatchGroup");
  const checked = row.value === value;
  return (
    <button
      {...props}
      aria-checked={checked}
      className={cn(
        "grid shrink-0 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-[scale] motion-safe:duration-150 motion-safe:ease-out-strong motion-safe:active:scale-92 [&>svg]:size-full",
        "[&_[data-slot=radio-swatch-ring]]:opacity-0 [&_[data-slot=radio-swatch-ring]]:transition-opacity [&_[data-slot=radio-swatch-ring]]:duration-150 data-checked:[&_[data-slot=radio-swatch-ring]]:opacity-100 pointer-fine:not-data-checked:hover:[&_[data-slot=radio-swatch-ring]]:opacity-35",
        size === "default" ? "size-9" : "size-full",
        className,
      )}
      data-checked={checked ? "" : undefined}
      data-slot="radio-swatch"
      onClick={(event) => {
        props.onClick?.(event);
        row.step(value, 0);
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        const by = SWATCH_STEPS[event.key];
        if (by === undefined) return;
        event.preventDefault();
        row.step(value, by);
      }}
      ref={(node) => {
        row.seat(value, node);
      }}
      role="radio"
      tabIndex={checked ? 0 : -1}
      type="button"
    >
      {children}
    </button>
  );
}

export { RadioGroup, Radio, RadioCard, RadioSwatchGroup, RadioSwatch };
