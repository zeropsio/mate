/**
 * An origin the Mate asked the person about (`zerops_origin action=request`): where the code of the
 * repository it started from is kept — on GitHub, mounted in HQ through the organization's GitHub
 * app, or in Mate, GitHub only followed. The person mounts or follows it in HQ themselves; the
 * engine hears only the pick (`connected`, on GitHub; `declined`, in Mate), never a token.
 */
import {
  ORIGIN_ASK_ACTIVITY_KIND,
  type OriginAskActivityPayload,
} from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";

import { githubName, type GitMirrorApp, waitingAccount } from "../gitMirror.logic";

/**
 * Where an origin question stands in the timeline: the run card its first ask was asked in, and
 * every ask it stands for (`originAskPlaces`).
 */
export interface OriginAskPlace {
  /** Its first ask's request: the card's identity. */
  readonly requestId: string;
  readonly requestIds: ReadonlyArray<string>;
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
 * Keeping the asked origin's code in Mate: HQ follows a GitHub repository first, for every Mate of
 * the application, and the engine hears the pick once HQ did; a refusal is the person's to read,
 * and the ask stays open. A follow HQ leaves to an owner or admin (`owner-or-admin`) does not hold
 * the pick: the engine hears it, and the person reads who records the follow. A repository outside
 * GitHub is only the engine's to hear. `follow` is `undefined` while HQ cannot be asked; each says
 * `null` once done, else why not.
 */
export async function keepInMate(
  url: string,
  follow: ((url: string) => Promise<string | null>) | "owner-or-admin" | undefined,
  answer: () => Promise<string | null>,
): Promise<string | null> {
  if (githubName(url) !== null) {
    if (follow === undefined) return "HQ can't record this yet. Try again in a moment.";
    if (follow === "owner-or-admin")
      return (
        (await answer()) ??
        "Only this Mate follows the repository. An owner or admin of the organization can record the follow for every Mate of the application."
      );
    const refused = await follow(url);
    if (refused !== null) return refused;
  }
  return answer();
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
  /** The app is installed where the repository is, but that installation waits for an OK. */
  | { readonly kind: "waiting"; readonly account: string }
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
  if (repository !== undefined) return { kind: "ready", name: github.name, repository };
  const waiting = wanted === undefined ? null : waitingAccount(github, wanted);
  return waiting === null
    ? { kind: "not-reached", name: github.name, installUrl: github.installUrl }
    : { kind: "waiting", account: waiting };
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
 * The thread's origin asks as one string — a line each: its request, run card, time, the address
 * it names and until when it stood open — so a change elsewhere in the thread draws nothing new in
 * the timeline.
 */
export function originAskPlacesKey(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
): string {
  return (activities ?? [])
    .flatMap((activity) => {
      if (activity.kind !== ORIGIN_ASK_ACTIVITY_KIND || activity.turnId === null) return [];
      const payload = activity.payload as OriginAskActivityPayload;
      // Open: still open now. Settled with no answer's time: never open with a later ask.
      const openUntil =
        payload.state === "open" ? "open" : String(payload.answer?.at ?? Number.NEGATIVE_INFINITY);
      return [
        [
          payload.requestId,
          activity.turnId,
          activity.createdAt,
          originAddress(payload.url).toLowerCase(),
          openUntil,
        ].join("\t"),
      ];
    })
    .join("\n");
}

/**
 * The places back from their string: one question per address at a time. An ask naming the
 * address of an earlier ask still open when it was asked — a Mate with several dev services from
 * one repository asks once for each — is that ask's question, standing where it was first asked
 * and answered with it; asked again after its answer, it is a new question.
 */
export function originAskPlaces(key: string): ReadonlyArray<OriginAskPlace> {
  if (key === "") return [];
  const places: Array<OriginAskPlace & { readonly requestIds: Array<string> }> = [];
  const open = new Map<string, { place: (typeof places)[number]; until: number }>();
  for (const line of key.split("\n")) {
    const [requestId = "", turnId = "", createdAt = "", address = "", openUntil = ""] =
      line.split("\t");
    const until = openUntil === "open" ? Number.POSITIVE_INFINITY : Number(openUntil);
    const earlier = open.get(address);
    if (earlier !== undefined && Date.parse(createdAt) < earlier.until) {
      earlier.place.requestIds.push(requestId);
      earlier.until = Math.max(earlier.until, until);
      continue;
    }
    const place = { requestId, requestIds: [requestId], turnId: turnId as TurnId, createdAt };
    places.push(place);
    open.set(address, { place, until });
  }
  return places;
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

/** An ask the card stands for, by its request. */
export type OriginAskOfRequest = OriginAsk & { readonly requestId: string };

/** The asks a card stands for as one string, for a selector whose answer is compared by value. */
export function originAsksKey(asks: ReadonlyArray<OriginAskActivityPayload | null>): string {
  return JSON.stringify(
    asks.flatMap((ask) =>
      ask === null ? [] : [[ask.requestId, ask.url, ask.repo, ask.reason, ask.state]],
    ),
  );
}

/** The asks back from their string. */
export function originAsksFromKey(key: string): ReadonlyArray<OriginAskOfRequest> {
  return (
    JSON.parse(key) as ReadonlyArray<[string, string, string, string | null, OriginAsk["state"]]>
  ).map(([requestId, url, repo, reason, state]) => ({ requestId, url, repo, reason, state }));
}

/**
 * One card for the asks it stands for (`originAskPlaces`): the question its first ask put, the
 * first why any gave, open while any is; the asks its answer goes to — those still open — and the
 * HQ repositories they name, each wired to the one address: an ask closed already, answered or
 * settled by its Mate, names none. Kept on GitHub once HQ mounts every one of them through the
 * GitHub app.
 */
export function originAskGroup(asks: ReadonlyArray<OriginAskOfRequest>): {
  readonly ask: OriginAsk;
  readonly open: ReadonlyArray<string>;
  readonly repos: ReadonlyArray<string>;
  readonly connected: (repos: ReadonlyArray<RepoListEntry> | undefined) => boolean;
} {
  const [first] = asks;
  const url = first?.url ?? "";
  const live = asks.filter((ask) => ask.state === "open");
  const open = live.map((ask) => ask.requestId);
  const repos = [...new Set(live.map((ask) => ask.repo))];
  return {
    ask: {
      url,
      repo: live[0]?.repo ?? first?.repo ?? "",
      reason: asks.find((ask) => ask.reason !== null)?.reason ?? null,
      state: open.length > 0 ? "open" : (first?.state ?? "closed"),
    },
    open,
    repos,
    connected: (listed) =>
      repos.length > 0 && repos.every((repo) => originConnected({ url, repo }, listed)),
  };
}

/**
 * Whether the engine refused the person's pick for an ask it holds open no more
 * (`unknown-request`): its Mate settled it, or it was answered elsewhere. The pick stands, and the
 * card's other asks still hear it.
 */
export function originAnswerSettled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly code?: unknown }).code === "unknown-request"
  );
}
