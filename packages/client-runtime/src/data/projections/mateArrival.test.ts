import { describe, expect, it } from "vite-plus/test";
import { mateArrival } from "./mateArrival.ts";

const ready = {
  connected: true,
  shell: "live",
  hasConversation: true,
  detail: "live",
  detailHeld: true,
  signInKnown: true,
  cameUp: true,
} as const;
describe("arrival source evidence", () => {
  it.each([
    { patch: {}, want: "conversation" },
    { patch: { connected: false }, want: "wait" },
    { patch: { signInKnown: false }, want: "wait" },
    { patch: { detail: "synchronizing" }, want: "wait" },
    { patch: { hasConversation: false, shell: "empty" }, want: "wait" },
    { patch: { hasConversation: false, shell: "cached" }, want: "wait" },
    { patch: { hasConversation: false }, want: "create-conversation" },
    { patch: { cameUp: false, detail: "cached" }, want: "conversation" },
  ] as const)("$patch → $want", ({ patch, want }) => {
    expect(mateArrival({ ...ready, ...patch })).toBe(want);
  });
});
