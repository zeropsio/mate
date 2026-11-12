/**
 * Setting up a person's Chief, as three steps:
 *
 * 1. **project** — its project and zcp container, made by the new-project path (a New project
 *    tagged `chief`);
 * 2. **hq** — HQ registers it as the person's Chief (`PUT /api/chief`). The registration carries no
 *    key: its zcp reads its Chief from its Mate state and enters org mode itself (spec-mate §2.11,
 *    §3.11).
 * 3. **access** — HQ makes a personal token with the person's own access and keeps it for their
 *    Chief to read with (`PUT /api/chief/token`); the token never reaches this client. Where it
 *    stops, the Chief stays registered and its header offers the same ask (`ChiefAccessButton`).
 *
 * A step that stops says why, and *Try again* resumes there: the project's creation resumes on the
 * same project, never a second; past it, HQ is asked again — a second registration answers the
 * same one, a second token replaces the first.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import type { BirthLineStep } from "../ZeropsBirthProgress.logic";

export type ChiefSetupStep = "project" | "hq" | "access";

export type ChiefSetup =
  | { readonly phase: "idle" }
  | {
      readonly phase: "running";
      readonly step: ChiefSetupStep;
      /** The new-project creation making its project. */
      readonly birthId: string;
      /** Its project, once the platform took it. */
      readonly projectId: string | null;
    }
  | {
      readonly phase: "failed";
      readonly step: ChiefSetupStep;
      readonly birthId: string;
      readonly projectId: string | null;
      /** Why, in plain words. */
      readonly reason: string;
    }
  | { readonly phase: "done"; readonly birthId: string; readonly projectId: string };

export type ChiefSetupEvent =
  | { readonly type: "start"; readonly birthId: string }
  /** Its project and zcp service are made. */
  | { readonly type: "project-made"; readonly projectId: string }
  /** HQ holds its project as the person's Chief. */
  | { readonly type: "registered" }
  /** HQ keeps a token of the person's for it to read with. */
  | { readonly type: "access-kept" }
  /** HQ now supplies the completed Chief; setup no longer owns its existence. */
  | { readonly type: "observed"; readonly projectId: string }
  /** The running step stopped. */
  | { readonly type: "failed"; readonly reason: string }
  | { readonly type: "again" };

export const CHIEF_SETUP_IDLE: ChiefSetup = { phase: "idle" };

/** Where the setup goes on `event`; an event its state does not await changes nothing. */
export function chiefSetupAfter(setup: ChiefSetup, event: ChiefSetupEvent): ChiefSetup {
  switch (event.type) {
    case "start":
      return setup.phase === "idle"
        ? { phase: "running", step: "project", birthId: event.birthId, projectId: null }
        : setup;
    case "project-made":
      return setup.phase === "running" && setup.step === "project"
        ? { ...setup, step: "hq", projectId: event.projectId }
        : setup;
    case "registered":
      return setup.phase === "running" && setup.step === "hq"
        ? { ...setup, step: "access" }
        : setup;
    case "access-kept":
      return setup.phase === "running" && setup.step === "access" && setup.projectId !== null
        ? { phase: "done", birthId: setup.birthId, projectId: setup.projectId }
        : setup;
    case "observed":
      return setup.phase === "done" && setup.projectId === event.projectId
        ? CHIEF_SETUP_IDLE
        : setup;
    case "failed":
      return setup.phase === "running"
        ? { ...setup, phase: "failed", reason: event.reason }
        : setup;
    case "again":
      if (setup.phase !== "failed") return setup;
      return {
        phase: "running",
        step: setup.step,
        birthId: setup.birthId,
        projectId: setup.projectId,
      };
  }
}

const STEPS: ReadonlyArray<{
  readonly id: ChiefSetupStep;
  readonly label: string;
  readonly doing: string;
}> = [
  { id: "project", label: "Its workspace", doing: "Making its workspace" },
  { id: "hq", label: "Named your Chief", doing: "Registering it as your Chief" },
  { id: "access", label: "Given your access", doing: "Giving it your access" },
];

/** Each step's words while it runs, in order: the progress row's steps. */
export const CHIEF_SETUP_DOING: ReadonlyArray<string> = STEPS.map((step) => step.doing);

/** The setup's own steps as measured (about two minutes): what its row promises. */
export const CHIEF_SETUP_ESTIMATE_MS = 135_000;

/** The dialog's steps, each waiting, active, done or failed with its reason. */
export function chiefSetupSteps(setup: ChiefSetup): ReadonlyArray<BirthLineStep> {
  const at =
    setup.phase === "idle"
      ? -1
      : setup.phase === "done"
        ? STEPS.length
        : STEPS.findIndex((step) => step.id === setup.step);
  return STEPS.map((step, index): BirthLineStep => {
    if (index < at) return { id: step.id, label: step.label, state: "done" };
    if (index > at || setup.phase === "idle")
      return { id: step.id, label: step.label, state: "waiting" };
    return setup.phase === "failed"
      ? { id: step.id, label: step.label, state: "failed", detail: setup.reason }
      : { id: step.id, label: step.label, state: "active", detail: step.doing };
  });
}

/** What the new-project path shows of the Chief's project, as the setup reads it. */
export interface ChiefProjectInput {
  readonly creation:
    | {
        readonly projectId: string | null;
        readonly failed: { readonly reason: string } | null;
      }
    | undefined;
  readonly press:
    | {
        readonly state:
          | { readonly kind: "pressing" | "pressed" }
          | { readonly kind: "failed"; readonly reason: string };
        readonly progress?: ReadonlyArray<{
          readonly step: { readonly kind: string };
          readonly state: string;
        }>;
      }
    | undefined;
}

/**
 * Whether the Chief's project is made: once the platform took it and its container was added, or
 * its press is through; why, where its creation or press stopped.
 */
export function chiefProjectProgress(
  input: ChiefProjectInput,
):
  | { readonly kind: "waiting" }
  | { readonly kind: "made"; readonly projectId: string }
  | { readonly kind: "failed"; readonly reason: string } {
  const { creation, press } = input;
  if (creation?.failed != null) return { kind: "failed", reason: creation.failed.reason };
  if (creation === undefined || creation.projectId === null || press === undefined)
    return { kind: "waiting" };
  if (press.state.kind === "failed") return { kind: "failed", reason: press.state.reason };
  const added =
    press.state.kind === "pressed" ||
    (press.progress ?? []).some(
      (entry) => entry.step.kind === "import-container" && entry.state === "done",
    );
  return added ? { kind: "made", projectId: creation.projectId } : { kind: "waiting" };
}

/**
 * Steps 2 and 3, HQ's: step 2 registers the made project as the person's Chief, step 3 has HQ make
 * and keep the person's token for it. A failure says why; a registration it made stays.
 */
export async function finishChiefSetup(input: {
  readonly step: Exclude<ChiefSetupStep, "project">;
  readonly setChief: () => Promise<unknown>;
  readonly keepAccess: () => Promise<unknown>;
  readonly dispatch: (event: ChiefSetupEvent) => void;
}): Promise<void> {
  try {
    if (input.step === "hq") {
      await input.setChief();
      input.dispatch({ type: "registered" });
    }
    await input.keepAccess();
  } catch (cause) {
    input.dispatch({ type: "failed", reason: zeropsErrorMessage(cause) });
    return;
  }
  input.dispatch({ type: "access-kept" });
}
