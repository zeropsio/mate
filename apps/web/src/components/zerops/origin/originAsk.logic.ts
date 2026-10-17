/**
 * An origin the Mate asked the person for (`zerops_origin action=request`): whether finished work
 * goes back to the repository it started from. The person connects it in HQ themselves, on the
 * Git sheet; the engine hears only connected or declined, never a token.
 */
import {
  ORIGIN_ASK_ACTIVITY_KIND,
  type OriginAskActivityPayload,
} from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

/**
 * The branch stage follows production on when it is added from an origin ask (the orchestrator's
 * decision): a stage added by hand keeps the sheet's own default.
 */
export const ORIGIN_STAGE_BRANCH = "mate/stage";

/** Where an origin ask stands in the timeline: the run card it was asked in. */
export interface OriginAskPlace {
  readonly requestId: string;
  readonly turnId: TurnId;
  readonly createdAt: string;
}

/** What the person said to the card here, before the engine's record says it. Memory only. */
export type OriginAskSaid = "connected" | "declined";

export type OriginAskFace = OriginAskActivityPayload["state"];

/** What the card draws: the engine's record, else what the person just said here. */
export function originAskFace(
  state: OriginAskActivityPayload["state"],
  said: OriginAskSaid | null,
): OriginAskFace {
  return state === "open" && said !== null ? said : state;
}

/** The repository's address as people write it: `github.com/owner/repo`. */
export function originAddress(url: string): string {
  return url.replace(/^https:\/\//iu, "").replace(/\.git\/?$/u, "");
}

/** The card's question. */
export function originAskQuestion(url: string): string {
  return `Deliver finished work back to ${originAddress(url)}?`;
}

/**
 * The thread's origin asks as one string — a line each: its request, run card and time — so a
 * change elsewhere in the thread draws nothing new in the timeline.
 */
export function originAskPlacesKey(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
): string {
  return (activities ?? [])
    .flatMap((activity) =>
      activity.kind !== ORIGIN_ASK_ACTIVITY_KIND || activity.turnId === null
        ? []
        : [
            [
              (activity.payload as OriginAskActivityPayload).requestId,
              activity.turnId,
              activity.createdAt,
            ].join("\t"),
          ],
    )
    .join("\n");
}

/** The places back from their string: where the timeline stands each ask. */
export function originAskPlaces(key: string): ReadonlyArray<OriginAskPlace> {
  return key === ""
    ? []
    : key.split("\n").map((line) => {
        const [requestId = "", turnId = "", createdAt = ""] = line.split("\t");
        return { requestId, turnId: turnId as TurnId, createdAt };
      });
}

/** The engine's record of one origin ask, by its request. */
export function originAskOf(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  requestId: string,
): OriginAskActivityPayload | null {
  for (const activity of activities ?? []) {
    if (activity.kind !== ORIGIN_ASK_ACTIVITY_KIND) continue;
    const payload = activity.payload as OriginAskActivityPayload;
    if (payload.requestId === requestId) return payload;
  }
  return null;
}

/** What the card reads of an ask: never who answered, which the card does not say. */
export type OriginAsk = Pick<OriginAskActivityPayload, "url" | "repo" | "reason" | "state">;

/** An ask as one string, for a selector whose answer is compared by value. */
export function originAskKey(ask: OriginAskActivityPayload | null): string {
  return ask === null ? "" : JSON.stringify([ask.url, ask.repo, ask.reason, ask.state]);
}

/** The ask back from its string. */
export function originAskFromKey(key: string): OriginAsk | null {
  if (key === "") return null;
  const [url, repo, reason, state] = JSON.parse(key) as [
    string,
    string,
    string | null,
    OriginAsk["state"],
  ];
  return { url, repo, reason, state };
}
