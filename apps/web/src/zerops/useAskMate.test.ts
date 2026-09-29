import { EnvironmentId } from "@t3tools/contracts";
import type { CandidateLookup } from "@t3tools/client-runtime/zerops/projections";
import { describe, expect, it } from "vite-plus/test";

import { askMateTarget, askMateThread, askedDraft } from "./useAskMate";

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

describe("askedDraft: a request left unsent joins what the person had typed, never replaces it", () => {
  const ASK = 'On #2 "Add a /status page" on appdev: ';
  it.each([
    ["nothing typed: the request alone", undefined, ASK],
    ["an empty box: the request alone", "", ASK],
    ["only blank lines: the request alone", "\n  \n", ASK],
    [
      "the person's words: kept, the request after a blank line, where they go on typing",
      "and keep the footer as it is",
      `and keep the footer as it is\n\n${ASK}`,
    ],
    [
      "words that end in blank lines: one blank line between",
      "and keep the footer as it is\n\n\n",
      `and keep the footer as it is\n\n${ASK}`,
    ],
    [
      "the same request already last, pressed twice: left as it is",
      `and keep the footer as it is\n\n${ASK}`,
      `and keep the footer as it is\n\n${ASK}`,
    ],
  ])("%s", (_case, draft, prompt) => {
    expect(askedDraft(draft, ASK)).toBe(prompt);
  });
});
