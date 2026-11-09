/**
 * A code repository the Mate asked the person to connect to GitHub (`zerops_mirror
 * action=request`). The person connects it in HQ themselves, on the card's picker; the ask is done
 * when HQ shows the repository's remote, however it got there, and the engine hears only that it
 * was connected and where, or not now. Never a token.
 */
import {
  MIRROR_ASK_ACTIVITY_KIND,
  type MirrorAskActivityPayload,
} from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";

import { type AskState, answeredWords, notNowWords } from "../../ask/ask.logic";
import { githubName } from "../gitMirror.logic";

/** Where a mirror ask stands in the timeline: the run card it was asked in. */
export interface MirrorAskPlace {
  readonly requestId: string;
  readonly turnId: TurnId;
  readonly createdAt: string;
}

/** The timeline row that holds a mirror ask's card. */
export const mirrorAskRowId = (requestId: string): string => `mirror-request:${requestId}`;

/**
 * The thread's mirror asks as one string — a line each: its request, run card and time — so a
 * change elsewhere in the thread draws nothing new in the timeline.
 */
export function mirrorAskPlacesKey(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
): string {
  return (activities ?? [])
    .flatMap((activity) => {
      if (activity.kind !== MIRROR_ASK_ACTIVITY_KIND || activity.turnId === null) return [];
      const payload = activity.payload as MirrorAskActivityPayload;
      return [[payload.requestId, activity.turnId, activity.createdAt].join("\t")];
    })
    .join("\n");
}

/** The places back from their string: a card per ask (asking again closes the earlier one). */
export function mirrorAskPlaces(key: string): ReadonlyArray<MirrorAskPlace> {
  if (key === "") return [];
  return key.split("\n").map((line) => {
    const [requestId = "", turnId = "", createdAt = ""] = line.split("\t");
    return { requestId, turnId: turnId as TurnId, createdAt };
  });
}

/**
 * The thread's open mirror asks as one string — a line each: its request and repository, oldest
 * first — so the conversation's watch draws nothing new for a change elsewhere in the thread.
 */
export function mirrorOpenAsksKey(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
): string {
  return (activities ?? [])
    .flatMap((activity) => {
      if (activity.kind !== MIRROR_ASK_ACTIVITY_KIND) return [];
      const payload = activity.payload as MirrorAskActivityPayload;
      return payload.state === "open" ? [`${payload.requestId}\t${payload.repo}`] : [];
    })
    .join("\n");
}

/** The open asks back from their string. */
export function mirrorOpenAsks(
  key: string,
): ReadonlyArray<{ readonly requestId: string; readonly repo: string }> {
  if (key === "") return [];
  return key.split("\n").map((line) => {
    const [requestId = "", repo = ""] = line.split("\t");
    return { requestId, repo };
  });
}

/** The repository an install trip came back for (`connect-seen`: `<project>|<repo>|<ids>`). */
export function seenRepo(value: string | null): string | null {
  const repo = value?.split("|")[1];
  return repo === undefined || repo === "" ? null : repo;
}

/** What the card reads of an ask, and who answered it when: a person's Zerops user id. */
export interface MirrorAskRecord {
  readonly requestId: string;
  readonly repo: string;
  readonly reason: string | null;
  readonly state: MirrorAskActivityPayload["state"];
  readonly answeredBy: string | null;
  readonly answeredAt: number | null;
}

/**
 * The engine's record of one mirror ask, by its request, as one string — for a selector whose
 * answer is compared by value; `""` while the thread holds none.
 */
export function mirrorAskKey(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  requestId: string,
): string {
  for (const activity of activities ?? []) {
    if (activity.kind !== MIRROR_ASK_ACTIVITY_KIND) continue;
    const payload = activity.payload as MirrorAskActivityPayload;
    if (payload.requestId !== requestId) continue;
    const record: MirrorAskRecord = {
      requestId,
      repo: payload.repo,
      reason: payload.reason,
      state: payload.state,
      answeredBy: payload.answer?.by.kind === "person" ? payload.answer.by.subject : null,
      answeredAt: payload.answer?.at ?? null,
    };
    return JSON.stringify(record);
  }
  return "";
}

/** The record back from its string; `null` for none. */
export function mirrorAskFromKey(key: string): MirrorAskRecord | null {
  return key === "" ? null : (JSON.parse(key) as MirrorAskRecord);
}

/**
 * The address HQ shows as the asked repository's remote, through the GitHub app or a token;
 * `null` while it has none, or HQ has not said.
 */
export function mirrorRemote(
  repo: string,
  repos: ReadonlyArray<RepoListEntry> | undefined,
): string | null {
  return repos?.find((entry) => entry.name === repo)?.remote?.url ?? null;
}

/** The card's title: the verb and its subject. */
export const mirrorAskTitle = (repo: string): string => `Connect ${repo} to GitHub`;

/** A remote as people write it: `acme/shop` on GitHub, else the address without its scheme. */
export function remoteWords(url: string): string {
  return githubName(url) ?? url.replace(/^https:\/\//iu, "").replace(/\.git\/?$/u, "");
}

/**
 * What this tab told the engine that its record does not say yet: connected (HQ showed the
 * remote), or the person's Not now.
 */
export type MirrorAskPending = "connected" | "declined" | null;

/**
 * The card's state: the engine's record (connected, not now, who and when, or closed some other
 * way); HQ's remote, which settles it however it was set — the record names who only when it was
 * the answer; the person's press still on its way, or the engine's refusal of it; while open, HQ
 * refusing the person to connect it, with whom it lets; else waiting on them.
 */
export function mirrorAskState(input: {
  readonly state: MirrorAskActivityPayload["state"];
  readonly pending: MirrorAskPending;
  /** The engine's refusal of the last press, in its words. */
  readonly refusal: string | null;
  /** The remote's address HQ shows (`mirrorRemote`). */
  readonly remote: string | null;
  /** HQ's words when it does not let this person connect the repository; `null` when it does. */
  readonly refused: string | null;
  readonly mateName: string;
  /** Who answered, by name, and when, as the engine's record says. */
  readonly by: string | null;
  readonly at: string | null;
}): AskState {
  const recorded = input.state === "connected" || input.state === "declined";
  if (input.state === "open" && input.refusal !== null)
    return { kind: "failed", words: input.refusal };
  if (input.remote !== null && input.state !== "declined")
    return {
      kind: "done",
      words: answeredWords(
        `On GitHub at ${remoteWords(input.remote)}`,
        recorded ? input.by : null,
        recorded ? input.at : null,
      ),
      told: null,
    };
  switch (input.state) {
    case "connected":
      return { kind: "done", words: answeredWords("On GitHub", input.by, input.at), told: null };
    case "declined":
      return { kind: "notNow", words: notNowWords(input.by, input.at) };
    case "closed":
      return { kind: "replaced", words: `${input.mateName} isn't waiting on this any more.` };
    case "open":
      if (input.pending === "declined")
        return { kind: "working", words: "Not now…", pressed: "notNow" };
      if (input.refused !== null) return { kind: "othersToAnswer", words: input.refused };
      return { kind: "waiting" };
  }
}

/**
 * Whether the engine refused an answer for an ask it holds open no more (`unknown-request`): its
 * Mate settled it, or it was answered elsewhere. Nothing is left to tell it.
 */
export function mirrorAnswerSettled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly code?: unknown }).code === "unknown-request"
  );
}
