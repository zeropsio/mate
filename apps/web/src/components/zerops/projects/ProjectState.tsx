/**
 * A project's state line (`projectRoad.logic.ts`): its one most urgent fact in small caps, its dot
 * before it and why it needs you after it — and a place's dot, as its card and its page draw it.
 */
import type { PlaceLine } from "./projectCard.logic";
import type { ProjectState } from "./projectRoad.logic";

/** The project's one state in small caps, its dot before it, its reason after it. */
export function ProjectStateLine({ state }: { readonly state: ProjectState }) {
  return (
    <p className="pp-road-state" data-state={state.kind} data-zerops-surface="project-state">
      <i aria-hidden="true" className="ov-dot" data-dot={state.dot} />
      <span>{state.reason === undefined ? state.words : `${state.words} · ${state.reason}`}</span>
    </p>
  );
}

/** A place's dot: green running, amber failed, red down, blue releasing, hollow when none. */
export function PlaceDot({ dot }: { readonly dot: PlaceLine["dot"] }) {
  return <i aria-hidden="true" className="ov-dot" data-dot={dot} />;
}
