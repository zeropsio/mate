import { expect, it } from "vite-plus/test";

import {
  HQ_SESSIONS,
  KEPT_SESSION_LEAD_MS,
  makeKeptSessions,
  type KeptSessionStorage,
} from "./keptSessions.ts";

// witness: packages/client-runtime/src/zerops/keptSessions.ts | ended(session, KEPT_SESSION_LEAD_MS) ? null : session → ended(session, 0) ? null : session
it("ZV115: A kept session goes only to the target it was kept for, and one ending within the load is not presented", () => {
  const items = new Map<string, string>();
  const storage: KeptSessionStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  const nowMs = Date.parse("2026-11-20T12:00:00Z");
  const kept = makeKeptSessions(storage, () => nowMs, HQ_SESSIONS);
  const live = {
    address: "https://hq-a.example",
    token: "session-a",
    expiresAtEpochMs: nowMs + KEPT_SESSION_LEAD_MS + 60_000,
  };
  const ending = {
    address: "https://hq-b.example",
    token: "session-b",
    expiresAtEpochMs: nowMs + KEPT_SESSION_LEAD_MS - 60_000,
  };
  kept.keep("org-1:hq-a:https://hq-a.example", live);
  kept.keep("org-1:hq-b:https://hq-b.example", ending);

  expect(kept.read("org-1:hq-a:https://hq-a.example")).toEqual(live);
  expect(kept.read("org-2:hq-a:https://hq-a.example")).toBeNull();
  expect(kept.read("org-1:hq-b:https://hq-b.example")).toBeNull();
});
