import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import {
  ClaudeThreadExtensionRegistry,
  readClaudeThreadRegistries,
  resolveClaudeThreadSetup,
} from "../../spi/claudeThreadProfile.ts";
import { ThreadToolPolicyRegistry } from "../../spi/threadToolPolicy.ts";
import { crewLane } from "./CrewDefinition.ts";
import { decideCrewTool, crewRefusedRoots, type LiveGateContext } from "./CrewPolicy.ts";
import { CrewThreadDirectory, type CrewThreadMember, CrewToolHost } from "./crewSeams.ts";
import { installCrewThreadPolicy } from "./CrewThreadPolicy.ts";
import { crewThreadTools } from "./CrewTools.ts";

const PERSON_THREAD = ThreadId.make("person-thread");
const CREW_THREAD = ThreadId.make("crew-thread");
const INSTANCE = ProviderInstanceId.make("claudeAgent");

const lane = crewLane(
  { host: "appdev", mountPath: "/var/www/appdev", remotePath: "/var/www" },
  "backend",
);

const gate: LiveGateContext = {
  kind: "live",
  member: { handle: "backend", kind: "writer", lane, crewPort: 3001, env: {} },
  foreignMigrations: [],
  refusedRoots: crewRefusedRoots({ workspaceRoot: "/var/www", home: "/home/zerops" }),
  realpath: (path) => path,
  workspaceRoot: "/var/www",
  turn: "work",
  holdsClaim: false,
  payloadTimeoutSeconds: 600,
};

const backend: CrewThreadMember = {
  crew: "game",
  handle: "backend",
  kind: "writer",
  stint: 2,
  live: true,
  gate,
  prompt: {
    member: { handle: "backend", kind: "writer", lane },
    brief: { title: "Snake", text: "Build a snake game.", doneWhen: [] },
    briefVersion: 3,
    job: "The API.",
    jobVersion: 2,
    memory: false,
  },
  contextWindow: 300_000,
  maxBudgetUsd: 4,
  model: "claude-opus-5-5",
  effort: "high",
  projectRoot: "/var/www",
};

/** The directory the engine would provide, backed by a map the test changes between calls. */
const makeDirectory = (members: Ref.Ref<ReadonlyMap<ThreadId, CrewThreadMember>>) =>
  CrewThreadDirectory.of({
    memberFor: (threadId) =>
      Effect.map(Ref.get(members), (map) => Option.fromUndefinedOr(map.get(threadId))),
  });

type HostCall = readonly [method: string, handle: string, input?: unknown];

const makeHost = (calls: Ref.Ref<ReadonlyArray<HostCall>>) => {
  const record = (call: HostCall) => Ref.update(calls, (all) => [...all, call]);
  const answer = (method: string) => (member: CrewThreadMember, input?: unknown) =>
    record([method, member.handle, input]).pipe(
      Effect.as({ text: `${method} done`, isError: false }),
    );
  return CrewToolHost.of({
    report: answer("report"),
    board: answer("board"),
    diff: answer("diff"),
    showOnDev: answer("showOnDev"),
    propose: answer("propose"),
    review: answer("review"),
    finish: answer("finish"),
    memory: answer("memory"),
    sessionStart: (member, event) =>
      record(["sessionStart", member.handle, event.source]).pipe(
        Effect.as(`seed for ${member.handle}`),
      ),
    postCompact: (member, summary) => record(["postCompact", member.handle, summary]),
  });
};

/** Runs `body` with the policy installed over the given crew threads. */
const withPolicy = <A>(
  initial: ReadonlyMap<ThreadId, CrewThreadMember>,
  body: (context: {
    readonly members: Ref.Ref<ReadonlyMap<ThreadId, CrewThreadMember>>;
    readonly calls: Ref.Ref<ReadonlyArray<HostCall>>;
  }) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const members = yield* Ref.make(initial);
    const calls = yield* Ref.make<ReadonlyArray<HostCall>>([]);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        yield* installCrewThreadPolicy;
        return yield* body({ members, calls });
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(CrewThreadDirectory, makeDirectory(members)),
          Layer.succeed(CrewToolHost, makeHost(calls)),
        ),
      ),
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(ThreadToolPolicyRegistry.layer, ClaudeThreadExtensionRegistry.layer),
    ),
  );

const setupFor = (threadId: ThreadId) =>
  Effect.flatMap(readClaudeThreadRegistries, (registries) =>
    resolveClaudeThreadSetup(registries, { threadId, instanceId: INSTANCE }),
  );

// witness: apps/server/src/zerops/crew/CrewThreadPolicy.ts | Option.isNone(member) ? undefined : extension(threadId), → Option.isSome(member) ? undefined : extension(threadId),
it.effect(
  "CM50: A person's thread in a Mate with a crew runs with no crew profile and no extension",
  () =>
    withPolicy(new Map([[CREW_THREAD, backend]]), () =>
      Effect.gen(function* () {
        expect(yield* setupFor(PERSON_THREAD)).toBeUndefined();
        const registries = yield* readClaudeThreadRegistries;
        const extensions = Option.getOrThrow(
          yield* Option.getOrThrow(registries.extensions).current,
        );
        expect(yield* extensions.extensionFor(PERSON_THREAD)).toBeUndefined();
      }),
    ),
);

// witness: apps/server/src/zerops/crew/CrewThreadPolicy.ts | : member.value.live → : member.value.stint > 0
it.effect(
  "CM51: A crewmate whose stint is not live runs under the deny-all profile: read-only, no tools, and every call refused, ToolSearch and Read too",
  () =>
    withPolicy(new Map([[CREW_THREAD, { ...backend, live: false }]]), () =>
      Effect.gen(function* () {
        const profile = (yield* setupFor(CREW_THREAD))?.profile;
        expect(profile?.readOnly).toBe(true);
        expect(profile?.tools).toEqual([]);
        for (const toolName of ["Read", "Bash", "ToolSearch", "mcp__crew__crew_report"]) {
          const decision = yield* profile!.decideTool({
            toolName,
            input: { file_path: "/var/www/appdev/.crew/backend/a.ts" },
            toolUseId: "t1",
          });
          expect(decision.kind, toolName).toBe("deny");
        }
        for (const toolName of [
          "ToolSearch",
          "Read",
          "mcp__crew__crew_report",
          "mcp__zerops__zerops_logs",
        ]) {
          expect(
            decideCrewTool(
              { kind: "deny-all" },
              { toolName, input: { file_path: "/var/www/appdev/a" } },
            ).kind,
            toolName,
          ).toBe("deny");
        }
      }),
    ),
);

// witness: apps/server/src/zerops/crew/CrewThreadPolicy.ts | readOnly: member.kind !== "writer", → readOnly: member.kind === "reader",
it.effect("CM52: A crewmate is read-only unless it is a writer", () =>
  Effect.gen(function* () {
    for (const [kind, memory, readOnly] of [
      ["writer", false, false],
      ["reader", false, true],
      ["lead", true, true],
    ] as const) {
      const member: CrewThreadMember =
        kind === "writer"
          ? { ...backend, prompt: { ...backend.prompt, memory } }
          : {
              ...backend,
              handle: kind,
              kind,
              gate: { ...gate, member: { handle: kind, kind, env: {} } },
              prompt: { ...backend.prompt, member: { handle: kind, kind }, memory },
            };
      yield* withPolicy(new Map([[CREW_THREAD, member]]), () =>
        Effect.gen(function* () {
          expect((yield* setupFor(CREW_THREAD))?.profile.readOnly, kind).toBe(readOnly);
        }),
      );
    }
  }),
);

// witness: apps/server/src/zerops/crew/CrewThreadPolicy.ts | Option.filter((member) => member.live), → Option.filter((member) => member.stint > 0),
it.effect(
  "CM53: A crewmate's gate, tools and session events judge each call by the crewmate as it is then: a claim taken mid-session lets its verify run, and a stint retired mid-session runs nothing more and reaches no session event",
  () =>
    withPolicy(new Map([[CREW_THREAD, backend]]), ({ members, calls }) =>
      Effect.gen(function* () {
        const { profile, extension } = (yield* setupFor(CREW_THREAD))!;
        const verify = {
          toolName: "mcp__zerops__zerops_verify",
          input: { serviceHostname: "appdev" },
          toolUseId: "t1",
        };
        const report = profile.tools.find((tool) => tool.name === "crew_report")!;
        expect((yield* profile.decideTool(verify)).kind).toBe("deny");

        const claimed = { ...backend, gate: { ...gate, holdsClaim: true } };
        yield* Ref.set(members, new Map([[CREW_THREAD, claimed]]));
        expect(yield* profile.decideTool(verify)).toEqual({ kind: "allow" });
        yield* report.run({ status: "progress", summary: "Menu drawn." });
        const start = { sessionId: "s1", transcriptPath: "/home/zerops/.claude/s1.jsonl" };
        expect(yield* extension!.onSessionStart({ ...start, source: "startup" })).toBe(
          "seed for backend",
        );
        yield* extension!.onPostCompact({ summary: "Built the scores route." });
        const received = [
          ["report", "backend", { status: "progress", summary: "Menu drawn." }],
          ["sessionStart", "backend", "startup"],
          ["postCompact", "backend", "Built the scores route."],
        ];
        expect(yield* Ref.get(calls)).toEqual(received);
        yield* Ref.set(members, new Map([[CREW_THREAD, { ...claimed, live: false }]]));
        expect((yield* profile.decideTool(verify)).kind).toBe("deny");
        expect((yield* report.run({ status: "done", summary: "Done." })).isError).toBe(true);
        expect(yield* extension!.onSessionStart({ ...start, source: "resume" })).toBeUndefined();
        yield* extension!.onPostCompact({ summary: "Later." });
        expect(yield* Ref.get(calls)).toEqual(received);
      }),
    ),
);

// witness: apps/server/src/zerops/crew/CrewTools.ts | ? [...CREW_TOOLS_BY_KIND[crewmate.kind], "crew_memory"] → ? [...CREW_TOOLS_BY_KIND.lead, "crew_memory"]
it.effect(
  "CM54: A crewmate's tools follow its kind: a writer's Show on dev, a reader's review, the lead's propose, review and finish, and crew_memory only while the crew keeps memory",
  () =>
    Effect.gen(function* () {
      const host = makeHost(yield* Ref.make<ReadonlyArray<HostCall>>([]));
      for (const [kind, memory, names] of [
        ["writer", false, ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev"]],
        ["reader", false, ["crew_report", "crew_board", "crew_diff", "crew_review"]],
        [
          "lead",
          false,
          ["crew_report", "crew_board", "crew_diff", "crew_propose", "crew_review", "crew_finish"],
        ],
        [
          "writer",
          true,
          ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev", "crew_memory"],
        ],
        ["reader", true, ["crew_report", "crew_board", "crew_diff", "crew_review", "crew_memory"]],
      ] as const) {
        const tools = crewThreadTools({ kind, memory }, host, Effect.succeedSome(backend));
        expect(tools.map((tool) => tool.name)).toEqual(names);
      }
    }),
);

// witness: apps/server/src/zerops/crew/CrewTools.ts | Option.isNone(member) || !member.value.live → Option.isNone(member)
it.effect(
  "CM55: A crew tool called from a thread that is no longer a crewmate's, or from a retired stint, reaches nothing in the crew",
  () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<HostCall>>([]);
      for (const caller of [
        Option.none<CrewThreadMember>(),
        Option.some({ ...backend, live: false }),
      ]) {
        const tools = crewThreadTools(
          { kind: "writer", memory: false },
          makeHost(calls),
          Effect.succeed(caller),
        );
        const report = tools.find((tool) => tool.name === "crew_report")!;
        expect((yield* report.run({ status: "done", summary: "Done." })).isError).toBe(true);
        expect(yield* Ref.get(calls)).toEqual([]);
      }
    }),
);

// witness: apps/server/src/zerops/crew/CrewTools.ts | : host.report(member, report), → : host.report(member, { ...report, status: "progress" }),
it.effect("CM56: crew_report hands the report to the crew as the crewmate that called it", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<HostCall>>([]);
    const tools = crewThreadTools(
      { kind: "writer", memory: false },
      makeHost(calls),
      Effect.succeedSome(backend),
    );
    const report = tools.find((tool) => tool.name === "crew_report")!;
    yield* report.run({ status: "done", summary: "The API serves /scores." });
    expect(yield* Ref.get(calls)).toEqual([
      ["report", "backend", { status: "done", summary: "The API serves /scores." }],
    ]);
  }),
);
