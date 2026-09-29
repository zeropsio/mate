import type { ThreadLiveCall, ThreadLiveStep } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  LIVE_STEP_HOLD_MS,
  liveStepWords,
  paceLiveStep,
  type LiveStepWords,
  type ShownLiveStep,
} from "./liveStep";

const since = "2026-09-29T08:00:05.000Z";

const call = (fields: Omit<ThreadLiveCall, "startedAt">): ThreadLiveCall => ({
  ...fields,
  startedAt: since,
});

const calls = (...running: ReadonlyArray<ThreadLiveCall>): ThreadLiveStep => ({
  kind: "calls",
  since,
  calls: running,
});

// Claude's command once its input is in, as the server relays it.
const build = call({
  id: "call-build",
  activityKind: "tool.updated",
  itemType: "command_execution",
  title: "Command run",
  detail: "Bash: pnpm build",
  toolName: "Bash",
  command: "pnpm build",
  input: { description: "Build the app" },
});

describe("liveStepWords", () => {
  it.each<{ readonly name: string; readonly step: ThreadLiveStep; readonly words: LiveStepWords }>([
    { name: "thinking", step: { kind: "thinking", since }, words: { words: "Thinking" } },
    { name: "its words streaming", step: { kind: "writing", since }, words: { words: "Writing" } },
    {
      name: "a command that says what it is for: the words, then the command",
      step: calls(build),
      words: { words: "Build the app", code: "pnpm build" },
    },
    {
      name: "a command that says nothing of itself is its own title, its shell wrapper dropped",
      step: calls(
        call({
          id: "call-codex",
          activityKind: "tool.updated",
          itemType: "command_execution",
          title: "Ran command",
          command: "/bin/zsh -lc 'cd /var/www && pnpm build'",
        }),
      ),
      words: { words: "pnpm build" },
    },
    {
      name: "a call whose input is not in yet is no step on its card: still thinking",
      step: calls(
        call({
          id: "call-build",
          activityKind: "tool.started",
          itemType: "command_execution",
          title: "Command run",
          detail: "Bash: {}",
          toolName: "Bash",
        }),
      ),
      words: { words: "Thinking" },
    },
    {
      name: "a read names its file",
      step: calls(
        call({
          id: "call-read",
          activityKind: "tool.updated",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/var/www/src/index.ts"}',
          toolName: "Read",
          input: { file_path: "/var/www/src/index.ts" },
        }),
      ),
      words: { words: "Reading index.ts" },
    },
    {
      name: "an edit names its file",
      step: calls(
        call({
          id: "call-edit",
          activityKind: "tool.updated",
          itemType: "file_change",
          title: "File change",
          detail: 'Edit: {"file_path":"/var/www/src/index.ts"}',
          toolName: "Edit",
          input: { file_path: "/var/www/src/index.ts" },
        }),
      ),
      words: { words: "Editing index.ts" },
    },
    {
      name: "a new file is written",
      step: calls(
        call({
          id: "call-write",
          activityKind: "tool.updated",
          itemType: "file_change",
          title: "File change",
          detail: 'Write: {"file_path":"/var/www/src/status.ts"}',
          toolName: "Write",
          input: { file_path: "/var/www/src/status.ts" },
        }),
      ),
      words: { words: "Writing status.ts" },
    },
    {
      name: "a search of the code names what it looks for",
      step: calls(
        call({
          id: "call-grep",
          activityKind: "tool.updated",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Grep: {"pattern":"liveStep"}',
          toolName: "Grep",
          input: { pattern: "liveStep" },
        }),
      ),
      words: { words: "Searching the code for liveStep" },
    },
    {
      name: "a page read on the web names the page",
      step: calls(
        call({
          id: "call-fetch",
          activityKind: "tool.updated",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'WebFetch: {"url":"https://example.com/docs/routes"}',
          toolName: "WebFetch",
          input: { url: "https://example.com/docs/routes" },
        }),
      ),
      words: { words: "Reading example.com/docs/routes" },
    },
    {
      name: "a web search names what it asks",
      step: calls(
        call({
          id: "call-search",
          activityKind: "tool.updated",
          itemType: "web_search",
          title: "Web search",
          toolName: "WebSearch",
          input: { query: "node status page" },
        }),
      ),
      words: { words: "Searching the web for node status page" },
    },
    {
      name: "a look at a picture names it",
      step: calls(
        call({
          id: "call-look",
          activityKind: "tool.updated",
          itemType: "image_view",
          title: "Image view",
          toolName: "Read",
          input: { file_path: "/var/www/shots/home.png" },
          imagePath: "/var/www/shots/home.png",
        }),
      ),
      words: { words: "Looking at home.png" },
    },
    {
      name: "the question tool running: waiting for the answer",
      step: calls(
        call({
          id: "call-ask",
          activityKind: "tool.updated",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'AskUserQuestion: {"questions":[{"question":"Merge now?"}]}',
          toolName: "AskUserQuestion",
        }),
      ),
      words: { words: "Waiting for your answer" },
    },
    {
      name: "a check in the browser names the page",
      step: calls(
        call({
          id: "call-browser",
          activityKind: "tool.updated",
          itemType: "mcp_tool_call",
          title: "MCP tool call",
          toolName: "mcp__zerops__zerops_browser",
          input: { url: "https://appdev-3000.example.app/status" },
        }),
      ),
      words: { words: "Checking /status" },
    },
    {
      name: "a deploy names the service, from its start",
      step: calls(
        call({
          id: "call-deploy",
          activityKind: "tool.started",
          itemType: "mcp_tool_call",
          title: "MCP tool call",
          toolName: "mcp__zerops__zerops_deploy",
          input: { targetService: "appdev" },
        }),
      ),
      words: { words: "Deploying appdev" },
    },
    {
      name: "a Zerops call its card keeps out of the chat is no step",
      step: calls(
        call({
          id: "call-status",
          activityKind: "tool.updated",
          itemType: "mcp_tool_call",
          title: "MCP tool call",
          toolName: "mcp__zerops__zerops_workflow",
          input: { action: "status" },
        }),
      ),
      words: { words: "Thinking" },
    },
    {
      name: "calls at once: the newest its card draws",
      step: calls(
        build,
        call({
          id: "call-next",
          activityKind: "tool.started",
          itemType: "command_execution",
          title: "Command run",
          detail: "Bash: {}",
          toolName: "Bash",
        }),
      ),
      words: { words: "Build the app", code: "pnpm build" },
    },
    {
      name: "a credential in the command is masked",
      step: calls(
        call({
          id: "call-push",
          activityKind: "tool.updated",
          itemType: "command_execution",
          title: "Ran command",
          command: `git push https://mate:${["ghp", "abcdefghijklmnopqrstuvwxyz0123"].join("_")}@git.example.app/shop.git`,
        }),
      ),
      words: { words: "git push https://mate:••••••@git.example.app/shop.git" },
    },
    { name: "no call relayed it can read", step: calls(), words: { words: "Thinking" } },
  ])("$name", ({ step, words }) => {
    expect(liveStepWords(step)).toEqual(words);
  });
});

describe("paceLiveStep", () => {
  const building = { words: "Build the app", code: "pnpm build" };
  const testing = { words: "Build the app", code: "pnpm test" };
  const reading = { words: "Reading index.ts" };
  const shownAt = (step: LiveStepWords, since: number): ShownLiveStep => ({ step, since });

  it.each<{
    readonly name: string;
    readonly shown: ShownLiveStep | undefined;
    readonly next: LiveStepWords | undefined;
    readonly nowMs: number;
    readonly paced: ReturnType<typeof paceLiveStep>;
  }>([
    {
      name: "the first step shows at once",
      shown: undefined,
      next: building,
      nowMs: 1_000,
      paced: { shown: shownAt(building, 1_000), recheckAt: null },
    },
    {
      name: "the same step again changes nothing",
      shown: shownAt(building, 1_000),
      next: { ...building },
      nowMs: 1_100,
      paced: { shown: shownAt(building, 1_000), recheckAt: null },
    },
    {
      name: "a new step once the shown one has stood its hold takes its place at once",
      shown: shownAt(building, 1_000),
      next: reading,
      nowMs: 1_000 + LIVE_STEP_HOLD_MS,
      paced: { shown: shownAt(reading, 1_000 + LIVE_STEP_HOLD_MS), recheckAt: null },
    },
    {
      name: "a new step before then waits for the hold's end",
      shown: shownAt(building, 1_000),
      next: reading,
      nowMs: 1_120,
      paced: { shown: shownAt(building, 1_000), recheckAt: 1_000 + LIVE_STEP_HOLD_MS },
    },
    {
      name: "the same words running another command are another step",
      shown: shownAt(building, 1_000),
      next: testing,
      nowMs: 1_200,
      paced: { shown: shownAt(building, 1_000), recheckAt: 1_000 + LIVE_STEP_HOLD_MS },
    },
    {
      name: "a row that stops working holds nothing",
      shown: shownAt(building, 1_000),
      next: undefined,
      nowMs: 1_050,
      paced: { shown: undefined, recheckAt: null },
    },
  ])("$name", ({ shown, next, nowMs, paced }) => {
    expect(paceLiveStep(shown, next, nowMs)).toEqual(paced);
  });
});
