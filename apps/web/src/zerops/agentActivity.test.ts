import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ThreadLiveStep,
} from "@t3tools/contracts";
import { MateLiveView } from "@t3tools/shared/hqMates";
import { SECRET_MASK } from "@t3tools/shared/messagePreview";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  agentActivityAt,
  agentActivityAwaitsWords,
  agentActivityErrorLine,
  agentActivitySnippet,
  agentActivitySubject,
  deriveZeropsAgentActivity,
  mateFaceFor,
  mateFaceOf,
  mateReviewWaits,
  overviewAgentActivity,
  restingActivity,
  threadAgentActivity,
} from "./agentActivity";

const FEN = EnvironmentId.make("env-fen");
const OTTO = EnvironmentId.make("env-otto");

function shell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: FEN,
    projectId: ProjectId.make("project-1"),
    title: "Add the login page",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-09-05T10:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const RUNNING = shell({
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:00.000Z",
    completedAt: null,
    assistantMessageId: null,
  },
});

// One rule for "its change waits for your review" wherever a Mate's face is drawn: the composer's
// top's (`mateNextStep`), on a flow HQ answered.
describe("mateReviewWaits — a Mate's own change waits for the person's review", () => {
  const pull = (overrides: Partial<FlowPullRequest> = {}): FlowPullRequest =>
    ({
      repository: "appdev",
      number: 2,
      title: "Add a page",
      kind: "code",
      mateProjectId: "nova",
      mergeability: "mergeable",
      merged: false,
      ...overrides,
    }) as FlowPullRequest;
  it.each([
    { case: "its change merges", flow: { pullRequests: [pull()] }, waits: true },
    { case: "the flow unread", flow: undefined, waits: false },
    {
      case: "HQ not answered yet",
      flow: { pullRequests: [pull()], changesKnown: false },
      waits: false,
    },
    {
      case: "another Mate's change",
      flow: { pullRequests: [pull({ mateProjectId: "kai" })] },
      waits: false,
    },
    {
      case: "still being checked: it waits on HQ",
      flow: { pullRequests: [pull({ mergeability: "checking" })] },
      waits: false,
    },
    {
      case: "a recipe change is the project's",
      flow: { pullRequests: [pull({ kind: "recipe" })] },
      waits: false,
    },
  ])("$case", ({ flow, waits }) => {
    expect(mateReviewWaits(flow, "nova")).toBe(waits);
  });
});

describe("mateFaceOf — the face a Mate wears wherever it is drawn", () => {
  it.each([
    { case: "asking, no review", connected: true, face: "needs", review: false, shown: "needs" },
    {
      case: "at rest, its review waits",
      connected: true,
      face: "idle",
      review: true,
      shown: "needs",
    },
    {
      case: "at work, its review waits: the work shows",
      connected: true,
      face: "working",
      review: true,
      shown: "working",
    },
    {
      case: "not connected, its review waits",
      connected: false,
      face: undefined,
      review: true,
      shown: "needs",
    },
    {
      case: "not connected, nothing waits",
      connected: false,
      face: undefined,
      review: false,
      shown: "sleep",
    },
    {
      case: "not connected, HQ's live word says it asks",
      connected: false,
      face: "needs",
      review: false,
      shown: "needs",
    },
    {
      case: "not connected, only a word at rest",
      connected: false,
      face: "needs",
      atRest: true,
      review: false,
      shown: "sleep",
    },
    {
      case: "connected, only a word at rest",
      connected: true,
      face: "working",
      atRest: true,
      review: false,
      shown: "idle",
    },
  ] as const)("$case", (row) => {
    const { connected, face, review, shown } = row;
    const atRest = "atRest" in row ? { remembered: true as const } : {};
    expect(
      mateFaceOf({
        connected,
        activity: face === undefined ? undefined : { face, ...atRest },
        reviewWaits: review,
        mine: true,
        pose: undefined,
      }),
    ).toBe(shown);
  });

  // Waiting on you is claimed only by your own Mate — the one HQ says waits on you, you signed it
  // in (the owner, 2026-09-30: "sana doesn't wait for me, it waits for karlos"). Another's Mate waits on its
  // owner: it wears no needs face here, though its change can still be reviewed and merged.
  describe("waits on you only when it is yours", () => {
    it.each([
      {
        case: "own Mate, its change waits",
        mine: true,
        face: "idle",
        review: true,
        shown: "needs",
      },
      {
        case: "another's Mate, its change waits",
        mine: false,
        face: "idle",
        review: true,
        shown: "idle",
      },
      {
        case: "own Mate, its question waits",
        mine: true,
        face: "needs",
        review: false,
        shown: "needs",
      },
      {
        case: "another's Mate, its question waits",
        mine: false,
        face: "needs",
        review: false,
        shown: "idle",
      },
      {
        case: "another's Mate at work: the work shows",
        mine: false,
        face: "working",
        review: true,
        shown: "working",
      },
    ] as const)("$case", ({ mine, face, review, shown }) => {
      expect(
        mateFaceOf({
          connected: true,
          activity: { face },
          reviewWaits: review,
          mine,
          pose: undefined,
        }),
      ).toBe(shown);
    });
  });

  it("keeps a Mate paused at its usage limit asleep, its review waiting or not", () => {
    expect(
      mateFaceOf({
        connected: true,
        activity: { face: "sleep", pausedUntil: "2026-09-29T23:00:00.000Z" },
        reviewWaits: true,
        mine: true,
        pose: undefined,
      }),
    ).toBe("sleep");
  });
});

describe("deriveZeropsAgentActivity", () => {
  it("answers per environment from its one conversation, through the one resolver", () => {
    const activity = deriveZeropsAgentActivity(
      [RUNNING, shell({ id: ThreadId.make("thread-2"), environmentId: OTTO })],
      {},
    );
    expect(activity.get(FEN)).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      kind: "working",
      status: { kind: "working", label: "Working", pulse: true },
      face: "working",
      subject: "Add the login page",
    });
    // Idle has no phrase of its own — the face says it — but the subject stays:
    // the line under the name keeps saying what this Mate is about.
    expect(activity.get(OTTO)).toMatchObject({
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Add the login page",
    });
  });

  it("knows nothing about an environment with no conversation", () => {
    expect(deriveZeropsAgentActivity([], {}).size).toBe(0);
  });

  it("prefers the running plan step as the subject when the server reports one", () => {
    const stepping = shell({
      ...RUNNING,
      planProgress: { step: "Wire the session cookie", completedSteps: 2, totalSteps: 5 },
    });
    expect(deriveZeropsAgentActivity([stepping], {}).get(FEN)?.subject).toBe(
      "Wire the session cookie",
    );
  });

  it("wears the needs-you face and says so when a conversation waits on an approval", () => {
    const waiting = shell({ hasPendingApprovals: true });
    expect(deriveZeropsAgentActivity([waiting], {}).get(FEN)).toMatchObject({
      kind: "approval",
      status: { kind: "approval", label: "Approval" },
      face: "needs",
      subject: "Add the login page",
    });
  });

  it("reads the client's visit marker so an unseen completion is done and a seen one idle", () => {
    const completed = shell({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-09-05T10:01:00.000Z",
        startedAt: "2026-09-05T10:01:00.000Z",
        completedAt: "2026-09-05T10:05:00.000Z",
        assistantMessageId: null,
      },
    });
    const key = `${FEN}:thread-1`;
    const unseen = deriveZeropsAgentActivity([completed], { [key]: "2026-09-05T10:04:00.000Z" });
    expect(unseen.get(FEN)).toMatchObject({ kind: "done", status: { kind: "done" }, face: "done" });
    const seen = deriveZeropsAgentActivity([completed], { [key]: "2026-09-05T10:06:00.000Z" });
    expect(seen.get(FEN)).toMatchObject({
      kind: "idle",
      status: null,
      subject: "Add the login page",
    });
  });
});

describe("threadAgentActivity", () => {
  it("answers for the chat it is given, not for the Mate's main one", () => {
    const main = shell({
      id: ThreadId.make("main"),
      pinnedAt: "2026-09-05T09:00:00.000Z",
      latestUserMessagePreview: {
        role: "user",
        text: "Fix pagination",
        createdAt: "2026-09-05T09:00:00.000Z",
      },
    });
    const logs = {
      ...RUNNING,
      id: ThreadId.make("logs"),
      latestUserMessagePreview: {
        role: "user" as const,
        text: "Why does /api/items 500?",
        createdAt: "2026-09-05T10:01:00.000Z",
      },
    };

    expect(deriveZeropsAgentActivity([main, logs], {}).get(FEN)?.threadId).toBe("main");
    expect(threadAgentActivity(logs, undefined)).toMatchObject({
      threadId: "logs",
      kind: "working",
      face: "working",
      subject: "Why does /api/items 500?",
    });
  });

  // Run 11 (D8): its turn over, its helpers at work, the menu read "Working on
  // a reply" while its card said "Waiting for its helpers".
  it("knows a Mate whose turn is over waits on its helpers, and one at work does not", () => {
    const after = shell({ backgroundLiveness: "working" });
    expect(threadAgentActivity(after, undefined)).toMatchObject({
      kind: "working",
      waitsOnHelpers: true,
    });
    const both = { ...RUNNING, backgroundLiveness: "working" as const };
    expect(threadAgentActivity(both, undefined).waitsOnHelpers).toBeUndefined();
  });
});

describe("agentActivitySubject", () => {
  it.each([
    ["idle", "Add the login page"],
    ["working", "Add the login page"],
    ["approval", "Add the login page"],
    ["done", "Add the login page"],
  ] as const)("for %s is the title on a server that keeps no preview", (kind, expected) => {
    expect(agentActivitySubject(shell(), kind)).toBe(expected);
  });

  it.each(["idle", "working", "done"] as const)(
    "for %s is the last task as the person put it, not the first task's title",
    (kind) => {
      // One conversation per environment: the title names the first task
      // forever; the row must say what the Mate was set on last.
      expect(
        agentActivitySubject(
          shell({
            title: "create todo app",
            latestUserMessagePreview: {
              role: "user",
              text: "give it optimistic updates",
              createdAt: "2026-09-06T01:55:00.000Z",
            },
          }),
          kind,
        ),
      ).toBe("give it optimistic updates");
    },
  );

  it("is the running step over the task while the server reports one", () => {
    expect(
      agentActivitySubject(
        shell({
          planProgress: { step: "Wire the toggle", completedSteps: 1, totalSteps: 3 },
          latestUserMessagePreview: {
            role: "user",
            text: "give it optimistic updates",
            createdAt: "2026-09-06T01:55:00.000Z",
          },
        }),
        "working",
      ),
    ).toBe("Wire the toggle");
  });

  it("has nothing to say for a conversation nobody has spoken into — its title is a placeholder", () => {
    expect(
      agentActivitySubject(shell({ title: "New thread", latestUserMessageAt: null }), "idle"),
    ).toBeUndefined();
  });

  it.each([
    ["the last message was a slash command", "/compact", "create todo app", "create todo app"],
    ["the title is one too", "/compact", "/compact", undefined],
    [
      "an image-only placeholder",
      "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]",
      "create todo app",
      "create todo app",
    ],
  ] as const)(
    "never names a command or the client's placeholder as the task: %s",
    (_label, preview, title, expected) => {
      expect(
        agentActivitySubject(
          shell({
            title,
            latestUserMessagePreview: {
              role: "user",
              text: preview,
              createdAt: "2026-09-06T01:55:00.000Z",
            },
          }),
          "idle",
        ),
      ).toBe(expected);
    },
  );

  it("has nothing to say for a blank step and a blank title", () => {
    expect(
      agentActivitySubject(
        shell({ title: " ", planProgress: { step: " ", completedSteps: 0, totalSteps: 1 } }),
        "working",
      ),
    ).toBeUndefined();
  });
});

describe("a row's words never quote a credential", () => {
  it("masks one in what was asked, and in what the Mate last said", () => {
    const pasted = shell({
      latestUserMessagePreview: {
        role: "user",
        text: "log in with SHOP_PASSWORD hunter2026 please",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
      latestMessagePreview: {
        role: "assistant",
        // A made-up password, put together so no scanner takes it for a leak.
        text: `Signed in. Heslo: ${["xK93mPq", "Lw2vNt8RzY4a"].join("_")} works on dev.`,
        createdAt: "2026-09-05T10:05:00.000Z",
      },
    });
    expect(agentActivitySubject(pasted, "idle")).toBe(
      `log in with SHOP_PASSWORD ${SECRET_MASK} please`,
    );
    expect(agentActivitySnippet(pasted)).toBe(`Signed in. Heslo: ${SECRET_MASK} works on dev.`);
  });
});

// Sent, the person's words are the last thing said until the Mate's first
// words back — also in the second before its run starts, when its last run
// has ended and the new one is not running yet (Nova, 2026-09-28: the row
// lost its last line in that second, 76 → 58 → 76 px).
describe("agentActivityAwaitsWords", () => {
  const asked = (text: string, at: string) => ({
    latestMessagePreview: { role: "user" as const, text, createdAt: at },
    latestUserMessageAt: at,
  });
  const turn = (state: "running" | "completed", completedAt: string | null) => ({
    latestTurn: {
      turnId: TurnId.make("turn-1"),
      state,
      requestedAt: "2026-09-05T10:01:00.000Z",
      startedAt: "2026-09-05T10:01:00.000Z",
      completedAt,
      assistantMessageId: null,
    },
  });

  it.each([
    [
      "sent after the last run ended, before the next one starts",
      {
        ...asked("and the footer", "2026-09-05T10:05:00.000Z"),
        ...turn("completed", "2026-09-05T10:04:00.000Z"),
      },
    ],
    [
      "the run answering them is under way",
      { ...asked("and the footer", "2026-09-05T10:05:00.000Z"), ...turn("running", null) },
    ],
    ["no run has answered anything yet", asked("add the login page", "2026-09-05T10:00:00.000Z")],
  ] as const)("waits for words when %s", (_, overrides) => {
    expect(agentActivityAwaitsWords(shell(overrides))).toBe(true);
  });

  it.each([
    [
      "the Mate's words are the last thing said",
      {
        latestMessagePreview: {
          role: "assistant" as const,
          text: "Done.",
          createdAt: "2026-09-05T10:06:00.000Z",
        },
      },
    ],
    [
      "the run that answered them ended without words",
      {
        ...asked("stop", "2026-09-05T10:05:00.000Z"),
        ...turn("completed", "2026-09-05T10:05:30.000Z"),
      },
    ],
    ["nobody has said anything", { latestMessagePreview: null, latestUserMessageAt: null }],
  ] as const)("waits for nothing when %s", (_, overrides) => {
    expect(agentActivityAwaitsWords(shell(overrides))).toBe(false);
  });
});

describe("agentActivitySnippet", () => {
  it("quotes the Mate's last words", () => {
    expect(
      agentActivitySnippet(
        shell({
          latestMessagePreview: {
            role: "assistant",
            text: "Done. The app is live.",
            createdAt: "2026-09-05T10:05:00.000Z",
          },
        }),
      ),
    ).toBe("Done. The app is live.");
  });

  it.each([
    ["a shell that carries none", {}],
    ["a conversation nobody has spoken into", { latestMessagePreview: null }],
    [
      "a conversation whose last word is the person's — the subject already says it",
      {
        latestMessagePreview: {
          role: "user",
          text: "add the login page",
          createdAt: "2026-09-05T10:00:00.000Z",
        },
      },
    ],
  ] as const)("has nothing to quote from %s", (_, overrides) => {
    expect(agentActivitySnippet(shell(overrides))).toBeUndefined();
  });

  it("rides along on the activity", () => {
    const activity = deriveZeropsAgentActivity(
      [
        shell({
          latestMessagePreview: {
            role: "assistant",
            text: "Deployed.",
            createdAt: "2026-09-05T10:05:00.000Z",
          },
        }),
      ],
      {},
    );
    expect(activity.get(FEN)?.snippet).toBe("Deployed.");
  });
});

describe("agentActivityAt", () => {
  const turn = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:05.000Z",
    completedAt: "2026-09-05T10:05:00.000Z",
    assistantMessageId: null,
  };

  it.each([
    ["the last turn's end when it has one", shell({ latestTurn: turn }), turn.completedAt],
    [
      "the turn's start while it still runs",
      shell({ latestTurn: { ...turn, state: "running", completedAt: null } }),
      turn.startedAt,
    ],
    [
      "the last message when no turn has run",
      shell({ latestTurn: null, latestUserMessageAt: "2026-09-05T09:00:00.000Z" }),
      "2026-09-05T09:00:00.000Z",
    ],
    [
      "the conversation's last change when nobody has spoken",
      shell({ latestTurn: null, latestUserMessageAt: null, updatedAt: "2026-09-04T08:00:00.000Z" }),
      "2026-09-04T08:00:00.000Z",
    ],
  ] as const)("is %s", (_, thread, expected) => {
    expect(agentActivityAt(thread)).toBe(expected);
  });
});

describe("mateFaceFor", () => {
  const cases = [
    { connected: false, activity: undefined, face: "sleep" },
    // Known before its socket is up, or read back from the last reload's
    // cache: the state of a conversation nobody is connected to is not a face.
    { connected: false, activity: { face: "working" }, face: "sleep" },
    { connected: true, activity: undefined, face: "idle" },
    { connected: true, activity: { face: "working" }, face: "working" },
    { connected: true, activity: { face: "needs" }, face: "needs" },
    { connected: true, activity: { face: "done" }, face: "done" },
  ] as const;

  it.each(cases)("wears $face when connected=$connected", ({ activity, connected, face }) => {
    expect(mateFaceFor(connected, activity)).toBe(face);
  });

  // Its pose (`matePose`) is read here, once, for every surface that draws the Mate: a row, the
  // ⌘K list, the projects pages, a conversation's header, the panel.
  it.each([
    {
      case: "coming up",
      connected: false,
      activity: undefined,
      pose: { life: "coming" },
      face: "waking",
    },
    {
      case: "arriving, its socket not up",
      connected: false,
      activity: undefined,
      pose: { arriving: true },
      face: "waking",
    },
    {
      case: "arriving, waiting for its sign-in",
      connected: true,
      activity: undefined,
      pose: { arriving: true },
      face: "waking",
    },
    {
      case: "arriving, at work",
      connected: true,
      activity: { face: "working" },
      pose: { arriving: true },
      face: "working",
    },
    {
      case: "past its window, never signed in",
      connected: true,
      activity: undefined,
      pose: { arriving: false },
      face: "idle",
    },
    {
      case: "did not come up",
      connected: false,
      activity: undefined,
      pose: { life: "failed" },
      face: "sleep",
    },
    {
      case: "deleting, at work",
      connected: true,
      activity: { face: "working" },
      pose: { life: "deleting" },
      face: "sleep",
    },
  ] as const)("wears $face: $case", ({ activity, connected, pose, face }) => {
    expect(mateFaceFor(connected, activity, pose)).toBe(face);
    expect(mateFaceOf({ connected, activity, reviewWaits: false, mine: false, pose })).toBe(face);
  });
});

describe("what a Mate's row says without words", () => {
  const COMPLETED = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:00.000Z",
    completedAt: "2026-09-05T10:05:00.000Z",
    assistantMessageId: null,
  };
  const key = "env-fen:thread-1";

  it.each([
    {
      case: "a completion after the last visit",
      visited: "2026-09-05T10:04:00.000Z",
      unread: true,
    },
    { case: "a completion seen since", visited: "2026-09-05T10:06:00.000Z", unread: false },
    { case: "never visited on this device", visited: undefined, unread: false },
  ])("is unread for $case", ({ visited, unread }) => {
    const activity = deriveZeropsAgentActivity(
      [shell({ latestTurn: COMPLETED })],
      visited === undefined ? {} : { [key]: visited },
    );
    expect(activity.get(FEN)?.unread).toBe(unread);
  });

  it("sleeps through a usage limit and says when it wakes", () => {
    const paused = shell({
      latestTurn: COMPLETED,
      usagePause: {
        resetsAt: "2026-09-05T14:20:00.000Z",
        window: "5-hour",
        held: 0,
        pausedAt: "2026-09-05T10:05:00.000Z",
        autoResume: true,
      },
    });
    const activity = deriveZeropsAgentActivity([paused], {}).get(FEN);
    expect(activity?.face).toBe("sleep");
    expect(activity?.pausedUntil).toBe("2026-09-05T14:20:00.000Z");
    expect(deriveZeropsAgentActivity([RUNNING], {}).get(FEN)?.pausedUntil).toBeUndefined();
  });

  it("a refused turn with no reset time still shows a calm usage pause", () => {
    const refused = shell({
      latestTurn: { ...COMPLETED, state: "error" },
      session: {
        threadId: ThreadId.make("thread-1"),
        status: "error",
        providerName: "claude-code",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: "Claude usage limit reached. Send the message again once the limit resets.",
        updatedAt: "2026-09-05T10:05:00.000Z",
      },
    });
    const activity = deriveZeropsAgentActivity([refused], {}).get(FEN);
    expect(activity?.face).toBe("sleep");
    expect(activity?.usageLimited).toBe(true);
    expect(activity?.pausedUntil).toBeUndefined();
    expect(activity?.errorLine).toBe(refused.session!.lastError);
  });

  it("names its conversation by the key a draft is kept under", () => {
    expect(deriveZeropsAgentActivity([RUNNING], {}).get(FEN)?.threadKey).toBe(key);
  });
});

describe("the task as the person asked it", () => {
  it("keeps the ask while the row says the running plan step", () => {
    const working = shell({
      ...RUNNING,
      latestUserMessagePreview: {
        role: "user",
        text: "Add a /status page",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
      planProgress: { step: "Run the build", completedSteps: 2, totalSteps: 5 },
    });
    const activity = deriveZeropsAgentActivity([working], {}).get(FEN);
    expect(activity?.subject).toBe("Run the build");
    expect(activity?.task).toBe("Add a /status page");
  });
});

describe("agentActivityErrorLine", () => {
  const session = (lastError: string | null): EnvironmentThreadShell["session"] => ({
    threadId: ThreadId.make("thread-1"),
    status: "error",
    providerName: null,
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError,
    updatedAt: "2026-09-29T08:00:00.000Z",
  });

  it.each<{
    readonly name: string;
    readonly lastError: string | null;
    readonly kind: Parameters<typeof agentActivityErrorLine>[1];
    readonly line: string | undefined;
  }>([
    {
      name: "a stopped Mate says the error's first line",
      lastError: "The type check found 2 errors\n  at src/gallery/grid.ts",
      kind: "failed",
      line: "The type check found 2 errors",
    },
    {
      name: "blank leading lines are skipped",
      lastError: "\n   \nProcess exited with code 137",
      kind: "failed",
      line: "Process exited with code 137",
    },
    {
      name: "a Mate that is not stopped says none, whatever its session kept",
      lastError: "The type check failed",
      kind: "idle",
      line: undefined,
    },
    { name: "no error kept, no line", lastError: null, kind: "failed", line: undefined },
    // F7: under the Mate's name, its sign-in failure says what the person signs in to.
    {
      name: "retains the source error for the named surface to present",
      lastError:
        "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
      kind: "failed",
      line: "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
    },
  ])("$name", ({ lastError, kind, line }) => {
    expect(agentActivityErrorLine({ session: session(lastError) }, kind).errorLine).toBe(line);
  });
});

const since = "2026-09-05T10:01:05.000Z";
const building: ThreadLiveStep = {
  kind: "calls",
  since,
  calls: [
    {
      id: "call-build",
      activityKind: "tool.updated",
      itemType: "command_execution",
      title: "Command run",
      detail: "Bash: npm run compile",
      toolName: "Bash",
      command: "npm run compile",
      input: { description: "Compile the gallery" },
      startedAt: since,
    },
  ],
};
const asking: ThreadLiveStep = {
  kind: "calls",
  since,
  calls: [
    {
      id: "call-ask",
      activityKind: "tool.updated",
      itemType: "dynamic_tool_call",
      title: "Tool call",
      detail: 'AskUserQuestion: {"questions":[{"question":"Ship it now?"}]}',
      toolName: "AskUserQuestion",
      startedAt: since,
    },
  ],
};

describe("the row's live step", () => {
  it.each<{
    readonly name: string;
    readonly thread: EnvironmentThreadShell;
    readonly liveStep: { readonly words: string } | undefined;
  }>([
    {
      name: "a working Mate says the step its card's now line says, never its code",
      thread: shell({ ...RUNNING, liveStep: building }),
      liveStep: { words: "Compile the gallery" },
    },
    {
      name: "between steps it thinks",
      thread: shell({ ...RUNNING, liveStep: { kind: "thinking", since } }),
      liveStep: { words: "Thinking" },
    },
    {
      name: "its words streaming, it writes",
      thread: shell({ ...RUNNING, liveStep: { kind: "writing", since } }),
      liveStep: { words: "Writing" },
    },
    {
      name: "asking, before the question reaches the shell: waiting for the answer",
      thread: shell({ ...RUNNING, liveStep: asking }),
      liveStep: { words: "Waiting for your answer" },
    },
    {
      name: "a server that relays no step: none, and the row holds its dots",
      thread: RUNNING,
      liveStep: undefined,
    },
    {
      name: "a Mate at rest has no step, whatever a shell still carries",
      thread: shell({ liveStep: building }),
      liveStep: undefined,
    },
    {
      name: "a Mate waiting on the person has no step: what it waits on is its line",
      thread: shell({ ...RUNNING, hasPendingUserInput: true, liveStep: asking }),
      liveStep: undefined,
    },
  ])("$name", ({ thread, liveStep }) => {
    expect(threadAgentActivity(thread, undefined).liveStep).toEqual(liveStep);
  });
});

describe("the question a needs-you row says", () => {
  it("retains a last-known question during an outage without claiming live activity", () => {
    const activity = restingActivity(
      threadAgentActivity(
        shell({
          hasPendingUserInput: true,
          pendingQuestion: "Which checkout should I inspect?",
        }),
        undefined,
      ),
    );
    expect(activity).toMatchObject({
      question: "Which checkout should I inspect?",
      kind: "idle",
      status: null,
      remembered: true,
    });
    expect(activity.liveStep).toBeUndefined();
  });

  it.each<{
    readonly name: string;
    readonly thread: EnvironmentThreadShell;
    readonly question: string | undefined;
  }>([
    {
      name: "a Mate waiting on its question says the question",
      thread: shell({
        ...RUNNING,
        hasPendingUserInput: true,
        pendingQuestion: "Ship the status page now, or after the review?",
        liveStep: asking,
      }),
      question: "Ship the status page now, or after the review?",
    },
    {
      name: "a server that relays no question: none, and the row keeps its last words",
      thread: shell({ hasPendingUserInput: true }),
      question: undefined,
    },
    {
      name: "an approval waits first: that is no question",
      thread: shell({
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        pendingQuestion: "Which colour?",
      }),
      question: undefined,
    },
    {
      name: "answered: no question",
      thread: shell({ pendingQuestion: null }),
      question: undefined,
    },
  ])("$name", ({ thread, question }) => {
    expect(threadAgentActivity(thread, undefined).question).toBe(question);
  });
});

const mateLiveView = Schema.decodeUnknownSync(MateLiveView);

describe("overviewAgentActivity", () => {
  const told = (main: unknown) =>
    mateLiveView({
      presence: { online: false, since: "2026-10-03T09:00:00.000Z", overview: "stored" },
      identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
      main,
    });

  it("keys the main chat HQ names under its environment — its draft's key — where it names one", () => {
    const main = {
      id: "t1",
      title: "Add a login page",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      interactionMode: "default",
      backgroundLiveness: null,
      session: null,
      latestTurn: null,
      latestUserMessageAt: null,
      updatedAt: "2026-10-03T09:00:00.000Z",
      latestUserMessagePreview: null,
      latestMessagePreview: null,
      planProgress: null,
      pendingQuestion: null,
      usagePause: null,
      liveStep: null,
    };
    expect(overviewAgentActivity(told(main), false, {})?.threadKey).toBe("env-vera:t1");
    expect(overviewAgentActivity(told(null), false, {})).toBeUndefined();
  });
});
