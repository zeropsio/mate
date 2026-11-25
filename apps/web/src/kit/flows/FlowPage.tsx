import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  LayoutGridIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { SelectButton } from "~/components/ui/select";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

import { flowSrc, type FlowTheme, type KitFlow, type KitFlowState } from "../kitFlows";
import { FlowFrame } from "./flowFrame";
import { FlowGrid } from "./flowGrid";
import { useHeldScroll } from "./heldScroll";

type FlowMode = "one" | "grid";

/** A page without a `kit-states` meta still has the one state it opens in. */
const ONLY_STATE: readonly KitFlowState[] = [{ id: "default", label: "Default", search: "" }];

/** States up to this many sit side by side as a segmented choice; more go in a list to search. */
const SEGMENTED_AT_MOST = 5;

const CANVAS_PADDING = 24;
const CAPTION_HEIGHT = 28;
const SHORTEST_FRAME = 320;

/**
 * Where arrows move inside a control (a field's caret, a list, a menu), never between states. In
 * the segmented switcher they move the focus and the state together.
 */
const ownsArrows = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    "input, textarea, select, [contenteditable], [role=listbox], [role=menu], [role=slider], [role=tablist], [role=dialog]",
  ) !== null;

/**
 * One flow of the design harness: its page in a state, at a window's width and a zoom, in one
 * appearance or both, or every state at once as live thumbnails. ← and → step through the states.
 */
export function FlowPage({
  flow,
  appearance,
  viewport,
  zoom,
  state,
  onStateChange,
}: {
  flow: KitFlow;
  appearance: "light" | "dark" | "both";
  /** The window's width the page lays out for, in px. */
  viewport: number;
  /** The scale it is drawn at: 1 is a pixel for a pixel. */
  zoom: number;
  /** The state shown, by its id; unset is the page's default, its first. */
  state: string | undefined;
  onStateChange: (state: string | undefined) => void;
}) {
  const states = flow.states !== undefined && flow.states.length > 0 ? flow.states : ONLY_STATE;
  const index = Math.max(
    0,
    states.findIndex((candidate) => candidate.id === state),
  );
  const current = states[index] ?? ONLY_STATE[0]!;
  const themes: readonly FlowTheme[] = appearance === "both" ? ["light", "dark"] : [appearance];
  const [mode, setMode] = useState<FlowMode>("one");
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  useHeldScroll(canvas);

  const pick = (id: string) => onStateChange(id === states[0]?.id ? undefined : id);
  const step = (by: number) => {
    const next = states[(index + by + states.length) % states.length];
    if (next !== undefined) pick(next.id);
  };

  const keys = useRef({ step, mode });
  useLayoutEffect(() => {
    keys.current = { step, mode };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (ownsArrows(event.target)) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        keys.current.step(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "Escape" && keys.current.mode === "grid") {
        setMode("one");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b px-6 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="m-0 truncate font-medium text-title">{flow.title}</h2>
            {flow.area === undefined ? null : <Badge tone="neutral">{flow.area}</Badge>}
          </div>
          <p className="m-0 flex min-w-0 items-center gap-1.5 truncate text-caption text-muted-foreground">
            <span className="truncate">
              {mode === "grid"
                ? `${states.length} ${states.length === 1 ? "state" : "states"}`
                : `State ${index + 1} of ${states.length}`}
              {` · ${viewport} px · ${Math.round(zoom * 100)}%`}
            </span>
            {states.length > 1 ? (
              <KbdGroup aria-label="Left and right arrows step through the states">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
              </KbdGroup>
            ) : null}
          </p>
        </div>
        {mode === "one" && states.length > 1 ? (
          <StateSwitcher current={current} onPick={pick} onStep={step} states={states} />
        ) : null}
        <div className="flex items-center gap-2">
          <ToggleGroup
            aria-label="View"
            value={[mode]}
            onValueChange={(next) => {
              const chosen = (["one", "grid"] as const).find((candidate) =>
                next.includes(candidate),
              );
              if (chosen !== undefined) setMode(chosen);
            }}
          >
            <Toggle aria-label="One state" value="one">
              <SquareIcon />
              State
            </Toggle>
            <Toggle aria-label="Every state" value="grid">
              <LayoutGridIcon />
              Grid
            </Toggle>
          </ToggleGroup>
          <Button
            render={
              <a
                href={flowSrc(flow, current, appearance === "both" ? undefined : appearance)}
                rel="noreferrer"
                target="_blank"
              />
            }
            size="sm"
            variant="secondary"
          >
            <ExternalLinkIcon />
            Open
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-muted" ref={setCanvas}>
        {mode === "grid" ? (
          <FlowGrid
            flow={flow}
            onOpen={(id) => {
              pick(id);
              setMode("one");
            }}
            root={canvas}
            shown={current.id}
            states={states}
            themes={themes}
            viewport={viewport}
          />
        ) : (
          <FlowCanvas
            canvas={canvas}
            current={current}
            flow={flow}
            themes={themes}
            viewport={viewport}
            zoom={zoom}
          />
        )}
      </div>
    </div>
  );
}

/** The state's page, centred on the ground, a window tall: light above dark when both show. */
function FlowCanvas({
  canvas,
  flow,
  current,
  themes,
  viewport,
  zoom,
}: {
  readonly canvas: HTMLElement | null;
  readonly flow: KitFlow;
  readonly current: KitFlowState;
  readonly themes: readonly FlowTheme[];
  readonly viewport: number;
  readonly zoom: number;
}) {
  const [room, setRoom] = useState(0);
  // The observer reports the canvas's height as it starts, then on every resize.
  useLayoutEffect(() => {
    if (canvas === null) return;
    const observer = new ResizeObserver(() => setRoom(canvas.clientHeight));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);

  const captioned = themes.length > 1;
  // Each frame is as tall as the canvas shows at this zoom: one page fills the view, like a window.
  const height = Math.max(
    SHORTEST_FRAME,
    Math.floor((room - CANVAS_PADDING * 2 - (captioned ? CAPTION_HEIGHT : 0)) / zoom),
  );
  if (room === 0) return null;

  return (
    <div className="flex w-fit min-w-full flex-col items-center gap-6 p-6">
      {themes.map((theme) => (
        <figure className="m-0 flex flex-col gap-2" key={theme}>
          {captioned ? (
            <figcaption className="text-caption text-muted-foreground">
              {theme === "light" ? "Light" : "Dark"}
            </figcaption>
          ) : null}
          <FlowFrame
            height={height}
            src={flowSrc(flow, current, theme)}
            title={`${flow.title}, ${current.label}, ${theme}`}
            width={viewport}
            zoom={zoom}
          />
        </figure>
      ))}
    </div>
  );
}

function StateSwitcher({
  states,
  current,
  onPick,
  onStep,
}: {
  readonly states: readonly KitFlowState[];
  readonly current: KitFlowState;
  readonly onPick: (id: string) => void;
  readonly onStep: (by: number) => void;
}) {
  if (states.length <= SEGMENTED_AT_MOST) {
    return (
      <ToggleGroup
        aria-label="State"
        value={[current.id]}
        onValueChange={(next) => {
          const chosen = next.find((id) => id !== current.id);
          if (chosen !== undefined) onPick(chosen);
        }}
      >
        {states.map((candidate) => (
          <Toggle key={candidate.id} value={candidate.id}>
            {candidate.label}
          </Toggle>
        ))}
      </ToggleGroup>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Button aria-label="Previous state" onClick={() => onStep(-1)} size="icon-sm" variant="ghost">
        <ChevronLeftIcon />
      </Button>
      <div className="w-64">
        <StatePicker current={current} onPick={onPick} states={states} />
      </div>
      <Button aria-label="Next state" onClick={() => onStep(1)} size="icon-sm" variant="ghost">
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/** Many states: a list found by typing, each with the query that shows it. */
function StatePicker({
  states,
  current,
  onPick,
}: {
  readonly states: readonly KitFlowState[];
  readonly current: KitFlowState;
  readonly onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const ids = states.map((candidate) => candidate.id);
  const byId = new Map(states.map((candidate) => [candidate.id, candidate]));
  const found =
    words === ""
      ? ids
      : states
          .filter(
            (candidate) =>
              candidate.label.toLowerCase().includes(words) ||
              candidate.search.toLowerCase().includes(words),
          )
          .map((candidate) => candidate.id);

  return (
    <Combobox
      filteredItems={found}
      itemToStringLabel={(id: string) => byId.get(id)?.label ?? id}
      items={ids}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      onValueChange={(id) => {
        if (id !== null) onPick(id);
      }}
      value={current.id}
    >
      <ComboboxTrigger aria-label="State" render={<SelectButton size="sm" />}>
        {current.label}
      </ComboboxTrigger>
      <ComboboxPopup align="center">
        <ComboboxSearchInput
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Find among ${states.length} states`}
          value={query}
        />
        <ComboboxEmpty>No state matches.</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => {
            const candidate = byId.get(id);
            return (
              <ComboboxItem key={id} value={id}>
                <span className="min-w-0 flex-1 truncate">{candidate?.label ?? id}</span>
                <code className="max-w-[50%] shrink-0 truncate font-mono text-caption text-muted-foreground">
                  {candidate === undefined || candidate.search === ""
                    ? "default"
                    : candidate.search}
                </code>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
