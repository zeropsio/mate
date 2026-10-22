/**
 * An origin the Mate asked the person about (`zerops_origin action=request`): where the code of the
 * repository it started from is kept — on GitHub, mounted in HQ through the organization's GitHub
 * app, or in Mate, GitHub only followed. The person mounts it in HQ themselves; the engine hears
 * only the pick (`connected`, on GitHub; `declined`, in Mate), never a token.
 */
import {
  ORIGIN_ASK_ACTIVITY_KIND,
  type OriginAskActivityPayload,
} from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";

import { githubName, type GitMirrorApp } from "../gitMirror.logic";

/** Where an origin ask stands in the timeline: the run card it was asked in. */
export interface OriginAskPlace {
  readonly requestId: string;
  readonly turnId: TurnId;
  readonly createdAt: string;
}

/**
 * What the person picked on the card here, before the engine's record says it: `connected`, the
 * code kept on GitHub; `declined`, kept in Mate. Memory only.
 */
export type OriginAskSaid = "connected" | "declined";

export type OriginAskFace = OriginAskActivityPayload["state"];

/**
 * What the card draws: the engine's record; while it is open, connected once HQ mounts the origin
 * — however the person mounted it — else what the person just picked here.
 */
export function originAskFace(
  state: OriginAskActivityPayload["state"],
  said: OriginAskSaid | null,
  connected: boolean,
): OriginAskFace {
  if (state !== "open") return state;
  return connected ? "connected" : (said ?? state);
}

/**
 * What the engine is still to hear of an open ask the person picked nothing on here: connected,
 * once HQ mounts the origin — from the card's sheet, or anywhere else.
 */
export function originAskAnswer(
  state: OriginAskActivityPayload["state"],
  said: OriginAskSaid | null,
  connected: boolean,
): OriginAskSaid | null {
  return state === "open" && said === null && connected ? "connected" : null;
}

/**
 * Whether HQ mounts the asked origin: the HQ repository the ask names reaches the asked address
 * through the organization's GitHub app. A person's token only follows it. `false` while HQ has
 * not said.
 */
export function originConnected(
  ask: Pick<OriginAsk, "url" | "repo">,
  repos: ReadonlyArray<RepoListEntry> | undefined,
): boolean {
  const remote = repos?.find((entry) => entry.name === ask.repo)?.remote;
  return remote?.via === "app" && sameAddress(remote.url, ask.url);
}

/**
 * Where keeping the asked origin's code on GitHub stands: still read; mounted, whatever is known
 * of the app; the asked repository already kept with another remote; HQ does not let the person mount it; no GitHub app,
 * or none HQ could say; an app that does not reach the repository; or ready to mount it, by the
 * name the app's repositories give it.
 */
export type OriginMountStep =
  | { readonly kind: "reading" }
  | { readonly kind: "mounted"; readonly remote: NonNullable<RepoListEntry["remote"]> }
  | { readonly kind: "taken"; readonly url: string }
  | { readonly kind: "refused" }
  | { readonly kind: "no-app" }
  | { readonly kind: "unknown" }
  | { readonly kind: "not-reached"; readonly name: string; readonly installUrl: string }
  | { readonly kind: "ready"; readonly name: string; readonly repository: string };

/**
 * The step of keeping a GitHub origin there: `github` is the organization's app (`null` while
 * read), `mountable` whether HQ lets the person mount a repository of the application.
 */
export function originMountStep(
  ask: Pick<OriginAsk, "url" | "repo">,
  github: GitMirrorApp | null,
  repos: ReadonlyArray<RepoListEntry> | undefined,
  mountable: boolean,
): OriginMountStep {
  if (repos === undefined) return { kind: "reading" };
  const remote = repos.find((entry) => entry.name === ask.repo)?.remote;
  if (remote != null)
    return originConnected(ask, repos)
      ? { kind: "mounted", remote }
      : { kind: "taken", url: remote.url };
  if (github === null) return { kind: "reading" };
  if (!mountable) return { kind: "refused" };
  if (github.kind === "none") return { kind: "no-app" };
  if (github.kind === "unknown") return { kind: "unknown" };
  const wanted = githubName(ask.url)?.toLowerCase();
  const repository = github.repositories.find((name) => name.toLowerCase() === wanted);
  return repository === undefined
    ? { kind: "not-reached", name: github.name, installUrl: github.installUrl }
    : { kind: "ready", name: github.name, repository };
}

const sameAddress = (a: string, b: string) =>
  originAddress(a).toLowerCase() === originAddress(b).toLowerCase();

/** The repository's address as people write it: `github.com/owner/repo`. */
export function originAddress(url: string): string {
  return url.replace(/^https:\/\//iu, "").replace(/\.git\/?$/u, "");
}

/** The card's question. */
export function originAskQuestion(url: string): string {
  return `Where do you keep the code of ${originAddress(url)}?`;
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
