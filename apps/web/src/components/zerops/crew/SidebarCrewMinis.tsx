/**
 * A crew as mini Mates after its Mate's name, on the row's first line, like ducklings (the
 * approved board "Mate Menu by Project"): every crewmate's face at 15 px in its state, the one
 * asking at 17 px, the rest past four as "+N". A row never grows, and nothing moves when a crew
 * starts or ends.
 *
 * While they work they take turns, a small march: each working face's own turn
 * (`[data-mate-face-state="working"]` in index.css) on its own beat, one after another. One that
 * finishes while watched cheers once; one that comes to need the viewer turns out to face them
 * and rests in its asking pose. Only what was watched happening moves — never a reload, a first
 * paint or a crew starting — and with reduced motion every pose stands still.
 *
 * The minis sit inside the row's own button: they open nothing and take no focus. A pointer on
 * one shows its name and what it is doing; the crew's words ride in the row's accessible name.
 *
 * Read from HQ (`mateCrewAtom`, the source `useMateCrew` reads), one subscription per Mate,
 * or a crew handed in instead (a harness).
 */
import { useAtomValue } from "@effect/atom-react";
import { crewFaceWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import { Atom } from "effect/reactivity";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type ReactNode,
} from "react";

import { mateCrewAtom, type MateCrewRead } from "../../../zerops/crew/useCrew";
import { useZeropsSessionOptional } from "../../../zerops/ZeropsSessionProvider";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace } from "../primitives";
import {
  crewRowFacts,
  type CrewMini,
  type CrewRowFacts,
  type SidebarCrewRead,
} from "./SidebarCrewMinis.logic";

export type {
  CrewMini,
  CrewReviewItem,
  CrewRowFacts,
  SidebarCrewRead,
} from "./SidebarCrewMinis.logic";

/** A listed Mate whose crew the menu draws. */
export interface CrewRowMate {
  /** Its project: what HQ holds its overview under, and the key of its facts. */
  readonly projectId: string;
  /** Its Mate is the viewer's own (HQ's `waitsOnViewer`): only then does the crew need them. */
  readonly mine: boolean;
  /** A crew handed in instead of HQ's; absent, the row reads HQ's. */
  readonly read?: SidebarCrewRead | undefined;
}

/**
 * The facts of a crew as last derived, by the read they came from: a read HQ's atom keeps
 * (structurally shared, so the same object while nothing changes) yields the same facts, and
 * the menu's memoised rows stay put.
 */
const FACTS = new WeakMap<object, Map<string, CrewRowFacts | undefined>>();

function factsOf(
  source: MateCrewRead | SidebarCrewRead,
  mine: boolean,
  viewerSubject: string | undefined,
): CrewRowFacts | undefined {
  const key = `${String(mine)}\n${viewerSubject ?? ""}`;
  let held = FACTS.get(source);
  if (held === undefined) {
    held = new Map();
    FACTS.set(source, held);
  }
  if (held.has(key)) return held.get(key);
  const facts = crewRowFacts({
    crew: source.crew,
    logins: source.logins,
    current: "current" in source ? source.current : true,
    environmentId: source.environmentId,
    mine,
    viewerSubject,
  });
  held.set(key, facts);
  return facts;
}

const NO_READS = Atom.make((): ReadonlyArray<MateCrewRead> => []);

/**
 * Every listed Mate's crew facts at once (a group row needs its Mates' asks): one subscription
 * per Mate, keyed by its project; no Mate without a crew in the map. `read` hands a fixture in
 * instead of HQ's.
 */
export function useCrewRows(mates: ReadonlyArray<CrewRowMate>): ReadonlyMap<string, CrewRowFacts> {
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const held = [
    ...new Set(mates.flatMap((mate) => (mate.read === undefined ? [mate.projectId] : []))),
  ].join("\n");
  // The list's length changes between renders: one derived atom over the Mates' own, made anew
  // only when which Mates are listed changes.
  const readsAtom = useMemo(() => {
    const projectIds = held === "" ? [] : held.split("\n");
    return projectIds.length === 0
      ? NO_READS
      : Atom.make((get) => projectIds.map((projectId) => get(mateCrewAtom(projectId))));
  }, [held]);
  const reads = useAtomValue(readsAtom);
  const fromHq = new Map(
    held === "" ? [] : held.split("\n").map((id, index) => [id, reads[index]]),
  );
  const rows = new Map<string, CrewRowFacts>();
  for (const mate of mates) {
    const source = mate.read ?? fromHq.get(mate.projectId);
    if (source === undefined) continue;
    const facts = factsOf(source, mate.mine, viewerSubject);
    if (facts !== undefined) rows.set(mate.projectId, facts);
  }
  return rows;
}

/** Reduced motion, or nowhere to ask: an event moves a face only where motion is welcome. */
function prefersStill(): boolean {
  return (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Greeting = { readonly kind: "cheer" | "turn"; readonly run: number };

/**
 * The event each mini greets now: a cheer for work that ended, a turn-out for an ask that
 * arrived — only for a change watched between two read states, never on a first paint, from a
 * stand-in, or with reduced motion. A greeting ends with its animation, or as soon as the
 * crewmate's state moves on.
 */
function useGreetings(
  minis: ReadonlyArray<CrewMini>,
  known: boolean,
): {
  readonly greetings: ReadonlyMap<string, Greeting>;
  readonly end: (id: string) => void;
} {
  const states = minis.map((mini) => `${mini.id}:${mini.state}`).join("\n");
  const [seen, setSeen] = useState(() => ({
    states,
    known,
    by: new Map(minis.map((mini) => [mini.id, mini.state])),
    greetings: new Map<string, Greeting>(),
    runs: 0,
  }));
  if (seen.states !== states || seen.known !== known) {
    const live = seen.known && known && !prefersStill();
    const greetings = new Map<string, Greeting>();
    let runs = seen.runs;
    for (const mini of minis) {
      const before = seen.by.get(mini.id);
      const held = seen.greetings.get(mini.id);
      if (live && before === "working" && mini.state === "idle") {
        greetings.set(mini.id, { kind: "cheer", run: (runs += 1) });
      } else if (live && before !== "needs" && mini.state === "needs") {
        greetings.set(mini.id, { kind: "turn", run: (runs += 1) });
      } else if (
        held !== undefined &&
        known &&
        (held.kind === "cheer" ? mini.state === "idle" : mini.state === "needs")
      ) {
        greetings.set(mini.id, held);
      }
    }
    setSeen({
      states,
      known,
      by: new Map(minis.map((mini) => [mini.id, mini.state])),
      greetings,
      runs,
    });
  }
  const end = (id: string) =>
    setSeen((current) => {
      if (!current.greetings.has(id)) return current;
      const greetings = new Map(current.greetings);
      greetings.delete(id);
      return { ...current, greetings };
    });
  return { greetings: seen.greetings, end };
}

/** The working march's period: the face's own working turn (`mate-face-turn`, 2.4 s). */
const TURN_PERIOD_S = 2.4;
/** One beat of `--mate-face-phase`, as the turn's delay counts it (`-0.18s` a beat). */
const PHASE_BEAT_S = 0.18;

/**
 * The beat of the `index`-th of `count` working minis, so their turns fall one after another
 * across the face's working period, left to right.
 */
function marchPhase(index: number, count: number): number {
  return (((count - index) % count) * (TURN_PERIOD_S / count)) / PHASE_BEAT_S;
}

/**
 * Where each mini stood, so one that changes place — an asking crewmate moving to the front,
 * its neighbours making room — travels there instead of jumping (FLIP, on `translate`, which the
 * cheer's and the turn's `transform` leave alone). Measured after every render: a row's minis
 * render only when its crew's facts change.
 */
function useTravel() {
  const box = useRef<HTMLSpanElement>(null);
  const placed = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const before = placed.current;
    const now = new Map<string, number>();
    const still = prefersStill();
    for (const mini of element.querySelectorAll<HTMLElement>("[data-crew-mini]")) {
      const id = mini.dataset.crewMini ?? "";
      const left = mini.offsetLeft;
      now.set(id, left);
      const was = before.get(id);
      if (still || was === undefined || was === left || typeof mini.animate !== "function")
        continue;
      mini.animate([{ translate: `${was - left}px 0` }, { translate: "0 0" }], {
        duration: 220,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
    }
    placed.current = now;
  });
  return box;
}

/** The ducklings: inline, after the Mate's name, on its first line; nothing for no crew. */
export function SidebarCrewMinis({ facts }: { readonly facts: CrewRowFacts }): ReactNode {
  const { greetings, end } = useGreetings(facts.minis, facts.known);
  const box = useTravel();
  const working = facts.minis.filter((mini) => mini.state === "working");
  return (
    <span className="menu-minis" data-zerops-surface="sidebar-crew-minis" ref={box}>
      <span className="sr-only">{facts.words}</span>
      {facts.minis.map((mini) => {
        const greeting = greetings.get(mini.id);
        const march = working.indexOf(mini);
        const pose = greeting?.kind === "cheer" ? "done" : mini.state;
        const ended = (event: AnimationEvent<HTMLSpanElement>) => {
          if (event.target !== event.currentTarget) return;
          if (event.animationName.startsWith("menu-mini-")) end(mini.id);
        };
        return (
          <Tooltip key={mini.id}>
            <TooltipTrigger
              render={
                <span
                  aria-hidden="true"
                  className="menu-mini"
                  data-crew-mini={mini.id}
                  data-crew-mini-state={mini.state}
                />
              }
            >
              {/* Drawn afresh for each greeting, so the same one can play twice running. */}
              <span
                className="menu-mini-body"
                data-crew-mini-greet={greeting?.kind}
                key={greeting?.run ?? 0}
                onAnimationEnd={ended}
              >
                <MateFace
                  className="size-full"
                  known={facts.known}
                  shape={mini.shape}
                  size="dot"
                  state={pose}
                  style={
                    march < 0
                      ? undefined
                      : ({
                          "--mate-face-phase": String(marchPhase(march, working.length)),
                        } as CSSProperties)
                  }
                  tint={mini.tint}
                />
              </span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {mini.doing === undefined
                ? crewFaceWord(mini.name, mini.lead)
                : `${crewFaceWord(mini.name, mini.lead)} · ${mini.doing}`}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      {facts.more > 0 ? (
        <span aria-hidden="true" className="menu-mini-more">
          +{facts.more}
        </span>
      ) : null}
    </span>
  );
}
