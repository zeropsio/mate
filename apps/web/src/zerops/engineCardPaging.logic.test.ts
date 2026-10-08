/**
 * An engine card too long to read whole says the worked line it would say held whole: its effort
 * counted from its runs' summaries reads as V1's card counts the same calls.
 */
import {
  callItem,
  engineRun,
  engineThreadOfRecords,
  personItem,
} from "@t3tools/client-runtime/data/fixtures";
import type { EngineCardPaging } from "@t3tools/client-runtime/data";
import { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";
import type { Item } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { activityCounts, isActivityWork } from "../components/chat/conversation.logic";
import { deriveWorkLogEntries, zeropsCallToWorkLogEntry } from "../session-logic";
import { effortOfCounts, heldLines, pageReached } from "./engineCardPaging.logic";

const key = { environmentId: "env-ada", conversationId: "thread-ada" };
const run = "thread-ada/r/1";

type Call = Partial<Extract<Item, { kind: "call" }>>;

const BASH: Call = {
  step: "command",
  tool: { name: "Bash" },
  input: "Bash: npm run build",
  shows: { toolName: "Bash", command: "npm run build" },
};
const READ: Call = {
  step: "read",
  tool: { name: "Read" },
  shows: { toolName: "Read", input: { file_path: "/app/package.json" } },
};
const CLAUDE_EDIT: Call = {
  step: "edit",
  tool: { name: "Edit" },
  shows: { toolName: "Edit", input: { file_path: "/app/src/main.ts" } },
};
const codexEdit = (...paths: ReadonlyArray<string>): Call => ({
  step: "edit",
  tool: { name: "File change" },
  shows: { files: paths.map((path) => ({ path })), wrote: true },
});
const GREP: Call = {
  step: "search",
  tool: { name: "Grep" },
  shows: { toolName: "Grep", input: { pattern: "listen" } },
};
const WEB: Call = {
  step: "web",
  tool: { name: "WebSearch" },
  shows: { toolName: "WebSearch", input: { query: "zerops nodejs" } },
};
const zerops = (tool: string, input: Record<string, unknown>, text = "{}"): Call => ({
  step: "mcp",
  tool: { name: tool, server: "zerops" },
  input: `mcp__zerops__${tool}: ${JSON.stringify(input)}`,
  shows: { toolName: `mcp__zerops__${tool}`, input },
  result: { toolName: tool, resultText: text },
});
const OTHER_MCP: Call = {
  step: "mcp",
  tool: { name: "fetch_page", server: "browser" },
  shows: { toolName: "mcp__browser__fetch_page", input: { url: "https://example.com" } },
};

const records = (calls: ReadonlyArray<Call>) => calls.map((call, n) => callItem(run, n + 2, call));

/** The effort a card held whole counts from its calls, as the timeline reads them. */
function heldEffort(calls: ReadonlyArray<Call>) {
  const activities =
    engineThreadOfRecords(key, {
      runs: [engineRun("thread-ada", 1)],
      items: [personItem(run, 1, "Bring it up"), ...records(calls)],
    })?.activities ?? [];
  const model = deriveZeropsThreadModel({ activities });
  const entries = [
    ...deriveWorkLogEntries(
      activities.filter((activity) => !model.zeropsActivityIds.has(activity.id)),
    ),
    ...model.entries.flatMap((entry) =>
      entry.kind === "generic-call" ? [zeropsCallToWorkLogEntry(entry.call)] : [],
    ),
  ];
  return activityCounts(
    entries.filter(isActivityWork),
    entries.filter((entry) => entry.agentSpawn !== undefined),
  );
}

const FILE_KEYS = new Set(["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]);

/** The server's summary of the same calls (`records.ts`): by step, by tool, files edited once. */
function summaryOf(calls: ReadonlyArray<Call>): EngineCardPaging["counts"] {
  const by: Record<string, number> = {};
  const tools: Record<string, number> = {};
  const files = new Set<string>();
  let unnamed = 0;
  const named = (value: unknown, into: Set<string>): void => {
    if (Array.isArray(value)) for (const entry of value) named(entry, into);
    else if (typeof value === "object" && value !== null)
      for (const [field, entry] of Object.entries(value)) {
        if (FILE_KEYS.has(field) && typeof entry === "string") into.add(entry);
        else named(entry, into);
      }
  };
  for (const item of records(calls)) {
    if (item.kind !== "call") continue;
    by[item.step] = (by[item.step] ?? 0) + 1;
    if (item.step === "tool" || item.step === "mcp")
      tools[item.tool.name] = (tools[item.tool.name] ?? 0) + 1;
    if (item.step !== "edit") continue;
    const own = new Set<string>();
    named(item.shows, own);
    if (own.size === 0) unnamed += 1;
    for (const file of own) files.add(file);
  }
  return { calls: by, tools, edited: files.size + unnamed };
}

describe("an engine card too long to read whole", () => {
  it.each([
    { calls: "commands, a read and a search", run: [BASH, BASH, READ, GREP, WEB] },
    { calls: "Claude's edits, one per call", run: [CLAUDE_EDIT, CLAUDE_EDIT, BASH] },
    {
      calls: "Codex's edits, each file once",
      run: [codexEdit("/app/a.ts", "/app/b.ts"), codexEdit("/app/a.ts"), BASH],
    },
    {
      calls: "Zerops tools by what they did, a deploy left to its result",
      run: [
        zerops("zerops_knowledge", { query: "nodejs" }),
        zerops("zerops_knowledge", { query: "postgres" }),
        zerops("zerops_deploy", { targetService: "api" }, '{"status":"DEPLOYED"}'),
        BASH,
      ],
    },
    { calls: "another server's tool as a tool used", run: [OTHER_MCP, OTHER_MCP, READ] },
  ])("says the worked line it would say held whole: $calls", ({ run: calls }) => {
    expect(effortOfCounts(summaryOf(calls))).toEqual(heldEffort(calls));
  });

  it("counts what its summary counts, however little of it is held", () => {
    expect(
      effortOfCounts({
        calls: { command: 812, read: 140, edit: 64, mcp: 30, helper: 2 },
        tools: { zerops_deploy: 6, zerops_knowledge: 9, fetch_page: 15 },
        edited: 21,
      }),
    ).toEqual([
      { kind: "edit", count: 21 },
      { kind: "command", count: 812 },
      { kind: "read", count: 140 },
      { kind: "guides", count: 9 },
      { kind: "tool", count: 15 },
      { kind: "helpers", count: 2 },
    ]);
  });
});

describe("a paging card's scroll", () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, 0, ms)).toISOString();
  const lines = [1, 2, 3, 4, 5].map((n) => ({ key: `l${n}`, at: at(n) }));
  const paging = (since: number | null, through: number | null): EngineCardPaging => ({
    runId: run,
    counts: { calls: {}, tools: {}, edited: 0 },
    hasWork: true,
    holdsLines: since !== null || through !== 0,
    since: since === null ? null : at(since),
    through: through === null ? null : at(through),
    reading: null,
  });

  it.each([
    {
      held: "from its start through the last line read",
      since: null,
      through: 3,
      keys: ["l1", "l2", "l3"],
    },
    {
      held: "from the earliest line read to its end",
      since: 3,
      through: null,
      keys: ["l3", "l4", "l5"],
    },
    {
      held: "every line, once all are read",
      since: null,
      through: null,
      keys: ["l1", "l2", "l3", "l4", "l5"],
    },
    { held: "none, before its card first opens", since: null, through: 0, keys: [] },
  ])("draws the lines held whole: $held", ({ since, through, keys }) => {
    expect(heldLines(lines, paging(since, through)).map((line) => line.key)).toEqual(keys);
  });

  const scroll = (scrollTop: number) => ({ scrollTop, scrollHeight: 4_000, clientHeight: 560 });
  it.each([
    {
      stands: "far from both ends",
      top: 1_500,
      from: 0,
      pages: { earlier: true, later: true },
      reads: null,
    },
    {
      stands: "near its foot",
      top: 3_100,
      from: 0,
      pages: { earlier: false, later: true },
      reads: "later",
    },
    {
      stands: "near its top, every held line drawn",
      top: 100,
      from: 0,
      pages: { earlier: true, later: false },
      reads: "earlier",
    },
    {
      stands: "near its top, held lines still to draw",
      top: 100,
      from: 40,
      pages: { earlier: true, later: false },
      reads: null,
    },
    {
      stands: "near its foot, nothing later",
      top: 3_100,
      from: 0,
      pages: { earlier: true, later: false },
      reads: null,
    },
  ])("reads the next page as it nears it: $stands", ({ top, from, pages, reads }) => {
    expect(pageReached(scroll(top), from, { ...pages, reading: false })).toBe(reads);
  });

  it("reads nothing more while a page is on its way", () => {
    expect(
      pageReached(scroll(3_100), 0, { earlier: false, later: true, reading: true }),
    ).toBeNull();
  });
});
