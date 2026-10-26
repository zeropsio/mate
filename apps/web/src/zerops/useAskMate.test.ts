import { CommandId, EnvironmentId, MessageId } from "@t3tools/contracts";
import type { CandidateLookup } from "@t3tools/client-runtime/zerops/projections";
import { describe, expect, it } from "vite-plus/test";

import { askMateTarget, askMateThread, askedDraft, pageSendIds } from "./useAskMate";

const connected = EnvironmentId.make("environment-1");

// The owner, 2026-09-30: "it just throws me at /zerops page". An ask to a Mate goes to that Mate:
// its conversation where it is connected, else its door (`useOpenMate`), which opens its own view
// until its conversation can be opened and writes the ask there then — never the projects screen,
// where the ask was lost.
describe("askMateTarget", () => {
  it.each<{
    readonly name: string;
    readonly lookup: CandidateLookup<{ readonly environmentId?: EnvironmentId }>;
    readonly target: object;
  }>([
    {
      name: "a Mate connected to an environment is asked there",
      lookup: { kind: "found", row: { environmentId: connected } },
      target: { kind: "environment", environmentId: connected },
    },
    {
      name: "a Mate not connected is asked through its door, which connects it",
      lookup: { kind: "found", row: {} },
      target: { kind: "mate" },
    },
    {
      name: "an unread listing: its door, whose view says what it still reads",
      lookup: { kind: "pending" },
      target: { kind: "mate" },
    },
    {
      name: "a listing that cannot say: its door, whose view says why",
      lookup: { kind: "unknown" },
      target: { kind: "mate" },
    },
    {
      name: "a Mate proven absent: its door, whose view says it is not on the account",
      lookup: { kind: "absent" },
      target: { kind: "mate" },
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

// Several changes per Mate, one per branch (several-changes design §5.11): a review's Ask and Fix
// go to the conversation bound to a lease on the change's branch — where that work happens — and
// only else to the main chat.
describe("askMateThread: a change's branch", () => {
  const thread = (id: string, fields: Record<string, unknown> = {}) => ({
    id,
    archivedAt: null,
    createdAt: "2026-10-25T08:00:00.000Z",
    updatedAt: "2026-10-25T08:00:00.000Z",
    ...fields,
  });
  const lease = (alias: string, branch: string | null) => ({
    lease: { alias, pool: alias.replace(/-\d+$/u, ""), branch },
  });
  const main = thread("main", { pinnedAt: "2026-10-25T08:00:00.000Z" });
  const badge = thread("badge", lease("hqpool-4", "badge"));
  const previews = thread("previews", {
    ...lease("hqpool-3", "pool-previews"),
    latestUserMessageAt: "2026-10-25T09:00:00.000Z",
  });
  const previewsToo = thread("previews-too", lease("boxpool-5", "pool-previews"));
  const crewBadge = thread("crew-badge", {
    ...lease("boxpool-6", "stamp"),
    crew: { crew: "game", crewmate: "backend", stint: 1 },
  });
  const closed = thread("closed", {
    ...lease("webpool-2", "old"),
    archivedAt: "2026-10-25T09:00:00.000Z",
  });
  const unbranched = thread("unbranched", lease("webpool-3", null));
  const threads = [main, badge, previews, previewsToo, crewBadge, closed, unbranched];

  it.each([
    { name: "asks in the chat bound to a lease of it", branch: "badge", asked: "badge" },
    {
      name: "of several chats bound to it, the one the person spoke in last",
      branch: "pool-previews",
      asked: "previews",
    },
    { name: "no chat bound to it: the main chat", branch: "wip", asked: "main" },
    {
      name: "a crewmate's chat bound to it is not the person's: the main chat",
      branch: "stamp",
      asked: "main",
    },
    { name: "a closed chat bound to it is not asked: the main chat", branch: "old", asked: "main" },
    { name: "main is no change's branch: the main chat", branch: "main", asked: "main" },
    { name: "no branch: the main chat", branch: undefined, asked: "main" },
  ])("$name", ({ branch, asked }) => {
    expect(askMateThread(threads, undefined, branch)?.id).toBe(asked);
  });

  it("a person chat named outranks the change's branch", () => {
    expect(askMateThread(threads, "previews-too", "badge")?.id).toBe("previews-too");
  });

  // Two apps of one Mate, each its own repository in HQ, both with a change on `fix-login`: a
  // lease's group is its repository and branch, so the change's Ask goes to its own repository's
  // chat, never the other app's (review r4-10).
  const WEB = "https://hq.example/git/g1/appdev";
  const API = "https://hq.example/git/g1/apidev";
  const webChat = thread("web-login", {
    lease: { alias: "webpool-3", pool: "webpool", branch: "fix-login", repo: WEB },
    latestUserMessageAt: "2026-10-25T09:00:00.000Z",
  });
  const apiChat = thread("api-login", {
    lease: { alias: "apipool-4", pool: "apipool", branch: "fix-login", repo: API },
  });
  const githubChat = thread("github-login", {
    lease: {
      alias: "ghpool-5",
      pool: "ghpool",
      branch: "fix-login",
      repo: "https://github.com/acme/api",
    },
  });
  const twoApps = [main, webChat, apiChat];

  it.each([
    { name: "its own repository's chat", chats: twoApps, url: API, asked: "api-login" },
    {
      name: "its own repository's chat, addresses compared as zcp compares them",
      chats: twoApps,
      url: `${API}.git`,
      asked: "api-login",
    },
    {
      name: "the main chat when no chat is of its repository",
      chats: [main, webChat],
      url: API,
      asked: "main",
    },
    {
      name: "a chat leased from a repository outside HQ, which may be its own",
      chats: [main, githubChat],
      url: API,
      asked: "github-login",
    },
    {
      name: "by its branch alone when its address is not known",
      chats: twoApps,
      url: undefined,
      asked: "web-login",
    },
  ])("a change of one of two apps on one branch asks $name", ({ chats, url, asked }) => {
    expect(askMateThread(chats, undefined, "fix-login", url)?.id).toBe(asked);
  });

  // The shared HQ serves git at `/git/<orgId>/<appId>/<repo>.git`: zcp names a lease's repository
  // by that address, while the change's own is built without the organization (`repoUrl`).
  const SHARED = "https://hq.example/git/org-1";
  const sharedWebChat = thread("web-login", {
    lease: {
      alias: "webpool-3",
      pool: "webpool",
      branch: "fix-login",
      repo: `${SHARED}/g1/appdev`,
    },
    latestUserMessageAt: "2026-10-25T09:00:00.000Z",
  });
  const sharedApiChat = thread("api-login", {
    lease: {
      alias: "apipool-4",
      pool: "apipool",
      branch: "fix-login",
      repo: `${SHARED}/g1/apidev`,
    },
  });
  const otherAppChat = thread("other-app-login", {
    lease: {
      alias: "webpool-5",
      pool: "webpool",
      branch: "fix-login",
      repo: `${SHARED}/g2/apidev`,
    },
    latestUserMessageAt: "2026-10-25T10:00:00.000Z",
  });
  it.each([
    {
      name: "its own repository's chat",
      chats: [main, sharedWebChat, sharedApiChat],
      url: API,
      asked: "api-login",
    },
    {
      name: "its own repository's chat, not another application's repository of one name",
      chats: [main, otherAppChat, sharedApiChat],
      url: API,
      asked: "api-login",
    },
    {
      name: "the main chat when no chat is of its repository",
      chats: [main, sharedWebChat],
      url: API,
      asked: "main",
    },
    {
      name: "its own repository's chat by an address without the organization, as before",
      chats: [main, webChat, apiChat],
      url: `${SHARED}/g1/apidev.git`,
      asked: "api-login",
    },
  ])(
    "a change of one of two apps on one branch, leased on the shared HQ, asks $name",
    ({ chats, url, asked }) => {
      expect(askMateThread(chats, undefined, "fix-login", url)?.id).toBe(asked);
    },
  );
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

describe("pageSendIds", () => {
  const given = { commandId: CommandId.make("command-1"), messageId: MessageId.make("message-1") };
  const minted = { commandId: CommandId.make("command-2"), messageId: MessageId.make("message-2") };
  it.each([
    { name: "its asker's ids", ids: given, sent: { ...given, fromPanel: true } },
    {
      name: "new ids where its asker gave none",
      ids: undefined,
      sent: { ...minted, fromPanel: true },
    },
  ])("a page's ask goes out marked as the page's, never typed, with $name", ({ ids, sent }) => {
    expect(pageSendIds(ids, () => minted)).toEqual(sent);
  });
});
