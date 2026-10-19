/**
 * A project's state line — the one most urgent fact about it, and why it needs you — and the words
 * its places say on its card and its page: production's status line, each stage's row.
 *
 * Pure: no React, no clock of its own.
 */
import {
  changeAsksForReview,
  type GroupFlow,
  type GroupFlowMate,
} from "@t3tools/client-runtime/zerops";

import type { PlaceLine } from "./projectCard.logic";

/** The project's one state, most urgent first. */
export type ProjectStateKind =
  | "release-failed"
  | "down"
  | "needs-you"
  | "setting-up"
  | "releasing"
  | "running"
  | "in-development";

export interface ProjectState {
  readonly kind: ProjectStateKind;
  /** Said in small caps above the project's name. */
  readonly words: string;
  /** Why it needs you, after its words: "1 change in review", "2 ready to release". */
  readonly reason?: string;
  /** Its dot, as a place's dot reads (`PlaceDot`). */
  readonly dot: "failed" | "down" | "attention" | "unknown" | "releasing" | "running" | "none";
}

const STATES: Record<ProjectStateKind, Omit<ProjectState, "kind">> = {
  "release-failed": { words: "Release failed", dot: "down" },
  down: { words: "Down", dot: "down" },
  "needs-you": { words: "Needs you", dot: "attention" },
  "setting-up": { words: "Setting up", dot: "unknown" },
  releasing: { words: "Releasing", dot: "releasing" },
  running: { words: "Running", dot: "running" },
  "in-development": { words: "In development", dot: "none" },
};

/**
 * The project's one state: production's trouble first — a failed release, services down — then
 * what waits on the viewer — a Mate, a change, a release ready to go, its reason beside it — then
 * a first Mate still setting up while nothing runs, then what production does; a project that runs
 * nowhere yet is in development.
 */
export function projectState(input: {
  /** Production's line (`placeLines`). */
  readonly production: Pick<PlaceLine, "dot" | "trouble">;
  /** A Mate's lift or a change waits on the viewer. */
  readonly waitsOnYou: boolean;
  readonly mates: ReadonlyArray<Pick<GroupFlowMate, "coming">>;
  /** Its code changes in review (`inReview`). */
  readonly review?: number | undefined;
  /** A release production waits for (`cardReady`). */
  readonly ready?: { readonly count: number; readonly atLeast: boolean } | undefined;
  /** The Mates that wait on the viewer's answer, by name. */
  readonly asking?: ReadonlyArray<string> | undefined;
}): ProjectState {
  const { production } = input;
  const review = input.review ?? 0;
  const kind: ProjectStateKind =
    production.trouble && production.dot === "down"
      ? "down"
      : production.trouble
        ? "release-failed"
        : input.waitsOnYou || input.ready !== undefined
          ? "needs-you"
          : production.dot !== "running" &&
              input.mates.length > 0 &&
              input.mates.every((mate) => mate.coming !== undefined)
            ? "setting-up"
            : production.dot === "releasing"
              ? "releasing"
              : production.dot === "running"
                ? "running"
                : "in-development";
  // Why it needs you, said beside it: a change in review first, then a release ready to go.
  // Why it needs you, by what made it: a Mate asking, then a change waiting on the viewer — both
  // only where something waits on them — then a release ready to go.
  const asking = input.asking ?? [];
  const reason =
    kind !== "needs-you"
      ? undefined
      : input.waitsOnYou && asking.length > 0
        ? `${joined(asking)} ${asking.length === 1 ? "asks" : "ask"}`
        : input.waitsOnYou && review > 0
          ? inReviewWords(review)
          : input.ready === undefined
            ? undefined
            : readyWords(input.ready.count, input.ready.atLeast);
  return { kind, ...STATES[kind], ...(reason === undefined ? {} : { reason }) };
}

/** How many of a project's open code changes wait in review: none still being written. */
export function inReview(flow: Pick<GroupFlow, "pullRequests">): number {
  return flow.pullRequests.filter(
    (entry) => entry.pull.kind === "code" && changeAsksForReview(entry.pull),
  ).length;
}

/** "1 change in review", "2 changes in review". */
export function inReviewWords(count: number): string {
  return `${String(count)} change${count === 1 ? "" : "s"} in review`;
}

/** "2 ready to release"; "At least 20 ready to release" where the count is a floor. */
export function readyWords(count: number, atLeast: boolean): string {
  return `${atLeast ? "At least " : ""}${String(count)} ready to release`;
}

/** "Release 2": the door to the release production waits for, with its count. */
export function releaseWords(count: number, atLeast: boolean): string {
  return `Release ${String(count)}${atLeast ? "+" : ""}`;
}

/** A place's one status line: its words, and whether they say trouble. */
export interface PlaceWordsReading {
  readonly words: ReadonlyArray<string>;
  readonly tone: "muted" | "failed" | "info";
}

/**
 * What a stage says on its row: "Deployed 19m ago · follows main" while it runs; otherwise its
 * line's first words ("Deploying…", "Deploy failed") and the source it follows, each stage of
 * several said for itself.
 */
export function stageWords(
  line: Pick<PlaceLine, "dot" | "words" | "trouble">,
  facts: { readonly source: string | undefined; readonly age: string | undefined },
): PlaceWordsReading {
  const follows = `follows ${facts.source ?? "main"}`;
  if (line.dot === "running")
    return {
      words: [facts.age === undefined ? "Deployed" : `Deployed ${facts.age} ago`, follows],
      tone: "muted",
    };
  return {
    words: [...line.words.slice(0, 1), follows],
    tone: line.trouble ? "failed" : line.dot === "releasing" ? "info" : "muted",
  };
}

/**
 * What production's status line says: "Running · v0.1.3 · up 6d" while it runs; still what it
 * runs after a failed release; "Not released yet" where nothing runs; otherwise its line's words.
 */
export function productionWords(
  line: Pick<PlaceLine, "dot" | "words" | "trouble">,
  facts: { readonly version: string | undefined; readonly up: string | undefined },
): ReadonlyArray<string> {
  const up = facts.up === undefined ? undefined : `up ${facts.up}`;
  if (line.dot === "running" && facts.version !== undefined)
    return ["Running", facts.version, ...(up === undefined ? [] : [up])];
  if (line.trouble && line.dot !== "down" && facts.version !== undefined)
    return [line.words[0] ?? "Release failed", `still runs ${facts.version}`];
  if (line.dot === "none") return ["Not released yet"];
  return line.words;
}

/** "Kai is free", "Kai and Ida are free", "Kai, Ida and Uma are free". */
export function freeWords(names: ReadonlyArray<string>): string {
  return `${joined(names)} ${names.length === 1 ? "is" : "are"} free`;
}

/**
 * The automated Mates in one line: "Odo works on a task", "Odo and Tess work on tasks" while any
 * works; else "Odo waits for your review" while a change of theirs waits for it (HQ hands it a task
 * only once no Mate without one is free); else "2 automated Mates wait for a task".
 */
export function automatedWords(
  mates: ReadonlyArray<{
    readonly name: string;
    readonly working: boolean;
    readonly reviewing?: boolean;
  }>,
): string {
  const working = mates.filter((mate) => mate.working).map((mate) => mate.name);
  if (working.length === 1) return `${working[0] ?? ""} works on a task`;
  if (working.length > 1) return `${joined(working)} work on tasks`;
  const reviewing = mates.filter((mate) => mate.reviewing === true).map((mate) => mate.name);
  if (reviewing.length > 0)
    return `${joined(reviewing)} ${reviewing.length === 1 ? "waits" : "wait"} for your review`;
  return mates.length === 1
    ? `${mates[0]?.name ?? ""} waits for a task`
    : `${String(mates.length)} automated Mates wait for a task`;
}

const joined = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
