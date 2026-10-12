/**
 * Setting up a person's Chief, as three steps:
 *
 * 1. **project** — its project and zcp container, made by the new-project path (a New project
 *    tagged `chief`, its zcp told `ZCP_CHIEF` and `ZCP_ORG_ID`);
 * 2. **hq** — HQ records it as the person's Chief and hands back the credential and proxy its zcp
 *    reaches the organization through (`POST /api/chief`);
 * 3. **variables** — those two written onto its zcp service as the person (`ZCP_ORG_API`,
 *    `ZCP_ORG_TOKEN`), the vault's own write.
 *
 * A step that stops says why, and *Try again* resumes there: the project's creation resumes on the
 * same project, never a second; past it, HQ is asked again, for the credential is never kept — a
 * second ask replaces the first and revokes its credential.
 */
import type { VaultWrite } from "@t3tools/client-runtime/data";
import { isZcpServiceType } from "@t3tools/client-runtime/zerops/topology";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import type { BirthLineStep } from "../ZeropsBirthProgress.logic";

export type ChiefSetupStep = "project" | "hq" | "variables";

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
  | { readonly type: "hq-answered" }
  | { readonly type: "variables-written" }
  /** The running step stopped. */
  | { readonly type: "failed"; readonly reason: string }
  | { readonly type: "again" }
  /** Its project stands, recorded or not, but its zcp holds no access: HQ is asked again. */
  | { readonly type: "resume"; readonly projectId: string };

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
    case "hq-answered":
      return setup.phase === "running" && setup.step === "hq"
        ? { ...setup, step: "variables" }
        : setup;
    case "variables-written":
      return setup.phase === "running" && setup.step === "variables" && setup.projectId !== null
        ? { phase: "done", birthId: setup.birthId, projectId: setup.projectId }
        : setup;
    case "failed":
      return setup.phase === "running"
        ? { ...setup, phase: "failed", reason: event.reason }
        : setup;
    case "resume":
      return setup.phase === "idle"
        ? {
            phase: "running",
            step: "hq",
            birthId: `resume:${event.projectId}`,
            projectId: event.projectId,
          }
        : setup;
    case "again":
      if (setup.phase !== "failed") return setup;
      return {
        phase: "running",
        // Past its project, HQ is asked again: the credential it handed was never kept.
        step: setup.step === "project" ? "project" : "hq",
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
  {
    id: "project",
    label: "Its project and container",
    doing: "Making its project and container",
  },
  { id: "hq", label: "Your Chief, at HQ", doing: "Recording it as your Chief" },
  {
    id: "variables",
    label: "Its view of your organization",
    doing: "Handing it what you can see",
  },
];

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

/** Its zcp service among its project's: the one there is, or none while not one is listed. */
export function chiefServiceOf(
  services:
    | ReadonlyArray<{
        readonly id: string;
        readonly serviceStackTypeInfo?: { readonly serviceStackTypeVersionName?: string } | null;
      }>
    | undefined,
): string | undefined {
  const zcp = (services ?? []).filter((service) =>
    isZcpServiceType(service.serviceStackTypeInfo?.serviceStackTypeVersionName ?? ""),
  );
  return zcp.length === 1 ? zcp[0]!.id : undefined;
}

export interface ChiefVariable {
  readonly key: string;
  readonly value: string;
  readonly sensitive: boolean;
}

/** What its zcp is handed: HQ's proxy in the open, the credential as a secret. */
export function chiefVariables(answer: {
  readonly proxyUrl: string;
  readonly credential: string;
}): ReadonlyArray<ChiefVariable> {
  return [
    { key: "ZCP_ORG_API", value: answer.proxyUrl, sensitive: false },
    { key: "ZCP_ORG_TOKEN", value: answer.credential, sensitive: true },
  ];
}

/**
 * The vault writes that hand its zcp `values`: each added, or written over where the service holds
 * it already (`ids`, by key) — a stopped setup's, whose credential HQ has since revoked.
 */
export function chiefVariableWrites(
  values: ReadonlyArray<ChiefVariable>,
  ids: Readonly<Record<string, string>>,
): ReadonlyArray<VaultWrite> {
  return values.map(({ key, value, sensitive }): VaultWrite => {
    const id = ids[key];
    return id === undefined
      ? { kind: "add", key, value, sensitive }
      : { kind: "update", id, key, value, sensitive };
  });
}

/**
 * Steps 2 and 3 on a made project: HQ records it, then its zcp is handed what HQ answered. The
 * credential lives in this call only; a failure says why and keeps nothing.
 */
export async function finishChiefSetup(input: {
  readonly projectId: string;
  readonly setChief: (
    projectId: string,
  ) => Promise<{ readonly credential: string; readonly proxyUrl: string }>;
  readonly writeVariables: (values: ReadonlyArray<ChiefVariable>) => Promise<void>;
  readonly dispatch: (event: ChiefSetupEvent) => void;
}): Promise<void> {
  let answer: { readonly credential: string; readonly proxyUrl: string };
  try {
    answer = await input.setChief(input.projectId);
  } catch (cause) {
    input.dispatch({ type: "failed", reason: zeropsErrorMessage(cause) });
    return;
  }
  input.dispatch({ type: "hq-answered" });
  try {
    await input.writeVariables(chiefVariables(answer));
  } catch (cause) {
    input.dispatch({ type: "failed", reason: zeropsErrorMessage(cause) });
    return;
  }
  input.dispatch({ type: "variables-written" });
}
