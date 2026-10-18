/**
 * A project's state line and its road: the one most urgent fact about it, and the three stops its
 * code travels — Development, Stage, Production — with what waits between them.
 *
 * The road's shape never changes: a stop that does not exist yet is a ghost, so cards side by side
 * line up. What a stop says under it is one quiet line, from its place's reading (`PlaceLine`).
 *
 * Pure: no React, no clock of its own.
 */
import type { GroupFlow, GroupFlowMate } from "@t3tools/client-runtime/zerops";

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
 * what waits on the viewer, then a first Mate still setting up while nothing runs, then what
 * production does; a project that runs nowhere yet is in development.
 */
export function projectState(input: {
  /** Production's line (`placeLines`). */
  readonly production: Pick<PlaceLine, "dot" | "trouble">;
  /** A Mate's lift or a change waits on the viewer. */
  readonly waitsOnYou: boolean;
  readonly mates: ReadonlyArray<Pick<GroupFlowMate, "coming">>;
}): ProjectState {
  const { production } = input;
  const kind: ProjectStateKind =
    production.trouble && production.dot === "down"
      ? "down"
      : production.trouble
        ? "release-failed"
        : input.waitsOnYou
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
  return { kind, ...STATES[kind] };
}

/** How many of a project's open code changes wait in review between Development and Stage. */
export function inReview(flow: Pick<GroupFlow, "pullRequests">): number {
  return flow.pullRequests.filter((entry) => entry.pull.kind === "code").length;
}

/** "2 in review"; on the page, "2 changes in review". */
export function inReviewWords(count: number, long: boolean): string {
  return long
    ? `${String(count)} change${count === 1 ? "" : "s"} in review`
    : `${String(count)} in review`;
}

/** "3 ready"; on the page, "3 ready to release". */
export function readyWords(count: number, atLeast: boolean, long: boolean): string {
  return `${atLeast ? "At least " : ""}${String(count)} ready${long ? " to release" : ""}`;
}

/** A stop's one quiet line under it: its words, and whether they say trouble. */
export interface StopUnder {
  readonly words: ReadonlyArray<string>;
  readonly tone: "muted" | "failed" | "info";
}

/**
 * What a stage says under its stop: running, the branch it follows and how long ago it was
 * deployed ("main · 25m"); otherwise its line's first word ("Deploying…", "Deploy failed").
 */
export function stageUnder(
  line: Pick<PlaceLine, "dot" | "words" | "trouble">,
  facts: { readonly source: string | undefined; readonly age: string | undefined },
): StopUnder {
  if (line.dot === "running")
    return {
      words: [facts.source ?? "main", facts.age].filter((word) => word !== undefined),
      tone: "muted",
    };
  return {
    words: line.words.slice(0, 1),
    tone: line.trouble ? "failed" : line.dot === "releasing" ? "info" : "muted",
  };
}

/**
 * What production says under its stop: what it runs and how long it has run it ("v0.1.3 · up 6d"),
 * still after a failed release; "not live" where nothing runs; otherwise its line's first word.
 */
export function productionUnder(
  line: Pick<PlaceLine, "dot" | "words" | "trouble">,
  facts: { readonly version: string | undefined; readonly up: string | undefined },
): StopUnder {
  const runs = [facts.version, facts.up === undefined ? undefined : `up ${facts.up}`].filter(
    (word) => word !== undefined,
  );
  if (line.dot === "running" && facts.version !== undefined) return { words: runs, tone: "muted" };
  if (line.trouble && line.dot !== "down" && facts.version !== undefined)
    return { words: runs, tone: "muted" };
  if (line.dot === "none") return { words: ["not live"], tone: "muted" };
  return {
    words: line.words.slice(0, 1),
    tone: line.trouble ? "failed" : line.dot === "releasing" ? "info" : "muted",
  };
}

/** What the line between Stage and Production carries: one chip at most. */
export type ReleaseSegment =
  | { readonly kind: "ready"; readonly count: number; readonly atLeast: boolean }
  /** A release ready beside it still mends it (D28): `ready` where one is offered. */
  | {
      readonly kind: "failed";
      readonly tag: string | undefined;
      readonly ready?: { readonly count: number; readonly atLeast: boolean } | undefined;
    }
  | { readonly kind: "merged"; readonly count: number }
  | { readonly kind: "none" };

/**
 * The chip between Stage and Production: production's failed release on the line it failed on —
 * beside a release ready to go where one is, which is how it is mended (D28) — else a release ready (opened by the page's door), else what is merged with no production
 * to go to.
 */
export function releaseSegment(input: {
  readonly production: Pick<PlaceLine, "dot" | "trouble">;
  readonly failedTag: string | undefined;
  /** A release offered here: `cardReady`, where the page's door draws it. */
  readonly ready: { readonly count: number; readonly atLeast: boolean } | undefined;
  readonly productionAbsent: boolean;
  readonly notLive: number;
}): ReleaseSegment {
  if (input.production.trouble && input.production.dot === "failed")
    return { kind: "failed", tag: input.failedTag, ready: input.ready };
  if (input.ready !== undefined)
    return { kind: "ready", count: input.ready.count, atLeast: input.ready.atLeast };
  if (input.productionAbsent && input.notLive > 0) return { kind: "merged", count: input.notLive };
  return { kind: "none" };
}

/** "v0.1.3 failed", or "Release failed" where its tag is not known. */
export function failedWords(tag: string | undefined): string {
  return tag === undefined ? "Release failed" : `${tag} failed`;
}

/** "Kai is free", "Kai and Ida are free", "Kai, Ida and Uma are free". */
export function freeWords(names: ReadonlyArray<string>): string {
  return `${joined(names)} ${names.length === 1 ? "is" : "are"} free`;
}

/**
 * The automated Mates in one line: "Odo works on a task", "Odo and Tess work on tasks" while any
 * works; else "2 automated Mates wait for a task".
 */
export function automatedWords(
  mates: ReadonlyArray<{ readonly name: string; readonly working: boolean }>,
): string {
  const working = mates.filter((mate) => mate.working).map((mate) => mate.name);
  if (working.length === 1) return `${working[0] ?? ""} works on a task`;
  if (working.length > 1) return `${joined(working)} work on tasks`;
  return mates.length === 1
    ? `${mates[0]?.name ?? ""} waits for a task`
    : `${String(mates.length)} automated Mates wait for a task`;
}

const joined = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
