import { describe, expect, it } from "vite-plus/test";

import type { Capability } from "../data/access/capabilities.ts";
import { project, service } from "../data/__fixtures__/index.ts";
import type { ServiceRef } from "../data/types.ts";
import { GiteaApiError, type GiteaClient } from "../giteaClient.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import type { Shown } from "../knowledge/known.ts";
import { flowVerbKey } from "../projectFlow.ts";
import { RELEASE_NOT_A_RELEASER } from "../release.ts";
import {
  FLOW_COMMAND_UNCERTAIN,
  flowCommandFor,
  makeFlowCommands,
  mergeCommand,
  releaseCommand,
  type FlowCommand,
  type FlowCommandPorts,
} from "./flowCommands.ts";
import type { GroupFlow } from "./groupFlow.ts";

const GITEA = "https://gitea-1-3000.prg1.zerops.app";
const APPSTAGE = service("stage-appdev", project("p-stage"));
const HEAD = "a".repeat(40);

const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 20; hop += 1) await Promise.resolve();
};

/** A Gitea whose writes the test answers, reached through a session the test moves. */
function rig(initial: Capability = { allowed: true }) {
  let capability = initial;
  const listeners = new Set<() => void>();
  const timers = new Set<{ readonly fire: () => void }>();
  const invalidated: Array<Invalidation> = [];
  const calls: Array<string> = [];
  let answer: (route: string) => Promise<unknown> = async () => undefined;
  const call = (route: string) => {
    calls.push(route);
    return answer(route);
  };
  const client = {
    mergePullRequest: (owner: string, repo: string, number: number) =>
      call(`merge ${owner}/${repo}#${String(number)}`),
    getBranch: (owner: string, repo: string, branch: string) =>
      call(`branch ${owner}/${repo} ${branch}`),
    createTag: (owner: string, repo: string, input: { readonly tag: string }) =>
      call(`tag ${owner}/${repo} ${input.tag}`),
    listTags: (owner: string, repo: string) => call(`tags ${owner}/${repo}`),
    createPullRequest: (owner: string, repo: string, input: { readonly head: string }) =>
      call(`open ${owner}/${repo} ${input.head}`),
  } as unknown as GiteaClient;
  const ports: FlowCommandPorts = {
    capability: () => capability,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clientFor: () => (capability.allowed ? client : null),
    invalidate: (invalidation) => void invalidated.push(invalidation),
    setTimer: (_delayMs, fire) => {
      const timer = { fire };
      timers.add(timer);
      return () => void timers.delete(timer);
    },
  };
  return {
    commands: makeFlowCommands(ports),
    invalidated,
    calls,
    answerWith: (next: (route: string) => Promise<unknown>) => {
      answer = next;
    },
    setCapability: (next: Capability) => {
      capability = next;
      for (const listener of listeners) listener();
    },
    /** The capability wait runs out. */
    expire: () => {
      for (const timer of timers) timer.fire();
    },
  };
}

const MERGE: FlowCommand = {
  kind: "merge",
  origin: GITEA,
  slug: "harbor",
  repository: "appdev",
  number: 4,
  head: HEAD,
  feeds: [APPSTAGE],
};

const RELEASE: FlowCommand = {
  kind: "release",
  origin: GITEA,
  slug: "harbor",
  groupId: "g1",
  tag: "v1.0.1",
  message: `appdev ${HEAD}`,
};

describe("flow commands (DESIGN §4.9, §4.7 verbs)", () => {
  it("Merge re-reads only that repo and the deployment it feeds", async () => {
    const { commands, invalidated, calls } = rig();

    const attempt = await commands.run(MERGE);

    expect(attempt).toEqual({ phase: "accepted" });
    expect(calls).toEqual(["merge harbor/appdev#4"]);
    expect(invalidated).toEqual([
      { topic: "forge-repo", origin: GITEA, owner: "harbor", repo: "appdev" },
      { topic: "deployment", service: APPSTAGE },
    ]);
  });

  it("Release and Roll back re-read the group repo, nothing else", async () => {
    const { commands, invalidated, answerWith } = rig();
    answerWith(async (route) => {
      if (route === "branch harbor/group main") return { name: "main", commit: { id: HEAD } };
      if (route === "tags harbor/group") {
        return [{ name: "v1.0.0", message: `appdev ${HEAD}` }];
      }
      return undefined;
    });

    expect(await commands.run(RELEASE)).toEqual({ phase: "accepted" });
    expect(
      await commands.run({
        kind: "roll-back",
        origin: GITEA,
        slug: "harbor",
        groupId: "g1",
        tag: "v1.0.0",
      }),
    ).toEqual({ phase: "accepted" });
    const group = { topic: "forge-repo", origin: GITEA, owner: "harbor", repo: "group" };
    expect(invalidated).toEqual([group, group]);
  });

  it("Open re-reads only that repo's pull requests", async () => {
    const { commands, invalidated, calls } = rig();

    const attempt = await commands.run({
      kind: "open",
      origin: GITEA,
      slug: "harbor",
      repository: "appdev",
      head: "mate/ada",
      base: "main",
      title: "Add cart",
    });

    expect(attempt).toEqual({ phase: "accepted" });
    expect(calls).toEqual(["open harbor/appdev mate/ada"]);
    expect(invalidated).toEqual([
      { topic: "forge-repo", origin: GITEA, owner: "harbor", repo: "appdev" },
    ]);
  });

  it("a capability nothing can bring back refuses at once, typed, and writes nothing", async () => {
    const { commands, calls, invalidated } = rig({
      allowed: false,
      reason: "gitea-session",
      waitable: false,
    });

    const attempt = await commands.run(MERGE);

    expect(attempt).toMatchObject({
      phase: "refused",
      refusal: { kind: "capability", reason: "gitea-session", retryable: true },
    });
    expect(calls).toEqual([]);
    expect(invalidated).toEqual([]);
  });

  it("a waitable capability is awaited before the attempt starts, and refused when the wait runs out", async () => {
    const waiting = rig({ allowed: false, reason: "gitea-session", waitable: true });
    const merged = waiting.commands.run(MERGE);
    await flush();
    expect(waiting.commands.attempt(MERGE)).toEqual({ phase: "awaiting-capability" });
    waiting.setCapability({ allowed: true });
    expect(await merged).toEqual({ phase: "accepted" });

    const expiring = rig({ allowed: false, reason: "gitea-session", waitable: true });
    const refused = expiring.commands.run(MERGE);
    await flush();
    expiring.expire();
    expect(await refused).toMatchObject({
      phase: "refused",
      refusal: { kind: "capability", reason: "gitea-session", retryable: true },
    });
    expect(expiring.calls).toEqual([]);
  });

  it("Gitea's own no is a refusal on that target only, in its words", async () => {
    const { commands, answerWith } = rig();
    answerWith(async () => {
      throw new GiteaApiError("Gitea would not merge it.", 405, "Please try again later");
    });

    const attempt = await commands.run(MERGE);

    expect(attempt).toEqual({
      phase: "refused",
      refusal: {
        kind: "gitea",
        status: 405,
        words: "Gitea would not merge it: Please try again later",
      },
    });
    expect(commands.attempt(MERGE)).toEqual(attempt);
    expect(commands.attempt({ ...MERGE, number: 5 })).toBeNull();
  });

  it("a tag Gitea's protection refuses says only releasers can tag", async () => {
    const { commands, answerWith } = rig();
    answerWith(async (route) => {
      if (route.startsWith("branch")) return { name: "main", commit: { id: HEAD } };
      throw new GiteaApiError("Gitea would not create the tag.", 403);
    });

    expect(await commands.run(RELEASE)).toEqual({
      phase: "refused",
      refusal: { kind: "gitea", status: 403, words: RELEASE_NOT_A_RELEASER },
    });
  });

  it("a write whose answer was lost is uncertain, re-reads what it touched, and is never sent again", async () => {
    const { commands, answerWith, calls, invalidated } = rig();
    answerWith(async () => {
      throw new TypeError("Failed to fetch");
    });

    const attempt = await commands.run(MERGE);

    expect(attempt).toEqual({ phase: "uncertain", words: FLOW_COMMAND_UNCERTAIN });
    expect(calls).toEqual(["merge harbor/appdev#4"]);
    expect(invalidated).toHaveLength(2);
  });

  it("a read before the write that fails refuses, having written nothing", async () => {
    const { commands, answerWith, calls, invalidated } = rig();
    // The group repository has no `main` yet.
    answerWith(async () => undefined);

    expect(await commands.run(RELEASE)).toEqual({
      phase: "refused",
      refusal: { kind: "nothing-to-do", words: "The group repository has no main to tag." },
    });
    expect(calls).toEqual(["branch harbor/group main"]);
    expect(invalidated).toEqual([]);
  });

  it("a group's attempts are listed by their verb's key, and no other group's", async () => {
    const { commands, answerWith } = rig();
    const landings: Array<() => void> = [];
    answerWith(() => new Promise<void>((resolve) => landings.push(resolve)));
    const cove: FlowCommand = { ...MERGE, slug: "cove", feeds: [] };

    const merging = commands.run(MERGE);
    const other = commands.run(cove);
    await flush();
    expect(commands.attemptsIn("harbor")).toEqual(
      new Map([[flowVerbKey(MERGE), { phase: "pending" }]]),
    );
    expect([...commands.attemptsIn("cove").keys()]).toEqual([flowVerbKey(cove)]);
    expect(commands.attemptsIn("atoll")).toEqual(new Map());

    for (const land of landings) land();
    await merging;
    await other;
    expect(commands.attemptsIn("harbor")).toEqual(
      new Map([[flowVerbKey(MERGE), { phase: "accepted" }]]),
    );
  });

  it("a second press while one runs is the same attempt", async () => {
    const { commands, answerWith, calls } = rig();
    let land: () => void = () => undefined;
    answerWith(() => new Promise<void>((resolve) => (land = resolve)));

    const first = commands.run(MERGE);
    const second = commands.run(MERGE);
    await flush();
    expect(commands.attempt(MERGE)).toEqual({ phase: "pending" });
    land();

    expect(await first).toEqual({ phase: "accepted" });
    expect(await second).toEqual({ phase: "accepted" });
    expect(calls).toEqual(["merge harbor/appdev#4"]);
  });
});

describe("a group flow's commands", () => {
  const KNOWN = {
    state: "known",
    asOf: { ordinal: 1, atMs: 1 },
    coverage: "complete",
    freshness: { kind: "live" },
  } as const;
  const stagesKnown = (repository: string): Shown<ReadonlyArray<ServiceRef>> => ({
    ...KNOWN,
    value: repository === "appdev" ? [APPSTAGE] : [],
  });
  const flow = (
    release: GroupFlow["release"],
    feeds: GroupFlow["feeds"] = stagesKnown,
  ): GroupFlow => ({
    groupId: "g1",
    slug: "harbor",
    pullRequests: { state: "unread", waitingFor: null },
    merged: { state: "unread", waitingFor: null },
    stops: { state: "unread", waitingFor: null },
    missing: { state: "unread", waitingFor: null },
    release,
    releaseContents: { state: "unread", waitingFor: null },
    releases: { state: "unread", waitingFor: null },
    releaseGate: { allowed: true },
    releaseAffordance: null,
    feeds,
  });
  const offer = {
    gate: { allowed: true },
    suggestion: "v1.0.1",
    comparison: [],
    entries: [{ service: "appdev", commit: HEAD }],
  } as const;

  it("a merge names the stages its repository feeds, and is not built until they are known", () => {
    const unread = { state: "unread", waitingFor: null } as const;
    expect(mergeCommand(flow(unread), GITEA, "appdev", 4, HEAD)).toEqual(MERGE);
    // A merge settled with no stage named would leave the stage it deploys to unread again.
    const reading = { state: "reading", sinceMs: 1, attempt: 1 } as const;
    expect(
      mergeCommand(
        flow(unread, () => reading),
        GITEA,
        "appdev",
        4,
        HEAD,
      ),
    ).toBeNull();
  });

  it("a release tags what the offer showed, and only a known offer", () => {
    const known = flow({
      state: "known",
      value: offer,
      asOf: { ordinal: 1, atMs: 1 },
      coverage: "complete",
      freshness: { kind: "live" },
    });
    expect(releaseCommand(known, GITEA)).toEqual(RELEASE);
    expect(releaseCommand(flow({ state: "reading", sinceMs: 1, attempt: 1 }), GITEA)).toBeNull();
  });

  it("verbs are addressed as surfaces call them: a pull request by its group's slug, a release by its group", () => {
    const flows = [
      flow({
        state: "known",
        value: offer,
        asOf: { ordinal: 1, atMs: 1 },
        coverage: "complete",
        freshness: { kind: "live" },
      }),
    ];

    expect(
      flowCommandFor(
        { kind: "merge", slug: "harbor", repository: "appdev", number: 4, head: HEAD },
        flows,
        GITEA,
      ),
    ).toEqual(MERGE);
    // A group whose flow is not read names no stage its merge feeds: there is none to build.
    expect(
      flowCommandFor(
        { kind: "merge", slug: "cove", repository: "appdev", number: 4, head: HEAD },
        flows,
        GITEA,
      ),
    ).toBeNull();
    const open = {
      kind: "open",
      slug: "harbor",
      repository: "appdev",
      head: "mate/ada",
      base: "main",
      title: "Add cart",
    } as const;
    expect(flowCommandFor(open, flows, GITEA)).toEqual({ ...open, origin: GITEA });
    expect(flowCommandFor({ kind: "release", groupId: "g1" }, flows, GITEA)).toEqual(RELEASE);
    expect(
      flowCommandFor({ kind: "roll-back", groupId: "g1", tag: "v1.0.0" }, flows, GITEA),
    ).toEqual({ kind: "roll-back", origin: GITEA, slug: "harbor", groupId: "g1", tag: "v1.0.0" });
    // A group whose flow is not read has no offer to tag and no slug to tag in.
    expect(flowCommandFor({ kind: "release", groupId: "g2" }, flows, GITEA)).toBeNull();
    expect(
      flowCommandFor({ kind: "roll-back", groupId: "g2", tag: "v1.0.0" }, flows, GITEA),
    ).toBeNull();
  });
});
