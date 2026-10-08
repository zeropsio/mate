import { describe, expect, it } from "vite-plus/test";
import type { Reachability } from "@t3tools/client-runtime/zerops/environments";
import { mateNoticeVoice } from "./mateNoticeVoice";

describe("the web Mate's link notice", () => {
  const say = (reachability: Reachability | null) =>
    mateNoticeVoice({ reachability, conversationShown: false, nowMs: 0, mateName: "Rosa" });
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
  it("a lost link does not claim a restart or a return time", () => {
    expect(say({ kind: "reconnecting" })).toMatchObject({
      text: "Rosa is reconnecting. The conversation will open when the connection returns.",
      face: "sleep",
      actions: [],
    });
  });
  it("an unread conversation has a visible opening state immediately", () => {
    expect(say(null)).toMatchObject({
      text: "Rosa is opening the conversation. Picking up where you left off.",
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
    expect(say(state)).toMatchObject({ actions: [] });
  });
  it.each([
    { kind: "not-answering", overdue: false },
    { kind: "refused-configuration" },
    { kind: "refused-credential" },
    { kind: "retrying", retryAtMs: 5_000, last: { kind: "network" }, restart: false },
  ] satisfies Reachability[])("failure evidence offers recovery: %j", (state) => {
    expect(say(state)).toMatchObject({ actions: [expect.stringMatching(/^try-/)] });
  });
  it("keeps the real retry deadline and its action", () => {
    expect(
      say({ kind: "retrying", retryAtMs: 5_000, last: { kind: "network" }, restart: false }),
    ).toMatchObject({
      text: "Rosa is reconnecting. Rosa isn't answering. Trying again in 5 s.",
      actions: ["try-now"],
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
    recovery: {
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
    },
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
        actions: ["try-now"],
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
    recovery: {
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
    },
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
      recovery: {
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
      },
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

