/**
 * CrewTools — the crew's in-process tools (CONCEPT §5, PRD §5.4): what a
 * crewmate calls to report, read the board and the crew's changes, ask for
 * Show on dev, and — the lead — plan, review and finish.
 *
 * Each tool decodes its input with a Schema and hands it to `CrewToolHost`
 * as the calling crewmate. The caller is resolved at every call, not when
 * the session started: a stint can retire while its CLI still runs, and
 * then nothing runs. An input that does not decode is an error answer that
 * names the field, so the model can correct the call; no tool ever fails.
 *
 * Which tools a crewmate gets follows its kind (`CREW_TOOLS_BY_KIND`);
 * `crew_memory` joins them, and `crew_report` takes lessons, only while the
 * crewmate keeps memory. Every input schema is one object at its root, the
 * only shape the model's tool API takes, which is why `crew_memory`'s
 * operations share one flat object.
 *
 * @module CrewTools
 */
import type { CrewMemberKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as JsonSchema from "effect/JsonSchema";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import type { ThreadTool } from "../../spi/threadToolPolicy.ts";
import type { CrewMemoryOp, CrewThreadMember, CrewToolHost, CrewToolText } from "./crewSeams.ts";

export type CrewToolName =
  | "crew_report"
  | "crew_board"
  | "crew_diff"
  | "crew_show_on_dev"
  | "crew_propose"
  | "crew_review"
  | "crew_finish"
  | "crew_memory";

/** The board is read-only, so every kind reads it; only the lead plans and finishes. */
export const CREW_TOOLS_BY_KIND: Readonly<Record<CrewMemberKind, ReadonlyArray<CrewToolName>>> = {
  writer: ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev"],
  reader: ["crew_report", "crew_board", "crew_diff", "crew_review"],
  lead: ["crew_report", "crew_board", "crew_diff", "crew_propose", "crew_review", "crew_finish"],
};

type Host = CrewToolHost["Service"];

interface CrewToolDefinition<A> {
  readonly name: CrewToolName;
  readonly description: string;
  readonly input: Schema.Decoder<A>;
  readonly run: (host: Host, member: CrewThreadMember, input: A) => Effect.Effect<CrewToolText>;
}

const refusal = (tool: CrewToolName, field: string, message: string): CrewToolText => ({
  text: `${tool} was not run: ${field}: ${message}.`,
  isError: true,
});

const reportFields = {
  status: Schema.Literals(["done", "blocked", "progress"]).annotate({
    description:
      '"done": the task is finished and your work is in place. "blocked": you need an answer to go on. "progress": a milestone worth telling; you keep working.',
  }),
  summary: Schema.String.annotate({
    description: "What you did and what is left, in a few sentences.",
  }),
  question: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Required with "blocked": the one question you need answered. It reaches the lead, or the person when the lead cannot answer.',
    }),
  ),
};
const ReportInput = Schema.Struct(reportFields);
const ReportWithLessonsInput = Schema.Struct({
  ...reportFields,
  lessons: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        "Lessons worth keeping for later tasks, one short sentence each. They wait in your memory until you file them.",
    }),
  ),
});

const reportTool = <A extends typeof ReportInput.Type>(
  input: Schema.Decoder<A>,
): CrewToolDefinition<A> => ({
  name: "crew_report",
  description:
    "Report on your task. Say done when the task is finished: the engine then takes your work through its check and review to landing. Say blocked, with a question, when you cannot go on without an answer. Say progress for a milestone while you keep working.",
  input,
  run: (host, member, report) =>
    report.status === "blocked" && (report.question ?? "").trim() === ""
      ? Effect.succeed(refusal("crew_report", "question", 'Missing key for status "blocked"'))
      : host.report(member, report),
});

const board: CrewToolDefinition<object> = {
  name: "crew_board",
  description:
    "The crew and its board: who is on the crew, what each crewmate works on, and every task with its number, owner, state and dependencies. Read it before you plan, review, or name another crewmate.",
  input: Schema.Struct({}),
  run: (host, member) => host.board(member),
};

const DiffInput = Schema.Struct({
  handle: Schema.optionalKey(
    Schema.String.annotate({
      description: "The crewmate whose changes to read, without the @. Leave it out for your own.",
    }),
  ),
  path: Schema.optionalKey(
    Schema.String.annotate({
      description: "Only this file or directory, relative to the repository root.",
    }),
  ),
});
const diff: CrewToolDefinition<typeof DiffInput.Type> = {
  name: "crew_diff",
  description:
    "A crewmate's changes in its copy of the code against the head of the tree: what landing its work would bring.",
  input: DiffInput,
  run: (host, member, input) => host.diff(member, input),
};

const ShowOnDevInput = Schema.Struct({
  reason: Schema.String.annotate({
    description: "What the person should look at, and why on the dev service's own URL.",
  }),
});
const showOnDev: CrewToolDefinition<typeof ShowOnDevInput.Type> = {
  name: "crew_show_on_dev",
  description:
    "Ask the person to show your copy of the code on the dev service's own dev server and URL, in place of their tree. It is exclusive and the person decides; when they grant it, the dev server is restarted from your copy in a short turn of this conversation. While dev shows your work you may verify your host and use the browser.",
  input: ShowOnDevInput,
  run: (host, member, input) => host.showOnDev(member, input),
};

const ProposedTask = Schema.Struct({
  owner: Schema.String.annotate({
    description: "The crewmate who does it: a handle from crew_board, without the @.",
  }),
  title: Schema.String.annotate({ description: "A short title, as the board shows it." }),
  brief: Schema.String.annotate({
    description: "The objective, in the owner's terms: what to change and why.",
  }),
  doneWhen: Schema.optionalKey(
    Schema.String.annotate({ description: "How to tell the task is finished." }),
  ),
  dependsOn: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        "Tasks that must land first: titles of tasks in this plan, or #N of tasks already on the board.",
    }),
  ),
});
const ProposeInput = Schema.Struct({
  tasks: Schema.Array(ProposedTask)
    .check(Schema.isMinLength(1))
    .annotate({ description: "The plan, one task per entry." }),
});
const propose: CrewToolDefinition<typeof ProposeInput.Type> = {
  name: "crew_propose",
  description:
    "Propose a plan to the person: tasks for the crew, one area of the code per crewmate. The tasks wait for the person to start them unless the run lets you start tasks without asking.",
  input: ProposeInput,
  run: (host, member, input) => host.propose(member, input.tasks),
};

const ReviewInput = Schema.Struct({
  task: Schema.Int.annotate({ description: "The task's number, #N on the board." }),
  verdict: Schema.Literals(["accept", "reject"]).annotate({
    description: "accept, or reject with what must change.",
  }),
  note: Schema.String.annotate({
    description:
      "With accept, what you checked. With reject, what must change: the owner gets it as its rework.",
  }),
});
const review: CrewToolDefinition<typeof ReviewInput.Type> = {
  name: "crew_review",
  description: "Your verdict on a task in review. Read its changes with crew_diff first.",
  input: ReviewInput,
  run: (host, member, input) => host.review(member, input),
};

const FinishInput = Schema.Struct({
  summary: Schema.String.annotate({
    description: "How each Done when line of the brief is met.",
  }),
});
const finish: CrewToolDefinition<typeof FinishInput.Type> = {
  name: "crew_finish",
  description:
    "Finish the crew's work: every Done when line of the brief is met and every task has landed or been discarded.",
  input: FinishInput,
  run: (host, member, input) => host.finish(member, input),
};

const MemoryInput = Schema.Struct({
  op: Schema.Literals(["list", "add", "update", "remove"]).annotate({
    description:
      '"list": your entries. "add": a new entry (kind, topic, text). "update": replace an entry\'s text (id, text). "remove": drop an entry (id).',
  }),
  kind: Schema.optionalKey(
    Schema.Literals(["decision", "lesson", "fact", "open", "note", "handoff"]).annotate({
      description:
        "With add. handoff: where your task stands for whoever continues it — state, tried and failed, next step, open questions.",
    }),
  ),
  topic: Schema.optionalKey(
    Schema.String.annotate({
      description: "With add: what the entry is about. With list: only this topic.",
    }),
  ),
  text: Schema.optionalKey(
    Schema.String.annotate({ description: "With add and update: the entry, short." }),
  ),
  paths: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: "With add, for a fact about files: the files it is about.",
    }),
  ),
  id: Schema.optionalKey(
    Schema.String.annotate({ description: "With update and remove: the entry's id." }),
  ),
});

/** The flat input as the seam's operation, or the first key the operation lacks. */
const memoryOp = (
  input: typeof MemoryInput.Type,
): { readonly op: CrewMemoryOp } | { readonly missing: string } => {
  switch (input.op) {
    case "list":
      return { op: { op: "list", ...(input.topic === undefined ? {} : { topic: input.topic }) } };
    case "add":
      if (input.kind === undefined) return { missing: "kind" };
      if (input.topic === undefined) return { missing: "topic" };
      if (input.text === undefined) return { missing: "text" };
      return {
        op: {
          op: "add",
          kind: input.kind,
          topic: input.topic,
          text: input.text,
          ...(input.paths === undefined ? {} : { paths: input.paths }),
        },
      };
    case "update":
      if (input.id === undefined) return { missing: "id" };
      if (input.text === undefined) return { missing: "text" };
      return { op: { op: "update", id: input.id, text: input.text } };
    case "remove":
      if (input.id === undefined) return { missing: "id" };
      return { op: { op: "remove", id: input.id } };
  }
};

const memory: CrewToolDefinition<typeof MemoryInput.Type> = {
  name: "crew_memory",
  description:
    "Your memory across tasks and conversations: it outlasts compaction and fresh starts, the conversation does not. One fact per entry; keep nothing git or the board already records. The brief outranks your memory.",
  input: MemoryInput,
  run: (host, member, input) => {
    const decoded = memoryOp(input);
    return "missing" in decoded
      ? Effect.succeed(refusal("crew_memory", decoded.missing, `Missing key for op "${input.op}"`))
      : host.memory(member, decoded.op);
  },
};

/** What a crew thread without a live stint is told, as the gate's deny-all says it. */
export const CREW_RETIRED = "This crew conversation is retired; nothing runs in it.";

const RETIRED: CrewToolText = { text: CREW_RETIRED, isError: true };

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/** `tasks[0].owner` for the path `["tasks", 0, "owner"]`; `input` for the root. */
const fieldOf = (path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>): string =>
  path.length === 0
    ? "input"
    : path
        .map((segment, index) => {
          const key = typeof segment === "object" ? segment.key : segment;
          return typeof key === "number" ? `[${key}]` : `${index === 0 ? "" : "."}${String(key)}`;
        })
        .join("");

const refused = (tool: CrewToolName, issue: SchemaIssue.Issue): CrewToolText => {
  const [first] = formatIssue(issue).issues;
  return refusal(tool, fieldOf(first?.path ?? []), first?.message ?? "Invalid input");
};

/** A struct with no fields generates "anything but null"; the model's API wants an object. */
const EMPTY_OBJECT: JsonSchema.JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

type Caller = Effect.Effect<Option.Option<CrewThreadMember>>;

/** A tool bound to a host and a caller, as the SPI runs it. */
type CrewToolBinding = (host: Host, caller: Caller) => ThreadTool;

/** Builds the tool's JSON Schema and decoder once; each binding only closes over them. */
const prepare = <A>(definition: CrewToolDefinition<A>): CrewToolBinding => {
  const { schema } = Schema.toJsonSchemaDocument(Schema.toType(definition.input), {
    onExcessProperty: "error",
  });
  const inputSchema = schema.type === "object" ? schema : EMPTY_OBJECT;
  const decode = Schema.decodeUnknownEffect(definition.input);
  return (host, caller) => ({
    name: definition.name,
    description: definition.description,
    inputSchema,
    run: (input) =>
      Effect.flatMap(caller, (member) =>
        Option.isNone(member) || !member.value.live
          ? Effect.succeed(RETIRED)
          : decode(input).pipe(
              Effect.matchEffect({
                onFailure: (error) => Effect.succeed(refused(definition.name, error.issue)),
                onSuccess: (decoded) => definition.run(host, member.value, decoded),
              }),
            ),
      ),
  });
};

const TOOLS: Readonly<Record<CrewToolName, CrewToolBinding>> = {
  crew_report: prepare(reportTool(ReportInput)),
  crew_board: prepare(board),
  crew_diff: prepare(diff),
  crew_show_on_dev: prepare(showOnDev),
  crew_propose: prepare(propose),
  crew_review: prepare(review),
  crew_finish: prepare(finish),
  crew_memory: prepare(memory),
};
const REPORT_WITH_LESSONS = prepare(reportTool(ReportWithLessonsInput));

/**
 * A crewmate's tools. `caller` resolves the calling crewmate at each call;
 * none, or one whose stint is no longer live, and the tool runs nothing.
 */
export const crewThreadTools = (
  crewmate: { readonly kind: CrewMemberKind; readonly memory: boolean },
  host: Host,
  caller: Caller,
): ReadonlyArray<ThreadTool> => {
  const names: ReadonlyArray<CrewToolName> = crewmate.memory
    ? [...CREW_TOOLS_BY_KIND[crewmate.kind], "crew_memory"]
    : CREW_TOOLS_BY_KIND[crewmate.kind];
  return names.map((name) =>
    (name === "crew_report" && crewmate.memory ? REPORT_WITH_LESSONS : TOOLS[name])(host, caller),
  );
};
