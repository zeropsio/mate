import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import { opensOnto, standsOpen, stepOutput, type Opener } from "./opens.logic";
import { stepOf } from "./workSteps.logic";

/** A call that returned, as the card reads it. */
const call = (overrides: Partial<WorkLogEntry>): WorkLogEntry => ({
  id: "w1",
  createdAt: "2026-10-02T10:00:00.000Z",
  turnId: TurnId.make("t1"),
  label: "Tool call",
  tone: "tool",
  toolCallId: "call-w1",
  toolLifecycleStatus: "completed",
  sourceActivityKind: "tool.completed",
  ...overrides,
});
const step = (overrides: Partial<WorkLogEntry>) => stepOf(call(overrides), undefined, false);

const oneFileEdit = step({ itemType: "file_change", changedFiles: ["src/routes/status.ts"] });
const twoFileEdit = step({
  itemType: "file_change",
  changedFiles: ["src/routes/status.ts", "src/middleware.ts"],
});
const search = (callInput: NonNullable<WorkLogEntry["callInput"]>) =>
  step({ itemType: "dynamic_tool_call", detail: `Grep: ${JSON.stringify(callInput)}`, callInput });
const command = (detail?: string) =>
  step({
    itemType: "command_execution",
    command: "pnpm test",
    ...(detail === undefined ? {} : { detail }),
  });

// One row per control in the run's card, each case named as the person sees it.
describe("opens — a control is drawn only when it opens onto something not on screen", () => {
  it.each<{ readonly name: string; readonly opener: Opener; readonly opens: boolean }>([
    // 1. An operation's row or bar.
    {
      name: "a deploy with no steps, no log and no reason yet opens onto nothing",
      opener: { control: "operation", lines: 0, reasonCut: false },
      opens: false,
    },
    {
      name: "a deploy with its pipeline opens onto it",
      opener: { control: "operation", lines: 3, reasonCut: false },
      opens: true,
    },
    {
      name: "a failure whose reason its line cut short opens onto the reason",
      opener: { control: "operation", lines: 0, reasonCut: true },
      opens: true,
    },
    // 2. The Background bar.
    {
      name: "the Background bar with one task: its row repeats the bar",
      opener: { control: "background-bar", tasks: 1 },
      opens: false,
    },
    {
      name: "the Background bar with two tasks opens onto a row each",
      opener: { control: "background-bar", tasks: 2 },
      opens: true,
    },
    // 3. The to-do list's row.
    {
      name: "a to-do list of the one step its line names",
      opener: { control: "plan", steps: ["Add the route"], current: "Add the route" },
      opens: false,
    },
    {
      name: "a to-do list of several steps opens onto them",
      opener: {
        control: "plan",
        steps: ["Add the route", "Test it signed out"],
        current: "Add the route",
      },
      opens: true,
    },
    // 4. The helpers a launch started.
    {
      name: "a launch whose helpers are not known yet",
      opener: { control: "helpers", agents: 0 },
      opens: false,
    },
    {
      name: "a launch opens onto its helpers",
      opener: { control: "helpers", agents: 2 },
      opens: true,
    },
    // 5. A row of browser checks.
    {
      name: "one check with no picture and nothing read: the same check again",
      opener: { control: "checks", checks: 1, shown: 0 },
      opens: false,
    },
    {
      name: "one check with its picture opens onto it",
      opener: { control: "checks", checks: 1, shown: 1 },
      opens: true,
    },
    {
      name: "two checks open onto each take",
      opener: { control: "checks", checks: 2, shown: 0 },
      opens: true,
    },
    // 7. A step.
    {
      name: "a one-file edit: its line names the file",
      opener: { control: "step", step: oneFileEdit, codeCut: false },
      opens: false,
    },
    {
      name: "a write whose call sent what it wrote opens onto it",
      opener: {
        control: "step",
        step: step({ itemType: "file_change", changedFiles: ["notes.md"], wroteFile: true }),
        codeCut: false,
      },
      opens: true,
    },
    {
      name: "a write that failed wrote nothing to open onto",
      opener: {
        control: "step",
        step: step({
          itemType: "file_change",
          changedFiles: ["notes.md"],
          wroteFile: true,
          toolLifecycleStatus: "failed",
        }),
        codeCut: false,
      },
      opens: false,
    },
    {
      name: "an edit of several files opens onto them",
      opener: { control: "step", step: twoFileEdit, codeCut: false },
      opens: true,
    },
    {
      name: "a search for a pattern: its line says the pattern",
      opener: { control: "step", step: search({ pattern: "uptime" }), codeCut: false },
      opens: false,
    },
    {
      name: "a search in a folder opens onto where it looked",
      opener: { control: "step", step: search({ pattern: "uptime", path: "src" }), codeCut: false },
      opens: true,
    },
    {
      name: "a command that printed nothing",
      opener: { control: "step", step: command(), codeCut: false },
      opens: false,
    },
    {
      name: "a command opens onto what it printed",
      opener: { control: "step", step: command("12 passed"), codeCut: false },
      opens: true,
    },
    {
      name: "a command past its four lines of code opens onto the rest",
      opener: { control: "step", step: command(), codeCut: true },
      opens: true,
    },
    // 8. Show work.
    {
      name: "Show work on a run whose only work was an empty thought",
      opener: { control: "work", lines: 0 },
      opens: false,
    },
    {
      name: "Show work on a run that did something",
      opener: { control: "work", lines: 3 },
      opens: true,
    },
    // 9. A picture of the result.
    {
      name: "a picture whose file is gone",
      opener: { control: "picture", gone: true, more: 0 },
      opens: false,
    },
    {
      name: "a gone picture standing for more opens onto those",
      opener: { control: "picture", gone: true, more: 2 },
      opens: true,
    },
    {
      name: "a picture opens onto itself, larger",
      opener: { control: "picture", gone: false, more: 0 },
      opens: true,
    },
    // A thought.
    {
      name: "a thought within its four lines reads whole",
      opener: { control: "thought", pastCap: false },
      opens: false,
    },
    {
      name: "a thought past its four lines opens onto the rest",
      opener: { control: "thought", pastCap: true },
      opens: true,
    },
  ])("$name", ({ opener, opens: expected }) => {
    expect(opensOnto(opener)).toBe(expected);
  });

  // 10. A bar's detail stands open only while its control does.
  it.each([
    { name: "opened and still opening", opened: true, stillOpens: true, open: true },
    { name: "opened, its rows since dropped to one", opened: true, stillOpens: false, open: false },
    { name: "never opened", opened: false, stillOpens: true, open: false },
  ])("a bar's detail stands open: $name", ({ opened, stillOpens, open }) => {
    expect(standsOpen(opened, stillOpens)).toBe(open);
  });

  it("says what a step opens onto, past what its line names", () => {
    expect(stepOutput(twoFileEdit)).toEqual([
      { key: "0:files", label: "Files", text: "src/routes/status.ts\nsrc/middleware.ts" },
    ]);
    expect(stepOutput(search({ pattern: "uptime", path: "src", glob: "*.ts" }))).toEqual([
      { key: "0:asked", label: "Asked", text: "glob     *.ts\nin       src" },
    ]);
  });

  // A command sent to the background returned only a notice that it went
  // there, with the agent's own folder in it: it opens onto what the job
  // reported, and onto nothing while it runs or when it said nothing more.
  it.each([
    { name: "running", job: { state: "running", report: null }, shown: [] },
    { name: "finished, saying nothing more", job: { state: "done", report: null }, shown: [] },
    {
      name: "failed with its exit code",
      job: { state: "failed", report: "Exit code 3" },
      shown: [{ key: "job", label: null, text: "Exit code 3" }],
    },
  ] as const)("a command sent to the background opens onto its report: $name", ({ job, shown }) => {
    const launched = command(
      "Command running in background with ID: b1. Output is being written to: /tmp/x/b1.output",
    );
    const sent = {
      ...launched,
      background: {
        key: launched.key,
        title: "Soak",
        startedAt: launched.startedAt,
        endedAt: null,
        ...job,
      },
    };
    expect(stepOutput(sent)).toEqual(shown);
  });

  // An ACP agent's detail is what its call names, not what it returned; a
  // read's line is the whole of it, whatever the driver handed back.
  it.each([
    {
      name: "an ACP read, its detail the file it read",
      entry: {
        label: "Read file",
        itemType: "dynamic_tool_call",
        toolName: "read",
        detail: "/app/src/app.ts",
        callInput: { filePath: "/app/src/app.ts" },
      },
    },
    {
      name: "an ACP search, its detail the pattern",
      entry: {
        label: "Searched files",
        itemType: "web_search",
        toolName: "search",
        detail: "TODO",
        callInput: { pattern: "TODO" },
      },
    },
    {
      name: "an OpenCode read, its detail the file's text",
      entry: {
        label: "src/app.ts",
        itemType: "dynamic_tool_call",
        toolName: "read",
        detail: "<file>\n00001| export {}\n</file>",
        callInput: { filePath: "/app/src/app.ts" },
      },
    },
  ] satisfies ReadonlyArray<{ name: string; entry: Partial<WorkLogEntry> }>)(
    "opens onto nothing its line says: $name",
    ({ entry }) => {
      expect(stepOutput(step(entry))).toEqual([]);
    },
  );

  // A read of the web names its host and path; an address that says more —
  // its query, its fragment — opens onto the whole of it.
  it.each([
    {
      name: "a page by host and path: its line says it all",
      url: "https://docs.example.dev/start",
      asked: [],
    },
    {
      // A trailing slash says nothing more (E13).
      name: "a page with a trailing slash: its line says it all",
      url: "https://docs.example.dev/start/",
      asked: [],
    },
    { name: "a host alone, with its slash", url: "https://docs.example.dev/", asked: [] },
    {
      name: "an address with a query: the whole address",
      url: "https://search.example.dev/find?q=hono+routes&page=2",
      asked: [
        {
          key: "0:asked",
          label: "Asked",
          text: "address  https://search.example.dev/find?q=hono+routes&page=2",
        },
      ],
    },
  ])("says what a read of the web was asked: $name", ({ url, asked }) => {
    const web = step({
      itemType: "dynamic_tool_call",
      detail: `WebFetch: ${JSON.stringify({ url })}`,
      callInput: { url },
    });
    expect(web.kind).toBe("web");
    expect(stepOutput(web)).toEqual(asked);
  });
});
