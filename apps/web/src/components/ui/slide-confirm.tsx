"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "~/lib/utils";

import { Button } from "./button";
import {
  SLIDE_CONFIRM_KEYS,
  slideConfirmNext,
  type SlideConfirmEvent,
  type SlideConfirmValue,
} from "./slide-confirm.logic";

/**
 * A one-way confirmation that something in Zerops is deleted: a track one control high in the
 * destructive ink with its words inside ("Slide to delete Stage shop-stage"), dragged by its square
 * thumb from left to right. Let go of short of the end, it returns to the start; at the end it
 * locks, the track fills, the words read `confirmedLabel` and an Undo press beside it takes it
 * back. One per environment a deletion takes, above the dialog's name field; the dialog's Delete
 * stays shut until each is `confirmed`. Not a value picked along a range: that is a `Slider`.
 *
 * The thumb is a focusable slider named by `label`, "Not confirmed" or "Confirmed": an arrow
 * moves it a quarter, End confirms at once, Home or an arrow back takes it back, and Enter and
 * Space do nothing on it, so the form's Enter never confirms. A press on the track moves nothing.
 * `locked` holds it where it stands (a Production's slide until its name is typed); whoever locks
 * a confirmed slide sets `confirmed` back to false with it.
 */
export function SlideConfirm({
  label,
  confirmedLabel,
  confirmed,
  onConfirmedChange,
  locked = false,
  className,
}: {
  readonly label: string;
  readonly confirmedLabel: string;
  readonly confirmed: boolean;
  readonly onConfirmedChange: (confirmed: boolean) => void;
  readonly locked?: boolean;
  readonly className?: string;
}) {
  // Where the thumb rests while not confirmed; a confirmed slide always stands at the end.
  const [resting, setResting] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const value: SlideConfirmValue = { position: confirmed ? 1 : resting, confirmed };

  const apply = (event: SlideConfirmEvent) => {
    const next = slideConfirmNext(value, event, locked);
    setResting(next.confirmed ? 0 : next.position);
    if (next.confirmed !== confirmed) onConfirmedChange(next.confirmed);
  };

  // Caught before the slider's own keys, which would step by its value instead.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!SLIDE_CONFIRM_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    apply({ type: "key", key: event.key });
  };

  // Only the thumb is dragged: a press on the track would jump it toward the end.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest('[data-slot="slide-confirm-thumb"]')
    ) {
      event.preventDefault();
    }
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} data-slot="slide-confirm">
      <SliderPrimitive.Root
        className="group/slide-confirm min-w-0 flex-1 data-disabled:opacity-64"
        disabled={locked}
        max={100}
        min={0}
        onValueChange={(next, details) => {
          if (details.reason === "drag") apply({ type: "drag", to: next / 100 });
          // A screen reader's increment arrives as the input's own change: it moves as an arrow does.
          if (details.reason === "input-change" && next !== value.position * 100) {
            apply({ type: "key", key: next > value.position * 100 ? "ArrowRight" : "ArrowLeft" });
          }
        }}
        onValueCommitted={(_, details) => {
          if (details.reason === "drag") apply({ type: "release" });
        }}
        step={0.1}
        thumbAlignment="edge"
        value={value.position * 100}
      >
        <SliderPrimitive.Control
          className="flex h-8 w-full touch-none select-none"
          data-slot="slide-confirm-control"
          onPointerDown={onPointerDown}
        >
          <SliderPrimitive.Track
            className="relative h-full w-full rounded-control bg-destructive/8 inset-ring inset-ring-destructive/32"
            data-slot="slide-confirm-track"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center ps-10 pe-3 font-medium text-body text-destructive-foreground"
            >
              <span className="min-w-0 truncate">{label}</span>
            </span>
            <SliderPrimitive.Indicator
              className="rounded-control bg-destructive transition-[width] duration-200 ease-out-strong group-data-dragging/slide-confirm:transition-none motion-reduce:transition-none"
              data-slot="slide-confirm-indicator"
            />
            {confirmed ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center ps-3 pe-10 font-medium text-body text-primary-foreground"
              >
                <span className="min-w-0 truncate">{confirmedLabel}</span>
              </span>
            ) : null}
            <SliderPrimitive.Thumb
              aria-label={label}
              className="flex size-8 cursor-grab items-center justify-center rounded-control bg-destructive text-primary-foreground shadow-xs shadow-destructive/24 outline-none transition-[inset-inline-start] duration-200 ease-out-strong group-data-dragging/slide-confirm:cursor-grabbing group-data-dragging/slide-confirm:transition-none group-data-disabled/slide-confirm:cursor-not-allowed has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-1 has-focus-visible:ring-offset-background motion-reduce:transition-none data-[confirmed]:cursor-default [&_svg]:size-4"
              data-confirmed={confirmed ? "" : undefined}
              data-slot="slide-confirm-thumb"
              getAriaValueText={() => (confirmed ? "Confirmed" : "Not confirmed")}
              inputRef={input}
              onKeyDownCapture={onKeyDownCapture}
            >
              {confirmed ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <ChevronRightIcon aria-hidden="true" />
              )}
            </SliderPrimitive.Thumb>
          </SliderPrimitive.Track>
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
      {confirmed ? (
        <Button
          disabled={locked}
          onClick={() => {
            apply({ type: "undo" });
            input.current?.focus();
          }}
          size="sm"
          variant="ghost"
        >
          Undo
        </Button>
      ) : null}
    </div>
  );
}
