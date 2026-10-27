/**
 * A stand-up call's progress as its Mate relays it: zcp writes, service by
 * service, the step each is on — build, deploy, verify — its state and the
 * platform process running it, into its status file, and the Mate's server
 * relays every change as the call's one `tool.progress` row
 * (`apps/server/src/zerops/ZeropsStandUpRelay.ts`, `payload.zeropsStandUp`).
 *
 * zcp's own word, so it is preferred over the reading the client pieces
 * together from the project's topology and processes (`standupReading.ts`),
 * which needs the platform socket and guesses which builds are the call's.
 * A Mate older than the relay sends none, and the card reads as before.
 *
 * Pure: the row's payload in, the reading out.
 */
import type { ActivityProcess } from "./dto.ts";
import {
  sentenceOf,
  standupReadingOf,
  type StandupReading,
  type StandupServiceRow,
} from "./standupReading.ts";

export type StandUpProgressStep = "build" | "deploy" | "verify";

export interface StandUpProgressService {
  readonly hostname: string;
  readonly step: StandUpProgressStep;
  readonly state: "pending" | "running" | "done" | "failed";
  /** The platform process running its step; empty when none runs. */
  readonly processId: string;
  /** When it reached this step's state; empty when not said. */
  readonly at: string;
  readonly error?: string;
}

export interface StandUpProgress {
  readonly phase: string;
  readonly state: string;
  readonly services: ReadonlyArray<StandUpProgressService>;
}

const STEPS: ReadonlyArray<StandUpProgressStep> = ["build", "deploy", "verify"];
const STATES: ReadonlyArray<StandUpProgressService["state"]> = [
  "pending",
  "running",
  "done",
  "failed",
];

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** `payload.zeropsStandUp` of a progress row, read tolerantly; `undefined` when it is none. */
export function readStandUpProgress(payload: unknown): StandUpProgress | undefined {
  const progress = record(record(payload)?.["zeropsStandUp"]);
  if (progress === undefined) return undefined;
  const services = Array.isArray(progress["services"]) ? progress["services"] : [];
  return {
    phase: text(progress["phase"]),
    state: text(progress["state"]),
    services: services.flatMap((value): StandUpProgressService[] => {
      const service = record(value);
      const step = STEPS.find((candidate) => candidate === service?.["step"]);
      const state = STATES.find((candidate) => candidate === service?.["state"]);
      const hostname = text(service?.["hostname"]);
      if (step === undefined || state === undefined || hostname === "") return [];
      const error = text(service?.["error"]);
      return [
        {
          hostname,
          step,
          state,
          processId: text(service?.["processId"]),
          at: text(service?.["at"]),
          ...(error === "" ? {} : { error }),
        },
      ];
    }),
  };
}

const RUNNING_WORDS: Readonly<Record<StandUpProgressStep, string>> = {
  build: "Building",
  deploy: "Deploying",
  verify: "Verifying",
};

/** What comes after a step that is done: the next one, or nothing — it is up. */
const NEXT: Readonly<Record<StandUpProgressStep, StandUpProgressStep | undefined>> = {
  build: "deploy",
  deploy: "verify",
  verify: undefined,
};

function rowOf(
  service: StandUpProgressService,
  processes: ReadonlyArray<ActivityProcess> | undefined,
  nowMs: number,
): StandupServiceRow {
  const { hostname } = service;
  const at = service.at === "" ? {} : { startedAt: service.at };
  switch (service.state) {
    case "pending":
      return { hostname, state: "waits" };
    case "failed":
      return {
        hostname,
        state: "failed",
        ...at,
        ...(service.error === undefined ? {} : { reason: service.error }),
      };
    case "done": {
      const next = NEXT[service.step];
      return next === undefined
        ? { hostname, state: "up" }
        : { hostname, state: "building", ...at, sentence: RUNNING_WORDS[next] };
    }
    case "running": {
      // The build's own step, in the Zerops GUI's words, when its process is read here too.
      const process =
        service.processId === ""
          ? undefined
          : processes?.find((candidate) => candidate.id === service.processId);
      const sentence =
        (process === undefined ? undefined : sentenceOf(process, hostname, nowMs)) ??
        RUNNING_WORDS[service.step];
      return { hostname, state: "building", ...at, sentence };
    }
  }
}

/** The reading of a call's relayed progress: one row per service, in zcp's order. */
export function standupReadingFromProgress(
  progress: StandUpProgress,
  read: { readonly processes?: ReadonlyArray<ActivityProcess>; readonly nowMs: number },
): StandupReading {
  return standupReadingOf(
    progress.services.map((service) => rowOf(service, read.processes, read.nowMs)),
  );
}
