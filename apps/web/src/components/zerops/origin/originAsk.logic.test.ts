import { ORIGIN_ASK_ACTIVITY_KIND } from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import { githubName, type GitMirrorApp } from "../gitMirror.logic";
import {
  keepInMate,
  originAskAnswer,
  originAskFace,
  originAskGroup,
  originAskPlaces,
  originAskPlacesKey,
  originConnected,
  originMountStep,
  type OriginAsk,
} from "./originAsk.logic";

const ask = { url: "https://github.com/krls2020/eval2", repo: "appdev" };
const repo = (name: string, url: string | null, via?: "app" | "token"): RepoListEntry => ({
  name,
  mainHead: "a".repeat(40),
  updatedAt: "2026-10-18T08:33:20Z",
  ...(url === null
    ? {}
    : {
        remote: {
          url,
          repositoryId: "42",
          keptAt: "2026-10-18T08:30:00Z",
          keptBy: "viewer",
          expiresAt: null,
          invalidSince: null,
          ...(via === undefined ? {} : { via }),
        },
      }),
});

describe("an origin HQ already delivers to", () => {
  it.each([
    {
      case: "the asked repository is mounted through the GitHub app at the asked address",
      repos: [repo("appdev", "https://github.com/krls2020/eval2.git", "app")],
      connected: true,
    },
    {
      case: "the remote is written in another case",
      repos: [repo("appdev", "https://github.com/Krls2020/Eval2", "app")],
      connected: true,
    },
    {
      case: "HQ reaches the asked address with a person's token",
      repos: [repo("appdev", "https://github.com/krls2020/eval2.git", "token")],
      connected: false,
    },
    {
      case: "an older HQ says no way it reaches the asked address",
      repos: [repo("appdev", "https://github.com/krls2020/eval2.git")],
      connected: false,
    },
    {
      case: "the asked repository's remote is another repository",
      repos: [repo("appdev", "https://github.com/krls2020/other.git", "app")],
      connected: false,
    },
    {
      case: "another repository holds the asked address",
      repos: [repo("api", "https://github.com/krls2020/eval2.git", "app"), repo("appdev", null)],
      connected: false,
    },
    {
      case: "HQ has not said its repositories",
      repos: undefined,
      connected: false,
    },
  ])("is connected only when $case: $connected", ({ repos, connected }) => {
    expect(originConnected(ask, repos)).toBe(connected);
  });

  it.each([
    { state: "open", said: null, connected: true, face: "connected", answer: "connected" },
    { state: "open", said: "declined", connected: true, face: "connected", answer: null },
    { state: "open", said: "connected", connected: true, face: "connected", answer: null },
    { state: "open", said: null, connected: false, face: "open", answer: null },
    { state: "open", said: "declined", connected: false, face: "declined", answer: null },
    { state: "declined", said: null, connected: true, face: "declined", answer: null },
    { state: "closed", said: null, connected: true, face: "closed", answer: null },
  ] as const)(
    "an ask $state, said $said, connected in HQ $connected draws $face and answers $answer",
    ({ state, said, connected, face, answer }) => {
      expect(originAskFace(state, said, connected)).toBe(face);
      expect(originAskAnswer(state, said, connected)).toBe(answer);
    },
  );
});

const app = (repositories: ReadonlyArray<string>): GitMirrorApp => ({
  kind: "connected",
  name: "Acme Mate",
  repositories,
  installUrl: "https://github.com/apps/acme-mate/installations/new",
});

describe("keeping an asked origin's code on GitHub", () => {
  it.each([
    { url: "https://github.com/krls2020/eval2", repository: "krls2020/eval2" },
    { url: "https://github.com/krls2020/eval2.git", repository: "krls2020/eval2" },
    { url: "https://gitlab.com/krls2020/eval2", repository: null },
    { url: "https://github.com/krls2020", repository: null },
  ])("$url is the GitHub repository $repository", ({ url, repository }) => {
    expect(githubName(url)).toBe(repository);
  });

  it.each([
    {
      case: "the GitHub app is still read",
      github: null,
      repos: [repo("appdev", null)],
      mountable: true,
      step: { kind: "reading" },
    },
    {
      case: "HQ has not said its repositories",
      github: app(["krls2020/eval2"]),
      repos: undefined,
      mountable: true,
      step: { kind: "reading" },
    },
    {
      case: "the asked repository is mounted at the asked address",
      github: app(["krls2020/eval2"]),
      repos: [repo("appdev", "https://github.com/krls2020/eval2", "app")],
      mountable: false,
      step: { kind: "mounted" },
    },
    {
      case: "the asked repository is mounted and the app is no longer read",
      github: null,
      repos: [repo("appdev", "https://github.com/krls2020/eval2", "app")],
      mountable: true,
      step: { kind: "mounted" },
    },
    {
      case: "the asked repository already has another remote",
      github: app(["krls2020/eval2"]),
      repos: [repo("appdev", "https://github.com/krls2020/eval2", "token")],
      mountable: true,
      step: { kind: "taken", url: "https://github.com/krls2020/eval2" },
    },
    {
      case: "HQ does not let the person mount it",
      github: app(["krls2020/eval2"]),
      repos: [repo("appdev", null)],
      mountable: false,
      step: { kind: "refused" },
    },
    {
      case: "the organization has no GitHub app",
      github: { kind: "none" },
      repos: [repo("appdev", null)],
      mountable: true,
      step: { kind: "no-app" },
    },
    {
      case: "HQ's answer about the app could not be read",
      github: { kind: "unknown" },
      repos: [repo("appdev", null)],
      mountable: true,
      step: { kind: "unknown" },
    },
    {
      case: "the app does not reach the repository",
      github: app(["krls2020/other"]),
      repos: [repo("appdev", null)],
      mountable: true,
      step: { kind: "not-reached", name: "Acme Mate" },
    },
    {
      case: "the app reaches the repository in another case",
      github: app(["Krls2020/Eval2"]),
      repos: [repo("appdev", null)],
      mountable: true,
      step: { kind: "ready", repository: "Krls2020/Eval2", name: "Acme Mate" },
    },
  ] as const)("is $step.kind when $case", ({ github, repos, mountable, step }) => {
    expect(originMountStep(ask, github, repos, mountable)).toMatchObject(step);
  });
});

describe("keeping the asked origin's code in Mate", () => {
  it.each([
    {
      case: "a GitHub repository is followed in HQ before the Mate hears the pick",
      url: "https://github.com/krls2020/eval2",
      follow: "followed" as const,
      steps: ["follow https://github.com/krls2020/eval2", "answer"],
      said: null,
    },
    {
      case: "HQ refusing to follow it tells the person why, and the Mate hears nothing",
      url: "https://github.com/krls2020/eval2",
      follow: "Only the organization's owner or admin can change this.",
      steps: ["follow https://github.com/krls2020/eval2"],
      said: "Only the organization's owner or admin can change this.",
    },
    {
      case: "a follow only an owner or admin can record still tells the Mate the pick, and the person who records it",
      url: "https://github.com/krls2020/eval2",
      follow: "owner-or-admin" as const,
      steps: ["answer"],
      said: "Only this Mate follows the repository. An owner or admin of the organization can record the follow for every Mate of the application.",
    },
    {
      case: "without HQ to follow it, the Mate hears nothing",
      url: "https://github.com/krls2020/eval2",
      follow: undefined,
      steps: [],
      said: "HQ can't record this yet. Try again in a moment.",
    },
    {
      case: "a repository outside GitHub is only the Mate's to hear",
      url: "https://gitlab.com/acme/app",
      follow: undefined,
      steps: ["answer"],
      said: null,
    },
  ])("$case", async ({ url, follow, steps, said }) => {
    const seen: Array<string> = [];
    const answer = await keepInMate(
      url,
      follow === undefined || follow === "owner-or-admin"
        ? follow
        : async (address) => {
            seen.push(`follow ${address}`);
            return follow === "followed" ? null : follow;
          },
      async () => {
        seen.push("answer");
        return null;
      },
    );
    expect(seen).toEqual(steps);
    expect(answer).toBe(said);
  });
});

/** An origin ask as the engine records it in the thread: asked at `at`, answered at `answeredAt`. */
const asked = (
  requestId: string,
  url: string,
  repoName: string,
  at: string,
  answeredAt?: string,
): OrchestrationThreadActivity =>
  ({
    id: `${requestId}#origin`,
    kind: ORIGIN_ASK_ACTIVITY_KIND,
    tone: "info",
    summary: "Origin requested",
    turnId: "turn-1",
    createdAt: at,
    payload: {
      requestId,
      url,
      repo: repoName,
      reason: null,
      state: answeredAt === undefined ? "open" : "connected",
      answer:
        answeredAt === undefined
          ? null
          : { by: { kind: "person", userId: "viewer" }, at: Date.parse(answeredAt) },
    },
  }) as unknown as OrchestrationThreadActivity;

const NOOLA = "https://github.com/fxck/noola";

// The owner, 2026-10-27: a Mate with seven dev services from one repository asked "Where do you
// keep the code of github.com/fxck/noola?" seven times, one card each.
describe("one question per repository address", () => {
  const places = (activities: ReadonlyArray<OrchestrationThreadActivity>) =>
    originAskPlaces(originAskPlacesKey(activities)).map(({ requestId, requestIds }) => ({
      requestId,
      requestIds,
    }));

  it("stands asks naming the same address while one is open as one card where the first was asked", () => {
    expect(
      places([
        asked("r1", NOOLA, "appdev", "2026-10-27T09:00:00.000Z"),
        asked("r2", `${NOOLA.replace("fxck", "FXCK")}.git`, "apidev", "2026-10-27T09:00:01.000Z"),
        asked("r3", "https://github.com/fxck/other", "webdev", "2026-10-27T09:00:02.000Z"),
        asked("r4", NOOLA, "workerdev", "2026-10-27T09:00:03.000Z"),
      ]),
    ).toEqual([
      { requestId: "r1", requestIds: ["r1", "r2", "r4"] },
      { requestId: "r3", requestIds: ["r3"] },
    ]);
  });

  it("keeps them one card once their answer settled them", () => {
    expect(
      places([
        asked("r1", NOOLA, "appdev", "2026-10-27T09:00:00.000Z", "2026-10-27T09:05:00.000Z"),
        asked("r2", NOOLA, "apidev", "2026-10-27T09:00:01.000Z", "2026-10-27T09:05:00.000Z"),
      ]),
    ).toEqual([{ requestId: "r1", requestIds: ["r1", "r2"] }]);
  });

  it("asks an address again as a new question once its earlier ask was answered", () => {
    expect(
      places([
        asked("r1", NOOLA, "appdev", "2026-10-27T09:00:00.000Z", "2026-10-27T09:05:00.000Z"),
        asked("r2", NOOLA, "apidev", "2026-10-27T10:00:00.000Z"),
      ]),
    ).toEqual([
      { requestId: "r1", requestIds: ["r1"] },
      { requestId: "r2", requestIds: ["r2"] },
    ]);
  });
});

describe("a card standing for several asks", () => {
  const asks: ReadonlyArray<OriginAsk & { readonly requestId: string }> = [
    { requestId: "r1", url: NOOLA, repo: "appdev", reason: null, state: "connected" },
    {
      requestId: "r2",
      url: `${NOOLA}.git`,
      repo: "apidev",
      reason: "Its CI runs there.",
      state: "open",
    },
    { requestId: "r3", url: NOOLA, repo: "apidev", reason: null, state: "open" },
  ];

  it("asks while any of its asks is open, and its answer goes to each of those", () => {
    const group = originAskGroup(asks);
    expect(group.ask).toEqual({
      url: NOOLA,
      repo: "appdev",
      reason: "Its CI runs there.",
      state: "open",
    });
    expect(group.open).toEqual(["r2", "r3"]);
    expect(group.repos).toEqual(["appdev", "apidev"]);
  });

  it("is kept on GitHub once HQ mounts every repository its asks name", () => {
    const group = originAskGroup(asks);
    const mounted = repo("appdev", `${NOOLA}.git`, "app");
    expect(group.connected([mounted])).toBe(false);
    expect(group.connected([mounted, repo("apidev", NOOLA, "app")])).toBe(true);
  });
});
