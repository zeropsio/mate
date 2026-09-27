import { describe, expect, it } from "@effect/vitest";
import type { CrewMemberKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ThreadTool } from "../../spi/threadToolPolicy.ts";
import { crewLane } from "./CrewDefinition.ts";
import type { CrewThreadMember, CrewToolHost } from "./crewSeams.ts";
import { crewThreadTools } from "./CrewTools.ts";

const lane = crewLane(
  { host: "appdev", mountPath: "/var/www/appdev", remotePath: "/var/www" },
  "backend",
);

const backend: CrewThreadMember = {
  crew: "game",
  handle: "backend",
  kind: "writer",
  stint: 2,
  live: true,
  gate: { kind: "deny-all" },
  prompt: {
    member: { handle: "backend", kind: "writer", lane },
    brief: { title: "Snake", text: "Build a snake game.", doneWhen: [] },
    briefVersion: 1,
    job: "The API.",
    jobVersion: 1,
    memory: false,
  },
  contextWindow: 200_000,
};

const WRITER = { kind: "writer", memory: false } as const;
const LEAD = { kind: "lead", memory: false } as const;

type HostCall = readonly [method: string, handle: string, input?: unknown];

/** A host that records every call and answers with the method's name. */
const recordingHost = (calls: Array<HostCall>): CrewToolHost["Service"] => {
  const answer = (method: string, member: CrewThreadMember, input?: unknown) =>
    Effect.sync(() => {
      calls.push(input === undefined ? [method, member.handle] : [method, member.handle, input]);
      return { text: `${method} done`, isError: false };
    });
  return {
    report: (member, input) => answer("report", member, input),
    board: (member) => answer("board", member),
    diff: (member, input) => answer("diff", member, input),
    showOnDev: (member, input) => answer("showOnDev", member, input),
    propose: (member, tasks) => answer("propose", member, tasks),
    review: (member, input) => answer("review", member, input),
    finish: (member, input) => answer("finish", member, input),
    memory: (member, op) => answer("memory", member, op),
    sessionStart: () => Effect.succeed(undefined),
    postCompact: () => Effect.void,
  };
};

const toolNamed = (tools: ReadonlyArray<ThreadTool>, name: string): ThreadTool => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
};

describe("crewThreadTools", () => {
  it.each([
    ["writer", false, ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev"]],
    ["reader", false, ["crew_report", "crew_board", "crew_diff", "crew_review"]],
    [
      "lead",
      false,
      ["crew_report", "crew_board", "crew_diff", "crew_propose", "crew_review", "crew_finish"],
    ],
    ["writer", true, ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev", "crew_memory"]],
    ["reader", true, ["crew_report", "crew_board", "crew_diff", "crew_review", "crew_memory"]],
  ] as const)("a %s (memory %s) gets %j", (kind, memory, names) => {
    const tools = crewThreadTools({ kind, memory }, recordingHost([]), Effect.succeedSome(backend));
    expect(tools.map((tool) => tool.name)).toEqual(names);
    for (const tool of tools) {
      // The Anthropic API takes only an object at the root of a tool's input schema.
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.description).not.toBe("");
    }
  });

  it.effect("crew_report hands the decoded report to the host as the calling crewmate", () =>
    Effect.gen(function* () {
      const calls: Array<HostCall> = [];
      const tools = crewThreadTools(
        { kind: "writer", memory: false },
        recordingHost(calls),
        Effect.succeedSome(backend),
      );
      const answer = yield* toolNamed(tools, "crew_report").run({
        status: "done",
        summary: "The API serves /scores.",
      });
      expect(answer).toEqual({ text: "report done", isError: false });
      expect(calls).toEqual([
        ["report", "backend", { status: "done", summary: "The API serves /scores." }],
      ]);
    }),
  );

  it.effect("an input that does not decode is an error answer naming the field", () =>
    Effect.gen(function* () {
      const calls: Array<HostCall> = [];
      const tools = crewThreadTools(
        { kind: "writer", memory: false },
        recordingHost(calls),
        Effect.succeedSome(backend),
      );
      const answer = yield* toolNamed(tools, "crew_report").run({ status: "done" });
      expect(answer).toEqual({
        text: "crew_report was not run: summary: Missing key.",
        isError: true,
      });
      expect(calls).toEqual([]);
    }),
  );

  // [tool, crewmate, input, what the host receives | the error answer]
  const DECODE: ReadonlyArray<
    readonly [
      string,
      { readonly kind: CrewMemberKind; readonly memory: boolean },
      unknown,
      HostCall | string,
    ]
  > = [
    [
      "crew_report",
      WRITER,
      { status: "blocked", summary: "Stuck.", question: "Which port?" },
      ["report", "backend", { status: "blocked", summary: "Stuck.", question: "Which port?" }],
    ],
    [
      "crew_report",
      WRITER,
      { status: "blocked", summary: "Stuck." },
      'crew_report was not run: question: Missing key for status "blocked".',
    ],
    [
      "crew_report",
      WRITER,
      { status: "finished", summary: "Done." },
      'crew_report was not run: status: Expected "done" | "blocked" | "progress".',
    ],
    [
      "crew_report",
      { kind: "writer", memory: true },
      { status: "done", summary: "Done.", lessons: ["Vite needs --host."] },
      ["report", "backend", { status: "done", summary: "Done.", lessons: ["Vite needs --host."] }],
    ],
    [
      "crew_report",
      { kind: "writer", memory: true },
      { status: "done", summary: "Done.", lessons: [1] },
      "crew_report was not run: lessons[0]: Expected string.",
    ],
    ["crew_board", WRITER, {}, ["board", "backend"]],
    ["crew_diff", WRITER, {}, ["diff", "backend", {}]],
    [
      "crew_diff",
      { kind: "reader", memory: false },
      { handle: "frontend", path: "src/api" },
      ["diff", "backend", { handle: "frontend", path: "src/api" }],
    ],
    ["crew_diff", WRITER, { handle: 7 }, "crew_diff was not run: handle: Expected string."],
    [
      "crew_show_on_dev",
      WRITER,
      { reason: "The new menu." },
      ["showOnDev", "backend", { reason: "The new menu." }],
    ],
    ["crew_show_on_dev", WRITER, {}, "crew_show_on_dev was not run: reason: Missing key."],
    [
      "crew_propose",
      LEAD,
      {
        tasks: [{ owner: "backend", title: "Scores API", brief: "Serve /scores.", dependsOn: [] }],
      },
      [
        "propose",
        "backend",
        [{ owner: "backend", title: "Scores API", brief: "Serve /scores.", dependsOn: [] }],
      ],
    ],
    [
      "crew_propose",
      LEAD,
      { tasks: [] },
      "crew_propose was not run: tasks: Expected a value with a length of at least 1.",
    ],
    [
      "crew_propose",
      LEAD,
      { tasks: [{ owner: "backend", brief: "Serve /scores." }] },
      "crew_propose was not run: tasks[0].title: Missing key.",
    ],
    [
      "crew_review",
      LEAD,
      { task: 12, verdict: "reject", note: "No test for an empty board." },
      ["review", "backend", { task: 12, verdict: "reject", note: "No test for an empty board." }],
    ],
    [
      "crew_review",
      LEAD,
      { task: 1.5, verdict: "accept", note: "Fine." },
      "crew_review was not run: task: Expected an integer.",
    ],
    ["crew_finish", LEAD, { summary: "All met." }, ["finish", "backend", { summary: "All met." }]],
    [
      "crew_memory",
      { kind: "writer", memory: true },
      { op: "list" },
      ["memory", "backend", { op: "list" }],
    ],
    [
      "crew_memory",
      { kind: "writer", memory: true },
      {
        op: "add",
        kind: "fact",
        topic: "api",
        text: "Scores live in Redis.",
        paths: ["src/db.ts"],
      },
      [
        "memory",
        "backend",
        {
          op: "add",
          kind: "fact",
          topic: "api",
          text: "Scores live in Redis.",
          paths: ["src/db.ts"],
        },
      ],
    ],
    [
      "crew_memory",
      { kind: "writer", memory: true },
      { op: "add", kind: "fact", text: "Scores live in Redis." },
      'crew_memory was not run: topic: Missing key for op "add".',
    ],
    [
      "crew_memory",
      { kind: "writer", memory: true },
      { op: "update", id: "m3", text: "Scores live in Postgres." },
      ["memory", "backend", { op: "update", id: "m3", text: "Scores live in Postgres." }],
    ],
    [
      "crew_memory",
      { kind: "writer", memory: true },
      { op: "remove" },
      'crew_memory was not run: id: Missing key for op "remove".',
    ],
    [
      "crew_memory",
      { kind: "writer", memory: true },
      "list",
      "crew_memory was not run: input: Expected object.",
    ],
  ];

  it.effect.each(DECODE)("%s %j with %j", ([name, crewmate, input, expected]) =>
    Effect.gen(function* () {
      const calls: Array<HostCall> = [];
      const tools = crewThreadTools(crewmate, recordingHost(calls), Effect.succeedSome(backend));
      const answer = yield* toolNamed(tools, name).run(input);
      if (typeof expected === "string") {
        expect(answer).toEqual({ text: expected, isError: true });
        expect(calls).toEqual([]);
      } else {
        expect(answer.isError).toBe(false);
        expect(calls).toEqual([expected]);
      }
    }),
  );

  it.effect.each([
    ["no longer a crew thread", Option.none<CrewThreadMember>()],
    ["a retired stint", Option.some({ ...backend, live: false })],
  ] as const)("a call from %s runs nothing", ([, caller]) =>
    Effect.gen(function* () {
      const calls: Array<HostCall> = [];
      const tools = crewThreadTools(
        { kind: "writer", memory: false },
        recordingHost(calls),
        Effect.succeed(caller),
      );
      const answer = yield* toolNamed(tools, "crew_report").run({
        status: "done",
        summary: "Done.",
      });
      expect(answer).toEqual({
        text: "This crew conversation is retired; nothing runs in it.",
        isError: true,
      });
      expect(calls).toEqual([]);
    }),
  );
});
