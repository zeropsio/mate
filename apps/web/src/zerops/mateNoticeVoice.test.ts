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
          ? "Rosa is restarting. A little stretch, then back to work."
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
      text: "Rosa is opening the conversation. Waiting for the conversation to be read.",
      face: "idle",
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
