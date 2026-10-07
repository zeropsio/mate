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
          ? "I'm restarting. A little stretch, then back to work."
          : "I'm updating. Back once the update finishes.",
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
      text: "I'm reconnecting. Your conversation will open when I'm back.",
      face: "sleep",
      actions: ["try-now"],
    });
  });
  it("an unread conversation has a visible opening state immediately", () => {
    expect(say(null)).toMatchObject({ text: "I'm opening the conversation.", face: "idle" });
  });
  it("keeps the real retry deadline and its action", () => {
    expect(
      say({ kind: "retrying", retryAtMs: 5_000, last: { kind: "network" }, restart: false }),
    ).toMatchObject({
      text: "I'm having trouble connecting. Trying again in 5 s.",
      actions: ["try-now"],
    });
  });
  it("a provisioning container has no estimated finish time", () => {
    expect(
      say({ kind: "container", container: { level: "provisioning", overdue: false } }),
    ).toMatchObject({
      text: "I'm getting ready.",
      actions: [],
    });
  });
  it("a stopped container retains Start and Try now", () => {
    expect(
      say({ kind: "container", container: { level: "inactive", status: "STOPPED" } }),
    ).toMatchObject({
      text: "I'm stopped.",
      actions: ["try-now", "start"],
    });
  });
  it("leaves a ready conversation quiet", () => {
    expect(say({ kind: "ready", notice: null })).toEqual({ surface: "none" });
  });
});
