import { NO_RESTARTS, readRestartRecovery, type MateRecovery } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";
import type { Reachability } from "@t3tools/client-runtime/zerops/environments";
import { mateArrivalNotice, mateNoticeVoice } from "./mateNoticeVoice";
import type { MateArrivalNoticeInput } from "./mateNoticeVoice";

it.each(["Karlos", "another person"])(
  "a direct Chief refusal names %s and leaves recovery to the header door",
  (chiefOwnerName) => {
    expect(
      mateNoticeVoice({
        reachability: { kind: "refused-role", chiefOwnerName },
        conversationShown: false,
        nowMs: 0,
        mateName: "Chief",
      }),
    ).toMatchObject({
      headline: `This is ${chiefOwnerName}'s Chief Mate.`,
      text: `This is ${chiefOwnerName}'s Chief Mate.`,
      actions: [],
      face: "sleep",
    });
  },
);

describe("the web Mate's link notice", () => {
  const say = (reachability: Reachability | null) =>
    mateNoticeVoice({ reachability, conversationShown: false, nowMs: 0, mateName: "Rosa" });
  it("A Mate HQ holds no link for says it is not connected to HQ and offers Try now, with a sleeping face", () => {
    const voice = say({ kind: "connecting", waitingOn: "mate-link" });
    expect(voice).toMatchObject({
      headline: "Rosa is not connected to HQ.",
      actions: ["try-now"],
      face: "sleep",
    });
    expect(voice).not.toHaveProperty("opening");
    expect(JSON.stringify(voice)).not.toContain("opening the conversation");
  });
  it.each(["restarting", "updating"] as const)("speaks %s only from platform evidence", (level) => {
    expect(
      say({
        kind: "ready",
        notice:
          level === "restarting"
            ? { level, by: "platform", overdue: false }
            : { level, overdue: false },
      }),
    ).toMatchObject({
      surface: "stage",
      face: "waking",
      text:
        level === "restarting"
          ? "Rosa is restarting. Rosa is trying the classic off-and-on trick."
          : "Rosa is updating. The conversation will open once the update finishes.",
    });
  });
  it("an overdue restart retains the source's recovery actions", () => {
    expect(
      say({ kind: "container", container: { level: "restarting", by: "platform", overdue: true } }),
    ).toMatchObject({
      actions: ["try-now", "restart"],
      face: "sleep",
    });
  });
  it("an existing conversation keeps its restart notice beside the conversation", () => {
    expect(
      mateNoticeVoice({
        reachability: { kind: "ready", notice: { level: "restarting", by: "you", overdue: false } },
        conversationShown: true,
        nowMs: 0,
        mateName: "Rosa",
      }),
    ).toMatchObject({ surface: "banner", face: "waking" });
  });
  // Run 2: an automatic update restarted the Mate right after its answer, and the conversation
  // said it "isn't answering", counting down, with Try now.
  it("an update beside the conversation reads as one: back in a moment, nothing to press", () => {
    expect(
      mateNoticeVoice({
        reachability: { kind: "container", container: { level: "updating", overdue: false } },
        conversationShown: true,
        nowMs: 0,
        mateName: "Rosa",
      }),
    ).toMatchObject({
      surface: "banner",
      headline: "Rosa is updating to the new version.",
      secondary: "Back in a moment.",
      severity: "info",
      actions: [],
      face: "waking",
    });
  });
  it("a lost link does not claim a restart or a return time", () => {
    expect(say({ kind: "reconnecting" })).toMatchObject({
      text: "Rosa is reconnecting. The conversation will open when the connection returns.",
      face: "sleep",
      actions: ["open-in-zerops"],
    });
  });
  it("an unread conversation has a visible opening state immediately", () => {
    expect(say(null)).toMatchObject({
      text: "Rosa is opening the conversation. Picking up where it left off.",
      face: "sleep",
      opening: true,
    });
  });
  it.each([
    null,
    { kind: "resolving" },
    { kind: "connecting", waitingOn: "exchange" },
    { kind: "connecting", waitingOn: "descriptor" },
    { kind: "connecting", waitingOn: "access" },
    { kind: "reconnecting" },
  ] satisfies Array<Reachability | null>)("an active attempt offers no retry: %j", (state) => {
    expect(say(state)).toMatchObject({
      actions: state?.kind === "reconnecting" ? ["open-in-zerops"] : [],
    });
  });
  it.each([
    { kind: "not-answering", overdue: false },
    { kind: "refused-configuration" },
    { kind: "refused-credential" },
    { kind: "retrying", retryAtMs: 5_000, last: { kind: "network" }, restart: false },
  ] satisfies Reachability[])("failure evidence offers recovery: %j", (state) => {
    expect(say(state)).toMatchObject({
      actions:
        state.kind === "not-answering" || state.kind === "retrying"
          ? [expect.stringMatching(/^try-/), "open-in-zerops"]
          : [expect.stringMatching(/^try-/)],
    });
  });
  it("keeps the real retry deadline and its action", () => {
    expect(
      say({ kind: "retrying", retryAtMs: 5_000, last: { kind: "network" }, restart: false }),
    ).toMatchObject({
      text: "Rosa is reconnecting. Rosa isn't answering. Trying again in 5 s.",
      actions: ["try-now", "open-in-zerops"],
    });
  });
  it("a provisioning container has no estimated finish time", () => {
    expect(
      say({ kind: "container", container: { level: "provisioning", overdue: false } }),
    ).toMatchObject({
      text: "Rosa is getting ready. Zerops is preparing the container.",
      actions: [],
    });
  });
  it("a stopped container retains Start and Try now", () => {
    expect(
      say({ kind: "container", container: { level: "inactive", status: "STOPPED" } }),
    ).toMatchObject({
      text: "Rosa's container is stopped. Start Rosa to reconnect.",
      actions: ["start"],
    });
  });
  it("leaves a ready conversation quiet", () => {
    expect(say({ kind: "ready", notice: null })).toEqual({ surface: "none" });
  });
});

it.each([
  ["RUNNING", "unknown", true],
  ["PENDING", "unknown", true],
  ["FAILED", "unknown", false],
  ["RUNNING", "denied", false],
  ["RUNNING", "deleted", false],
] as const)("restart moments follow the current process (%s, %s)", (status, kind, plays) => {
  const voice = mateNoticeVoice({
    mateName: "Rosa",
    nowMs: 0,
    conversationShown: false,
    reachability: { kind: "not-answering", overdue: false },
    recovery: liveRecovery({
      standing: kind === "unknown" ? { kind } : { kind, name: "Rosa" },
      status: status === "FAILED" ? "ACTION_FAILED" : "ACTIVE",
      process: {
        id: "restart",
        actionName: "stack.restart",
        status,
        created: "2026-10-07",
        projectId: "p",
        serviceStackIds: ["s"],
      },
    }),
  });
  expect(voice.surface).toBe("stage");
  expect("restarting" in voice && voice.restarting === true).toBe(plays);
  if (plays)
    expect(voice).toMatchObject({
      headline: "Rosa is restarting.",
      secondary: expect.stringContaining("Rosa"),
    });
});

describe("an unreachable Mate's last-known state", () => {
  it.each([false, true])(
    "labels the source state and time beside the conversation: %s",
    (conversationShown) => {
      expect(
        mateNoticeVoice({
          reachability: { kind: "not-answering", overdue: false },
          conversationShown,
          nowMs: 0,
          mateName: "Skákala",
          lastKnown: "Last known 14:20: Skákala hit the Claude limit.",
        }),
      ).toMatchObject({
        surface: conversationShown ? "banner" : "stage",
        headline: "Skákala isn't answering.",
        secondary: "Last known 14:20: Skákala hit the Claude limit.",
        actions: ["try-now", "open-in-zerops"],
      });
    },
  );
  it("says only that it isn't answering where HQ knows nothing", () => {
    expect(
      mateNoticeVoice({
        reachability: { kind: "not-answering", overdue: false },
        conversationShown: false,
        nowMs: 0,
        mateName: "Rosa",
      }),
    ).toMatchObject({ headline: "Rosa isn't answering.", secondary: "" });
  });
  it("does not show the held state over a ready connection", () => {
    expect(
      mateNoticeVoice({
        reachability: { kind: "ready", notice: null },
        conversationShown: true,
        nowMs: 0,
        mateName: "Rosa",
        lastKnown: "Last known 14:20: Rosa hit the Claude limit.",
      }),
    ).toEqual({ surface: "none" });
  });
});

it("an ongoing restart keeps the last-known state alongside every notice line", () => {
  const held = "Last known 14:20: Rosa hit the Claude limit.";
  const voice = mateNoticeVoice({
    mateName: "Rosa",
    nowMs: 0,
    conversationShown: true,
    reachability: { kind: "not-answering", overdue: false },
    lastKnown: held,
    recovery: liveRecovery({
      standing: { kind: "unknown" },
      status: "ACTIVE",
      process: {
        id: "restart",
        actionName: "stack.restart",
        status: "RUNNING",
        created: "2026-10-07",
        projectId: "p",
        serviceStackIds: ["s"],
      },
    }),
  });
  expect(voice).toMatchObject({
    surface: "banner",
    headline: "Rosa is restarting.",
    secondary: expect.stringContaining(held),
  });
  expect("restartLines" in voice && voice.restartLines?.every((line) => line.includes(held))).toBe(
    true,
  );
});

it("a failed restart separates its cause and Details while retaining last-known words", () => {
  expect(
    mateNoticeVoice({
      reachability: { kind: "not-answering", overdue: false },
      recovery: liveRecovery({
        standing: { kind: "unknown" },
        status: "ACTION_FAILED",
        process: {
          id: "restart",
          actionName: "stack.restart",
          status: "FAILED",
          created: "2026-10-07",
          projectId: "p",
          serviceStackIds: ["s"],
          failReason: "500: Internal Server Error",
        },
      }),
      conversationShown: false,
      nowMs: 0,
      mateName: "Eddy",
      lastKnown: "Eddy was last working on the build.",
    }),
  ).toMatchObject({
    headline: "Eddy couldn't restart.",
    secondary: "Zerops returned an error while restarting. Eddy was last working on the build.",
    details: "500: Internal Server Error",
    actions: ["restart", "open-in-zerops"],
  });
});

it("uses the offline source time without turning retained work time into outage onset", () => {
  expect(
    mateNoticeVoice({
      reachability: { kind: "not-answering", overdue: false },
      conversationShown: false,
      nowMs: Date.parse("2026-10-08T11:00:00Z"),
      mateName: "Eddy",
      offlineSince: new Date().toISOString(),
      timestampFormat: "24-hour",
      lastKnown: "Last known 09:20: Eddy was working.",
    }),
  ).toMatchObject({
    headline: expect.stringContaining("Eddy isn't answering since"),
    secondary: "Last known 09:20: Eddy was working.",
    actions: ["try-now", "open-in-zerops"],
  });
});

it("a recovered Mate does not repeat its old failed process as a connection banner", () => {
  expect(
    mateNoticeVoice({
      mateName: "Eddy",
      conversationShown: true,
      reachability: { kind: "ready", notice: null },
      nowMs: 0,
      recovery: liveRecovery({
        standing: { kind: "unknown" },
        status: "ACTIVE",
        process: {
          id: "restart-private",
          projectId: "p",
          serviceStackIds: ["s"],
          actionName: "stack.restart",
          status: "FAILED",
          created: "2026-10-08T10:00:00Z",
          finished: "2026-10-08T10:15:00Z",
          failReason: "platform error",
        },
      }),
    }),
  ).toMatchObject({ surface: "none" });
});

it.each(["denied", "deleted"] as const)(
  "%s project evidence keeps an old running recovery process asleep",
  (kind) => {
    const voice = mateNoticeVoice({
      mateName: "Vera",
      conversationShown: true,
      nowMs: 0,
      reachability: { kind: "ready", notice: null },
      recovery: {
        standing: { kind },
        status: undefined,
        process: {
          id: "restart",
          projectId: "p",
          serviceStackIds: ["s"],
          created: "2026-10-08",
          actionName: "stack.restart",
          status: "RUNNING",
        },
      },
    });
    expect(voice).toMatchObject({ surface: "banner", face: "sleep", actions: ["go-to-projects"] });
    expect(voice).not.toHaveProperty("restarting");
  },
);
function liveRecovery(read: MateRecovery): MateRecovery {
  if (read.standing.kind === "denied" || read.standing.kind === "deleted")
    return { ...read, lifecycle: undefined };
  return {
    ...read,
    lifecycle: readRestartRecovery(
      { ...NO_RESTARTS, running: read.process === undefined ? [] : [read.process.id] },
      read.process,
      read.status,
    ),
  };
}

describe("the missing-deployment notice", () => {
  it.each<{ readonly sentence: string; readonly oldSetup: Partial<MateArrivalNoticeInput> }>([
    {
      sentence: "A missing deployment keeps its current line over an old setup failure",
      oldSetup: { failureReason: "Setup stopped." },
    },
    {
      sentence: "A missing deployment keeps its current line over a stopped setup step",
      oldSetup: {
        progress: { press: [{ id: "setup", label: "Setup", state: "failed", why: "Old failure" }] },
      },
    },
    {
      sentence: "A missing deployment does not show an old setup retry refusal as its recovery",
      oldSetup: {
        attemptId: "old",
        refusal: { kind: "retry", attemptId: "old", details: "Old retry refusal" },
      },
    },
  ])("$sentence", ({ oldSetup }) => {
    expect(
      mateArrivalNotice({
        coming: { kind: "failed", line: "Nothing is deployed yet.", verb: "redeploy" },
        progress: undefined,
        ...oldSetup,
      }).secondary,
    ).toBe("Nothing is deployed yet.");
  });
});

it("a creation page calls a Mate coming up late only where its arrival's verdict says so, never past four minutes alone", () => {
  // Ten minutes in: the clock alone says nothing new.
  const startedAt = "2026-10-15T10:00:00.000Z";
  const say = (line: string) =>
    mateArrivalNotice({ coming: { kind: "coming", line }, progress: { startedAt } }).secondary;
  expect(say("Coming up. A few minutes.")).toBe("Usually two to four minutes.");
  expect(say("Taking longer than usual.")).toBe("Taking longer than usual.");
});

// Run 2 (2026-10-16): "Almost there." came with the clock at 2:00, 76 s before the Mate did.
it("a creation page says Almost there only once its Mate is up and its conversation being read", () => {
  const say = (line: string) =>
    mateArrivalNotice({ coming: { kind: "coming", line }, progress: undefined }).secondary;
  expect(say("Coming up. A few minutes.")).toBe("Usually two to four minutes.");
  expect(say("Almost there.")).toBe("Almost there.");
});
