/**
 * Setting up a person's Chief, as this tab sees it: one Create at HQ (`create-birth`, placed as the
 * person's Chief). HQ runs its birth — its project and zcp container — and registers it as the
 * person's Chief with its placement, whether this tab stays or not; from the moment HQ lists that
 * birth, the birth itself states the setup on every device (`useOwnChiefBirth`). This tab holds
 * only what comes before and after it: its Create on its way, HQ's refusal of it, and the project
 * HQ's birth made, until the person's Chief is observed there.
 *
 * A Create that stops says why, and *Try again* sends the same Create under the same birth id:
 * HQ makes it once.
 */
import { birthStopped, type SharedBirth } from "@t3tools/client-runtime/data";
import type { BirthLineStep } from "@t3tools/client-runtime/zerops/birthProgress";

export type ChiefSetup =
  | { readonly phase: "idle" }
  | {
      readonly phase: "running";
      /** The birth HQ makes the Chief under: its Create's id. */
      readonly birthId: string;
    }
  | {
      readonly phase: "failed";
      readonly birthId: string;
      /** Why, in plain words. */
      readonly reason: string;
    }
  /** HQ's birth made its project: the setup waits for the person's Chief to be observed there. */
  | { readonly phase: "done"; readonly birthId: string; readonly projectId: string };

export type ChiefSetupEvent =
  | { readonly type: "start"; readonly birthId: string }
  /** HQ's birth made the Chief's project. */
  | { readonly type: "made"; readonly projectId: string }
  /** HQ's birth stopped before its Chief was made: its own row says why and offers its ways on. */
  | { readonly type: "released" }
  /**
   * HQ now supplies the person's Chief; setup no longer owns its existence — even where this tab
   * never saw HQ's birth make its project (a stream down meanwhile, an answer lost).
   */
  | { readonly type: "observed"; readonly projectId: string }
  /** Its Create stopped: HQ refused it, or did not answer. */
  | { readonly type: "failed"; readonly reason: string }
  | { readonly type: "again" };

export const CHIEF_SETUP_IDLE: ChiefSetup = { phase: "idle" };

/** Where the setup goes on `event`; an event its state does not await changes nothing. */
export function chiefSetupAfter(setup: ChiefSetup, event: ChiefSetupEvent): ChiefSetup {
  switch (event.type) {
    case "start":
      return setup.phase === "idle" ? { phase: "running", birthId: event.birthId } : setup;
    case "made":
      // A Create HQ took though its answer never came back is made all the same.
      return setup.phase === "running" || setup.phase === "failed"
        ? { phase: "done", birthId: setup.birthId, projectId: event.projectId }
        : setup;
    case "released":
      return CHIEF_SETUP_IDLE;
    case "observed":
      // Its end, whatever this tab saw of HQ's birth on the way: *Set up Chief* is offered only to
      // a person with none, so a Chief observed now is this setup's. Once made, on its project.
      if (setup.phase === "idle") return setup;
      return setup.phase !== "done" || setup.projectId === event.projectId
        ? CHIEF_SETUP_IDLE
        : setup;
    case "failed":
      return setup.phase === "running"
        ? { phase: "failed", birthId: setup.birthId, reason: event.reason }
        : setup;
    case "again":
      return setup.phase === "failed" ? { phase: "running", birthId: setup.birthId } : setup;
  }
}

/** The one step this tab shows: its Create, until HQ's birth states the rest. */
const STEP = { id: "project", label: "Its workspace", doing: "Making its workspace" } as const;

/** Each step's words while it runs, in order: the progress row's steps. */
export const CHIEF_SETUP_DOING: ReadonlyArray<string> = [STEP.doing];

/** The setup's own steps as measured (about two minutes): what its row promises. */
export const CHIEF_SETUP_ESTIMATE_MS = 135_000;

/** The dialog's steps, each waiting, active, done or failed with its reason. */
export function chiefSetupSteps(setup: ChiefSetup): ReadonlyArray<BirthLineStep> {
  const { id, label } = STEP;
  switch (setup.phase) {
    case "idle":
      return [{ id, label, state: "waiting" }];
    case "running":
      return [{ id, label, state: "active", detail: STEP.doing }];
    case "failed":
      return [{ id, label, state: "failed", detail: setup.reason }];
    case "done":
      return [{ id, label, state: "done" }];
  }
}

/**
 * What HQ's birth of the Chief says to the setup: made once it took its project, released once it
 * stopped — its own row then says why and offers its ways on — and nothing before either.
 */
export function chiefBirthEvent(
  birth:
    | {
        readonly projectId: string | null;
        readonly state: SharedBirth["state"];
      }
    | undefined,
): Extract<ChiefSetupEvent, { readonly type: "made" | "released" }> | null {
  if (birth === undefined) return null;
  if (birthStopped(birth.state)) return { type: "released" };
  return birth.projectId === null ? null : { type: "made", projectId: birth.projectId };
}
