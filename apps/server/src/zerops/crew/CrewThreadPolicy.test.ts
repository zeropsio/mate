/**
 * The crew thread policy through the real SPI registries: what the Claude
 * adapter reads for a person's thread, a retired stint and a live crewmate.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import {
  ClaudeThreadExtensionRegistry,
  readClaudeThreadRegistries,
  resolveClaudeThreadSetup,
} from "../../spi/claudeThreadProfile.ts";
import { ThreadToolPolicyRegistry } from "../../spi/threadToolPolicy.ts";
import { crewLane } from "./CrewDefinition.ts";
import { crewRefusedRoots, type LiveGateContext } from "./CrewPolicy.ts";
import { crewSessionContext } from "./crewPrompt.ts";
import { CrewThreadDirectory, type CrewThreadMember, CrewToolHost } from "./crewSeams.ts";
import { CrewThreadPolicyLive, installCrewThreadPolicy } from "./CrewThreadPolicy.ts";

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
    sessionStart: (member, source) =>
      record(["sessionStart", member.handle, source]).pipe(Effect.as(`seed for ${member.handle}`)),
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

describe("CrewThreadPolicy", () => {
  it.effect("the layer holds both registries for its scope and clears them after", () =>
    Effect.gen(function* () {
      const members = yield* Ref.make<ReadonlyMap<ThreadId, CrewThreadMember>>(
        new Map([[CREW_THREAD, backend]]),
      );
      const calls = yield* Ref.make<ReadonlyArray<HostCall>>([]);
      const scope = yield* Scope.make();
      yield* Layer.buildWithScope(CrewThreadPolicyLive, scope).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(CrewThreadDirectory, makeDirectory(members)),
            Layer.succeed(CrewToolHost, makeHost(calls)),
          ),
        ),
      );
      expect(yield* setupFor(CREW_THREAD)).toBeDefined();
      yield* Scope.close(scope, Exit.void);
      const policies = yield* ThreadToolPolicyRegistry;
      const extensions = yield* ClaudeThreadExtensionRegistry;
      expect(Option.isNone(yield* policies.current)).toBe(true);
      expect(Option.isNone(yield* extensions.current)).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(ThreadToolPolicyRegistry.layer, ClaudeThreadExtensionRegistry.layer),
      ),
    ),
  );

  it.effect("a person's thread gets no profile and no extension", () =>
    withPolicy(new Map([[CREW_THREAD, backend]]), () =>
      Effect.gen(function* () {
        expect(yield* setupFor(PERSON_THREAD)).toBeUndefined();
      }),
    ),
  );

  it.effect("a live crewmate runs with its prompt, its Runs-on overrides and its tools", () =>
    withPolicy(new Map([[CREW_THREAD, backend]]), () =>
      Effect.gen(function* () {
        const setup = yield* setupFor(CREW_THREAD);
        expect(setup?.profile).toMatchObject({
          sessionContext: crewSessionContext(backend.prompt),
          contextWindow: 300_000,
          maxBudgetUsd: 4,
          model: "claude-opus-5-5",
          effort: "high",
        });
        expect(setup?.profile.tools.map((tool) => tool.name)).toEqual([
          "crew_report",
          "crew_board",
          "crew_diff",
          "crew_show_on_dev",
        ]);
        expect(setup?.extension?.settings).toEqual({
          autoMemoryEnabled: false,
          disableAllHooks: false,
        });
      }),
    ),
  );

  it.effect.each([
    ["writer", false, ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev"]],
    ["reader", false, ["crew_report", "crew_board", "crew_diff", "crew_review"]],
    [
      "lead",
      true,
      [
        "crew_report",
        "crew_board",
        "crew_diff",
        "crew_propose",
        "crew_review",
        "crew_finish",
        "crew_memory",
      ],
    ],
  ] as const)(
    "a %s (memory %s) gets its kind's tools, and never a dialog",
    ([kind, memory, names]) => {
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
      return withPolicy(new Map([[CREW_THREAD, member]]), () =>
        Effect.gen(function* () {
          const profile = (yield* setupFor(CREW_THREAD))!.profile;
          expect(profile.sessionContext).toBe(crewSessionContext(member.prompt));
          expect(profile.tools.map((tool) => tool.name)).toEqual(names);
          for (const toolName of ["AskUserQuestion", "ExitPlanMode"]) {
            const decision = yield* profile.decideTool({ toolName, input: {}, toolUseId: "t1" });
            expect(decision.kind).toBe("deny");
          }
        }),
      );
    },
  );

  it.effect("the gate and the tools act on the crewmate as it is at each call", () =>
    withPolicy(new Map([[CREW_THREAD, backend]]), ({ members, calls }) =>
      Effect.gen(function* () {
        // The session keeps the profile it started with; the facts move under it.
        const profile = (yield* setupFor(CREW_THREAD))!.profile;
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
        expect(yield* Ref.get(calls)).toEqual([
          ["report", "backend", { status: "progress", summary: "Menu drawn." }],
        ]);

        yield* Ref.set(members, new Map([[CREW_THREAD, { ...claimed, live: false }]]));
        expect(yield* profile.decideTool(verify)).toEqual({
          kind: "deny",
          reason: "This crew conversation is retired; nothing runs in it.",
        });
        expect(yield* report.run({ status: "done", summary: "Done." })).toEqual({
          text: "This crew conversation is retired; nothing runs in it.",
          isError: true,
        });
        expect(yield* Ref.get(calls)).toHaveLength(1);
      }),
    ),
  );

  it.effect("the session's start and compaction reach the host while the stint is live", () =>
    withPolicy(new Map([[CREW_THREAD, backend]]), ({ members, calls }) =>
      Effect.gen(function* () {
        const extension = (yield* setupFor(CREW_THREAD))!.extension!;
        const start = { sessionId: "s1", transcriptPath: "/home/zerops/.claude/s1.jsonl" };
        expect(yield* extension.onSessionStart({ ...start, source: "startup" })).toBe(
          "seed for backend",
        );
        yield* extension.onPostCompact({ summary: "Built the scores route." });
        expect(yield* Ref.get(calls)).toEqual([
          ["sessionStart", "backend", "startup"],
          ["postCompact", "backend", "Built the scores route."],
        ]);

        yield* Ref.set(members, new Map([[CREW_THREAD, { ...backend, live: false }]]));
        expect(yield* extension.onSessionStart({ ...start, source: "resume" })).toBeUndefined();
        yield* extension.onPostCompact({ summary: "Later." });
        expect(yield* Ref.get(calls)).toHaveLength(2);
      }),
    ),
  );

  it.effect("a crew thread whose stint is not live gets the deny-all profile", () =>
    withPolicy(new Map([[CREW_THREAD, { ...backend, live: false }]]), () =>
      Effect.gen(function* () {
        const profile = (yield* setupFor(CREW_THREAD))?.profile;
        expect(profile).toEqual({
          sessionContext: "This crew conversation is retired; nothing runs in it.",
          contextWindow: 300_000,
          decideTool: expect.any(Function),
          tools: [],
        });
        for (const toolName of ["Read", "Bash", "ToolSearch", "mcp__crew__crew_report"]) {
          const decision = yield* profile!.decideTool({
            toolName,
            input: { file_path: "/var/www/appdev/.crew/backend/a.ts" },
            toolUseId: "t1",
          });
          expect(decision).toEqual({
            kind: "deny",
            reason: "This crew conversation is retired; nothing runs in it.",
          });
        }
      }),
    ),
  );
});
