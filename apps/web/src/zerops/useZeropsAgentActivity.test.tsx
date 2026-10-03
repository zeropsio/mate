import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsAgentActivity } from "./agentActivity";
import { LIVE_STEP_HOLD_MS, type LiveStepWords } from "./liveStep";
import { usePacedLiveSteps, zeropsAgentActivityOf } from "./useZeropsAgentActivity";

const NOVA = "env-nova" as EnvironmentId;

function activityWith(
  liveStep: LiveStepWords | undefined,
): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const entry = { kind: liveStep === undefined ? "idle" : "working" } as ZeropsAgentActivity;
  return new Map([[NOVA, liveStep === undefined ? entry : { ...entry, liveStep }]]);
}

function Row({
  activity,
}: {
  readonly activity: ReadonlyMap<EnvironmentId, ZeropsAgentActivity>;
}): ReactNode {
  const step = usePacedLiveSteps(activity).get(NOVA)?.liveStep;
  return step === undefined ? "…" : [step.words, step.code].filter(Boolean).join(" · ");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("usePacedLiveSteps", () => {
  it("shows a new step at most once per hold, and the latest when the hold ends", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: Date.parse("2026-09-29T08:00:00.000Z") });
    let row: ReactTestRenderer | undefined;
    const show = (liveStep: LiveStepWords | undefined) =>
      act(() => row!.update(<Row activity={activityWith(liveStep)} />));

    act(() => {
      row = create(<Row activity={activityWith({ words: "Thinking" })} />);
    });
    expect(row!.toJSON()).toBe("Thinking");

    // A quick read, and the command after it, within the hold: the line stays still.
    act(() => vi.advanceTimersByTime(100));
    show({ words: "Reading index.ts" });
    expect(row!.toJSON()).toBe("Thinking");
    act(() => vi.advanceTimersByTime(100));
    show({ words: "Build the app", code: "pnpm build" });
    expect(row!.toJSON()).toBe("Thinking");

    // The hold ends: the latest step, never the one it skipped.
    act(() => vi.advanceTimersByTime(LIVE_STEP_HOLD_MS - 200));
    expect(row!.toJSON()).toBe("Build the app · pnpm build");

    // A step that comes after the shown one has stood its hold shows at once.
    act(() => vi.advanceTimersByTime(LIVE_STEP_HOLD_MS));
    show({ words: "Thinking" });
    expect(row!.toJSON()).toBe("Thinking");

    // Stopping is never held.
    act(() => vi.advanceTimersByTime(50));
    show(undefined);
    expect(row!.toJSON()).toBe("…");
    act(() => row!.unmount());
  });
});

const ASKED = "2026-10-03T09:00:00.000Z";
const DONE = "2026-10-03T09:05:00.000Z";

/** Vera, online, her main chat done answering what she was asked. */
const VERA = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: true, since: ASKED, overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: {
    id: "t1",
    title: "Add a login page",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "ready", lastError: null },
    latestTurn: {
      turnId: "turn-1",
      state: "completed",
      requestedAt: ASKED,
      startedAt: ASKED,
      completedAt: DONE,
    },
    latestUserMessageAt: ASKED,
    updatedAt: DONE,
    latestUserMessagePreview: { text: "Add a login page" },
    latestMessagePreview: { role: "assistant", text: "The login page is up at /login." },
    planProgress: null,
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
  },
  threads: { list: [], omitted: 0 },
  logins: {},
  crew: null,
});

describe("zeropsAgentActivityOf", () => {
  it("a Mate's row reads its HQ overview with this device's visit", () => {
    const hq = { mates: new Map([["p-vera", VERA]]), current: true };
    const read = (visitedAt: string) =>
      zeropsAgentActivityOf({
        hq,
        threads: [],
        standing: new Set(),
        lastVisitedAtById: { "env-vera:t1": visitedAt },
      }).get("env-vera" as EnvironmentId);

    // Visited before it finished: done, and unread.
    expect(read(ASKED)).toMatchObject({
      threadId: "t1",
      threadKey: "env-vera:t1",
      kind: "done",
      face: "done",
      subject: "Add a login page",
      snippet: "The login page is up at /login.",
      at: DONE,
      unread: true,
    });
    expect(read(ASKED)?.remembered).toBeUndefined();
    // Visited since: at rest, read.
    expect(read("2026-10-03T09:10:00.000Z")).toMatchObject({ kind: "idle", unread: false });
  });
});

describe("zeropsAgentActivityOf — a socket's reading", () => {
  /** Vera's main chat as her socket read it: at work. */
  const WORKING: EnvironmentThreadShell = {
    id: ThreadId.make("t1"),
    environmentId: EnvironmentId.make("env-vera"),
    projectId: ProjectId.make("project-1"),
    title: "Add a login page",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TurnId.make("turn-1"),
      state: "running",
      requestedAt: ASKED,
      startedAt: ASKED,
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: ASKED,
    updatedAt: ASKED,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: ASKED,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
  const read = (input: {
    readonly standing: boolean;
    readonly hq: {
      readonly mates: ReadonlyMap<string, MateLiveView>;
      readonly current: boolean;
    } | null;
  }) =>
    zeropsAgentActivityOf({
      hq: input.hq,
      threads: [WORKING],
      standing: new Set(input.standing ? [EnvironmentId.make("env-vera")] : []),
      lastVisitedAtById: {},
    }).get(EnvironmentId.make("env-vera"));

  it("stands while its socket does, up or blinking, and rests once it no longer does", () => {
    expect(read({ standing: true, hq: null })).toMatchObject({ kind: "working" });
    expect(read({ standing: true, hq: null })?.remembered).toBeUndefined();
    expect(read({ standing: false, hq: null })).toMatchObject({ kind: "idle", remembered: true });
  });

  it("gives way to HQ's live word, and holds over HQ's word at rest", () => {
    const stored = {
      ...VERA,
      presence: { ...VERA.presence, online: false, overview: "stored" as const },
    };
    expect(
      read({ standing: false, hq: { mates: new Map([["p-vera", VERA]]), current: true } }),
    ).toMatchObject({
      kind: "idle",
      subject: "Add a login page",
      snippet: "The login page is up at /login.",
    });
    expect(
      read({ standing: false, hq: { mates: new Map([["p-vera", VERA]]), current: true } })
        ?.remembered,
    ).toBeUndefined();
    expect(
      read({ standing: true, hq: { mates: new Map([["p-vera", stored]]), current: true } }),
    ).toMatchObject({ kind: "working" });
  });
});
