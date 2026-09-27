import { EnvironmentId } from "@t3tools/contracts";
import type { CandidateLookup } from "@t3tools/client-runtime/zerops/projections";
import { describe, expect, it } from "vite-plus/test";

import { askMateTarget, askMateThread } from "./useAskMate";

const connected = EnvironmentId.make("environment-1");

describe("askMateTarget", () => {
  it.each<{
    readonly name: string;
    readonly lookup: CandidateLookup<{ readonly environmentId?: EnvironmentId }>;
    readonly target: object;
  }>([
    {
      name: "an unread listing sends the ask to the projects screen, which says what it still reads, never parks it unseen",
      lookup: { kind: "pending" },
      target: { kind: "projects" },
    },
    {
      name: "a Mate connected to an environment is asked there",
      lookup: { kind: "found", row: { environmentId: connected } },
      target: { kind: "environment", environmentId: connected },
    },
    {
      name: "a Mate not connected goes to the projects screen",
      lookup: { kind: "found", row: {} },
      target: { kind: "projects" },
    },
    {
      name: "a Mate proven absent goes to the projects screen",
      lookup: { kind: "absent" },
      target: { kind: "projects" },
    },
    {
      name: "a listing that cannot say goes to the projects screen, which says why",
      lookup: { kind: "unknown" },
      target: { kind: "projects" },
    },
  ])("$name", ({ lookup, target }) => {
    expect(askMateTarget(lookup)).toEqual(target);
  });
});

describe("askMateThread", () => {
  const thread = (id: string, fields: Record<string, unknown> = {}) => ({
    id,
    archivedAt: null,
    createdAt: "2026-09-27T08:00:00.000Z",
    updatedAt: "2026-09-27T08:00:00.000Z",
    ...fields,
  });
  const main = thread("main", { pinnedAt: "2026-09-27T08:00:00.000Z" });
  const logs = thread("logs");
  const crewThread = thread("crew-backend", {
    crew: { crew: "game", crewmate: "backend", stint: 1 },
  });
  const closed = thread("closed", { archivedAt: "2026-09-27T09:00:00.000Z" });
  const threads = [main, logs, crewThread, closed];

  it.each([
    { name: "no chat named asks in the main chat", threadId: undefined, asked: "main" },
    { name: "a person chat named is asked there", threadId: "logs", asked: "logs" },
    {
      name: "a crewmate's chat is never the person's: the main chat",
      threadId: "crew-backend",
      asked: "main",
    },
    { name: "a closed chat is not asked: the main chat", threadId: "closed", asked: "main" },
    { name: "a chat not of this Mate: the main chat", threadId: "elsewhere", asked: "main" },
  ])("$name", ({ threadId, asked }) => {
    expect(askMateThread(threads, threadId)?.id).toBe(asked);
  });
});
