/**
 * CrewThreadPolicy — the crew's answer to the provider SPI (ARCHITECTURE §2
 * *Activation*, seam 8): installed into `ThreadToolPolicyRegistry` and
 * `ClaudeThreadExtensionRegistry` for the life of the installer's scope.
 *
 * Every answer starts from `CrewThreadDirectory.memberFor`:
 *
 * - **No crewmate** — a person's thread: no profile and no extension, so
 *   the adapter runs it byte-identical to a Mate without a crew.
 * - **A crewmate whose stint is not live** — the deny-all profile: nothing
 *   runs, whatever is asked, and it only reads.
 * - **A live crewmate** — its prompt (`crewSessionContext`), its Runs-on
 *   overrides, its budget and window, whether it only reads, the gate, its
 *   kind's tools, and for a writer its commands' lane form, which a driver
 *   that cannot rewrite a command tells the model.
 *
 * The adapter asks for the profile at every turn (for model and effort) but
 * builds the hooks and the tool server once, when the session starts, and
 * the CLI keeps that session across turns. So the gate, every tool and both
 * session events look the crewmate up again at each call: a claim or a
 * shaped turn changes the gate's facts mid-session, and a stint can retire
 * while its CLI still runs. `profileFor` itself stays one lookup.
 *
 * `AskUserQuestion` and `ExitPlanMode` are dialogs nobody answers in a crew
 * thread; the gate already denies both, and the SPI drops the dialog kinds.
 *
 * @module CrewThreadPolicy
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  type ClaudeThreadExtension,
  ClaudeThreadExtensionRegistry,
} from "../../spi/claudeThreadProfile.ts";
import { type ThreadToolProfile, ThreadToolPolicyRegistry } from "../../spi/threadToolPolicy.ts";
import { crewExactCommandRule, decideCrewTool, type GateContext } from "./CrewPolicy.ts";
import { crewSessionContext } from "./crewPrompt.ts";
import { CrewThreadDirectory, type CrewThreadMember, CrewToolHost } from "./crewSeams.ts";
import { CREW_RETIRED, crewThreadTools } from "./CrewTools.ts";

const DENY_ALL = { kind: "deny-all" } as const;

/** A writer's lane form, for a driver that cannot rewrite its commands. */
const exactCalls = (gate: GateContext): Pick<ThreadToolProfile, "exactCallsContext"> => {
  const rule = crewExactCommandRule(gate);
  return rule === undefined ? {} : { exactCallsContext: rule };
};

/**
 * Installs the policy and the Claude extension for the caller's scope. The
 * engine runs it when an applied crew exists at boot and again after Apply.
 */
export const installCrewThreadPolicy = Effect.gen(function* () {
  const directory = yield* CrewThreadDirectory;
  const host = yield* CrewToolHost;
  const policies = yield* ThreadToolPolicyRegistry;
  const extensions = yield* ClaudeThreadExtensionRegistry;

  const liveMember = (threadId: ThreadId) =>
    Effect.map(
      directory.memberFor(threadId),
      Option.filter((member) => member.live),
    );

  const liveProfile = (threadId: ThreadId, member: CrewThreadMember): ThreadToolProfile => ({
    sessionContext: crewSessionContext(member.prompt),
    contextWindow: member.contextWindow,
    ...(member.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: member.maxBudgetUsd }),
    ...(member.model === undefined ? {} : { model: member.model }),
    ...(member.effort === undefined ? {} : { effort: member.effort }),
    readOnly: member.kind !== "writer",
    ...exactCalls(member.gate),
    decideTool: (call) =>
      Effect.map(liveMember(threadId), (current) =>
        decideCrewTool(Option.isSome(current) ? current.value.gate : DENY_ALL, call),
      ),
    tools: crewThreadTools(
      { kind: member.kind, memory: member.prompt.memory },
      host,
      liveMember(threadId),
    ),
  });

  const denyAllProfile = (member: CrewThreadMember): ThreadToolProfile => ({
    sessionContext: CREW_RETIRED,
    contextWindow: member.contextWindow,
    readOnly: true,
    decideTool: (call) => Effect.succeed(decideCrewTool(DENY_ALL, call)),
    tools: [],
  });

  const extension = (threadId: ThreadId): ClaudeThreadExtension => ({
    settings: { autoMemoryEnabled: false, disableAllHooks: false },
    onSessionStart: (event) =>
      Effect.flatMap(liveMember(threadId), (current) =>
        Option.isSome(current)
          ? host.sessionStart(current.value, {
              source: event.source,
              sessionId: event.sessionId,
              transcriptPath: event.transcriptPath,
            })
          : Effect.succeed(undefined),
      ),
    onPostCompact: (event) =>
      Effect.flatMap(liveMember(threadId), (current) =>
        Option.isSome(current) ? host.postCompact(current.value, event.summary) : Effect.void,
      ),
  });

  yield* policies.install({
    profileFor: (thread) =>
      Effect.map(directory.memberFor(thread.threadId), (member) =>
        Option.isNone(member)
          ? undefined
          : member.value.live
            ? liveProfile(thread.threadId, member.value)
            : denyAllProfile(member.value),
      ),
  });
  yield* extensions.install({
    extensionFor: (threadId) =>
      Effect.map(directory.memberFor(threadId), (member) =>
        Option.isNone(member) ? undefined : extension(threadId),
      ),
  });
});

export const CrewThreadPolicyLive = Layer.effectDiscard(installCrewThreadPolicy);
