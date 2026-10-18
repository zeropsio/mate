import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import { originAskAnswer, originAskFace, originConnected } from "./originAsk.logic";

const ask = { url: "https://github.com/krls2020/eval2", repo: "appdev" };
const repo = (name: string, url: string | null): RepoListEntry => ({
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
        },
      }),
});
const git = (tier: "stage" | "production") =>
  ({ tier, target: { kind: "git", branch: "main", delivery: "direct" } }) as const;
const zerops = { tier: "production", target: { kind: "zerops", projectId: "P" } } as const;

describe("an origin HQ already delivers to", () => {
  it.each([
    {
      case: "production pushes to Git and the asked repository's remote is the asked address",
      environments: [git("production")],
      repos: [repo("appdev", "https://github.com/krls2020/eval2.git")],
      connected: true,
    },
    {
      case: "the remote is written in another case",
      environments: [git("production")],
      repos: [repo("appdev", "https://github.com/Krls2020/Eval2")],
      connected: true,
    },
    {
      case: "only stage pushes to Git",
      environments: [git("stage")],
      repos: [repo("appdev", "https://github.com/krls2020/eval2.git")],
      connected: false,
    },
    {
      case: "production is a Zerops project",
      environments: [zerops],
      repos: [repo("appdev", "https://github.com/krls2020/eval2.git")],
      connected: false,
    },
    {
      case: "the asked repository's remote is another repository",
      environments: [git("production")],
      repos: [repo("appdev", "https://github.com/krls2020/other.git")],
      connected: false,
    },
    {
      case: "another repository holds the asked address",
      environments: [git("production")],
      repos: [repo("api", "https://github.com/krls2020/eval2.git"), repo("appdev", null)],
      connected: false,
    },
    {
      case: "HQ has not said its environments",
      environments: undefined,
      repos: [repo("appdev", "https://github.com/krls2020/eval2.git")],
      connected: false,
    },
    {
      case: "HQ has not said its repositories",
      environments: [git("production")],
      repos: undefined,
      connected: false,
    },
  ])("is connected only when $case: $connected", ({ environments, repos, connected }) => {
    expect(originConnected(ask, environments, repos)).toBe(connected);
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
