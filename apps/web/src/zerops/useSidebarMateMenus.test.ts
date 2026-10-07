import type { EnvironmentId } from "@t3tools/contracts";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsMenuEntry } from "~/components/zerops/ZeropsProjectMenu";

import type { ZeropsAgentActivity } from "./agentActivity";
import { createMateMenuReader, mateMenuTarget, sidebarMateVerbs } from "./useSidebarMateMenus";

const entry = (id: string, label: string): ZeropsMenuEntry => ({ id, label, onSelect: () => {} });

describe("sidebarMateVerbs — the shared verbs a Mate's own menu carries", () => {
  it("keeps start or restart, Finish setup, hand over and move, in the menu's own words", () => {
    const verbs = sidebarMateVerbs([
      entry("restart", "Restart"),
      { id: "quick", separator: true },
      entry("rename-agent", "Rename Mate"),
      entry("face", "Change face…"),
      entry("finish-setup", "Finish setup"),
      entry("assign", "Hand this Mate over"),
      entry("move", "Change project or role"),
      entry("leave", "Leave the project"),
      { id: "version", separator: true },
      entry("server-version", "Server 0.11.53"),
    ]);
    expect(verbs.map((verb) => ("label" in verb ? verb.label : "—"))).toEqual([
      "Restart",
      // Without it a half-made Mate had no way to be finished from the left menu (2026-10-01).
      "Finish setup",
      "Hand over…",
      "Move to project…",
    ]);
  });

  it("keeps Delete, in its own words and its red", () => {
    const verbs = sidebarMateVerbs([
      entry("restart", "Restart"),
      { id: "version", separator: true },
      { id: "delete", label: "Delete Quinn…", variant: "destructive", onSelect: () => {} },
    ]);
    expect(verbs.map((verb) => verb.id)).toEqual(["restart", "delete"]);
    expect(verbs[1]).toMatchObject({ label: "Delete Quinn…", variant: "destructive" });
  });

  it("leaves Change face… to the menu's own place for it, beside Rename", () => {
    expect(sidebarMateVerbs([entry("face", "Change face…")])).toEqual([]);
  });

  it("keeps Start in place of Restart where the Mate is stopped", () => {
    expect(sidebarMateVerbs([entry("start", "Start")]).map((verb) => verb.id)).toEqual(["start"]);
  });
});

const AT = "2026-10-03T09:00:00.000Z";
const DONE = "2026-10-03T09:05:00.000Z";

/** Vera as HQ tells her: her main chat finished a turn. */
const VERA = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: true, since: AT, overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: {
    id: "t1",
    title: "Add a login page",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: null,
    latestTurn: {
      turnId: "turn-1",
      state: "completed",
      requestedAt: AT,
      startedAt: AT,
      completedAt: DONE,
    },
    latestUserMessageAt: AT,
    updatedAt: DONE,
    latestUserMessagePreview: null,
    latestMessagePreview: null,
    planProgress: null,
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
  },
});

describe("mateMenuTarget — where a Mate's own menu acts", () => {
  const activity = { threadId: "t1", threadKey: "env-vera:t1" } as ZeropsAgentActivity;

  it("acts on an unopened Mate's main chat by HQ's word of it", () => {
    expect(
      mateMenuTarget({ environmentId: undefined, told: VERA, activity, completedAt: new Map() }),
    ).toEqual({ environmentId: "env-vera", finished: DONE });
  });

  it("takes this page's own shell of the chat over HQ's word", () => {
    const shell = "2026-10-03T09:06:00.000Z";
    expect(
      mateMenuTarget({
        environmentId: "env-vera" as EnvironmentId,
        told: VERA,
        activity,
        completedAt: new Map([["env-vera:t1", shell]]),
      }),
    ).toEqual({ environmentId: "env-vera", finished: shell });
  });

  it("stops a working Mate this page holds no socket to on HQ's environment", () => {
    const working = { ...activity, face: "working" } as ZeropsAgentActivity;
    expect(
      mateMenuTarget({
        environmentId: undefined,
        told: VERA,
        activity: working,
        completedAt: new Map(),
      }).stop,
    ).toEqual({ environmentId: "env-vera", input: { threadId: "t1" } });
  });
});

it("finishing one Mate keeps every other row's menu actions and refreshed factories act on current inputs", () => {
  const read = createMateMenuReader<{
    readonly finished: string | undefined;
    readonly act: () => string;
  }>();
  const candidates = Array.from({ length: 30 }, (_, i) => ({
    project: { id: `mate-${i}` },
  })) as unknown as ReadonlyArray<import("./useZeropsCandidates").ZeropsCandidatePresentation>;
  const activities = candidates.map((_, i) => ({ threadKey: `env-${i}:thread-${i}` }));
  let builds = 0;
  let finished = new Map<string, string>();
  const actions = (current: string) =>
    candidates.map((candidate, i) =>
      read(candidate, [activities[i], finished.get(activities[i]!.threadKey)], () => {
        builds++;
        return { finished: finished.get(activities[i]!.threadKey), act: () => current };
      }),
    );
  const before = actions("before");
  builds = 0;
  finished = new Map([[activities[0]!.threadKey, "2026-10-07T00:00:00Z"]]);
  const after = actions("after");
  expect(builds).toBe(1);
  expect(after.slice(1)).toEqual(before.slice(1));
  expect(after[1]).toBe(before[1]);
  expect(after[0]?.act()).toBe("after");
  expect(after[0]?.finished).toBe("2026-10-07T00:00:00Z");
});
