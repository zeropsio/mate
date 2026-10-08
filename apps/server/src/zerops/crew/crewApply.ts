/**
 * crewApply — the crew home becoming the crew (PRD §5.1), its saves reaching
 * the crewmates (§5.6), and the presses on a crewmate's copy and app (§5.7).
 *
 * **Apply** validates before it changes anything: the files parse, every
 * writer's service is a dev service this Mate reaches with a verified
 * identity, and a writer on a service whose environment reaches a database
 * declares `env:` or `database: shared`. A crewmate the files no longer name
 * is removed — refused while its copy holds unlanded work. Then the tables
 * take the crew (versions from `versionsAfterSave`, a tint and a crew port
 * each), and the copies are made in the background with per-crewmate
 * progress: creating, running setup, ready or failed with its reason. A
 * handle is fixed once applied: another handle is another crewmate.
 *
 * **Saves** (probe 22 failed): a changed prompt reaches a crewmate only in a
 * new conversation. `nextTurn` rotates at its next turn, `fresh` at once
 * between turns, `now` interrupts a running turn, rotates and sends one turn
 * to continue as the person. A new login is always `fresh`; model and effort
 * reach the next turn in the same conversation, since the profile reads them.
 *
 * @module crewApply
 */
import type { CrewApplyChoice, CrewCommandResult, CrewTint } from "@t3tools/contracts";
import { CommandId, ThreadId } from "@t3tools/contracts";
import { MATE_TINT_IDS } from "@t3tools/shared/brand";
import {
  CREW_HOME_FILE,
  renderCrewHome,
  validateCrewTopology,
  type CrewDefinition,
  type CrewMemberSpec,
} from "@t3tools/shared/crewHome";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ZeropsRepository } from "../ZeropsRepositorySource.ts";
import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { savedSeamWords, type PromptChange } from "./crewCards.ts";
import {
  asRefusal,
  currentStint,
  defaultCrewLogin,
  noSpendWords,
  silentSpender,
  isWorking,
  memberOf,
  principalUser,
  refuse,
  requireApplied,
  requireMember,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID, refusalOf } from "./CrewHome.ts";
import { assignCrewPorts, proposeCrewPorts, readDeclaredPorts } from "./crewPorts.ts";
import { flushState } from "./crewState.ts";
import { appendSeam } from "./crewSeamLines.ts";
import { currentOrFirstStint, retireStint, rotateBetweenTurns } from "./CrewStints.ts";
import type { CrewMemberRow } from "./CrewStore.ts";
import { refreshLaneStats } from "./crewLanding.ts";
import { requireTask, saveOver } from "./crewTasks.ts";
import { versionsAfterSave } from "./crewVersions.ts";
import type { RotationReason } from "./rotationDecision.ts";

/**
 * What an applied crew turns on for the engine's life: the crew's thread
 * policies and the watch on sign-ins; idempotent.
 */
export type Activate = Effect.Effect<void>;

const loadHome = (core: CrewCore) =>
  Effect.gen(function* () {
    const parsed = yield* core.home.load;
    if (parsed.definition === undefined || parsed.issues.length > 0) {
      return yield* refusalOf(parsed.issues);
    }
    return parsed.definition;
  });

/** Tints for crewmates without one: the first a crewmate of this crew does not wear. */
const assignTints = (
  members: ReadonlyArray<CrewMemberSpec>,
  previous: ReadonlyMap<string, CrewMemberRow>,
): ReadonlyMap<string, CrewTint> => {
  const chosen = new Map<string, CrewTint>();
  for (const member of members) {
    const kept = member.tint ?? previous.get(member.handle)?.tint;
    if (kept !== undefined && kept !== null) chosen.set(member.handle, kept as CrewTint);
  }
  for (const member of members) {
    if (chosen.has(member.handle)) continue;
    const taken = new Set(chosen.values());
    chosen.set(
      member.handle,
      (MATE_TINT_IDS.find((tint) => !taken.has(tint)) ?? MATE_TINT_IDS[0]) as CrewTint,
    );
  }
  return chosen;
};

const memberRow = (
  spec: CrewMemberSpec,
  fields: Pick<CrewMemberRow, "tint" | "login" | "jobVersion" | "crewPort">,
): CrewMemberRow => ({
  crew: CREW_ID,
  handle: spec.handle,
  displayName: spec.displayName,
  kind: spec.kind,
  tint: fields.tint,
  host: spec.kind === "writer" ? (spec.host ?? null) : null,
  lane: spec.kind === "writer" ? spec.handle : null,
  readOnly: spec.kind !== "writer",
  login: fields.login,
  model: spec.model ?? null,
  effort: spec.effort ?? null,
  jobVersion: fields.jobVersion,
  runCommand: spec.run ?? null,
  restartAfterMerge: spec.restartAfterMerge,
  crewPort: fields.crewPort,
  config: {
    setup: spec.setup ?? null,
    check: spec.check ?? null,
    env: spec.env,
    database: spec.database ?? null,
    migrations: spec.migrations,
    context: spec.context ?? null,
    rotateAfter: spec.rotateAfter ?? null,
    afterLandRestart: spec.afterLandRestart,
  },
});

/** Every writer service the definition names, verified; the problems of those that are not. */
const verifyHosts = (core: CrewCore, definition: CrewDefinition) =>
  Effect.gen(function* () {
    const listed = yield* core.repositories.refresh;
    if (listed._tag !== "available") {
      return yield* refuse("io", "This Mate's dev services cannot be listed right now.");
    }
    const hosts = [
      ...new Set(
        definition.members.flatMap((member) =>
          member.kind === "writer" && member.host !== undefined ? [member.host] : [],
        ),
      ),
    ];
    const verified = new Map<string, ZeropsRepository>();
    const problems: Array<string> = [];
    for (const host of hosts) {
      const repository = listed.repositories.find((candidate) => candidate.host === host);
      if (repository === undefined) continue;
      const seen = yield* core.observer.observe(repository);
      if (seen._tag === "available" && seen.git.state === "ready") {
        verified.set(host, seen.repository);
      } else {
        problems.push(
          seen._tag === "available"
            ? `${host}'s tree is not a git repository with a commit (${seen.git.state}).`
            : `${host} could not be reached: ${seen.reason}`,
        );
      }
    }
    if (problems.length > 0) return yield* refuse("invalid-definition", problems.join("\n"));
    return { devHosts: listed.repositories.map((repository) => repository.host), verified };
  });

/** Removes a crewmate: its app stops, its copy goes (refused with unlanded work unless discarded). */
const dropMember = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  discardUnlanded: boolean,
) =>
  Effect.gen(function* () {
    const { row } = member;
    if (row.kind === "writer" && row.host !== null) {
      const lane = Option.getOrUndefined(yield* asRefusal(core.store.getLane(CREW_ID, row.handle)));
      if (lane !== undefined) {
        yield* asRefusal(core.app.stop({ host: row.host, handle: row.handle }));
        const cleaned = yield* asRefusal(
          core.workspace.cleanup(
            { crew: CREW_ID, handle: row.handle },
            { discard: discardUnlanded },
          ),
        );
        if (cleaned._tag === "kept") {
          return yield* refuse(
            "unlanded-commits",
            `@${row.handle}: ${cleaned.unlanded} commits not landed${cleaned.dirty ? ", and edits not committed" : ""}`,
          );
        }
      }
    }
    for (const stint of applied.stints) {
      if (stint.member === row.handle && stint.retiredAt === null) yield* retireStint(core, stint);
    }
    for (const task of yield* asRefusal(core.store.assignments(CREW_ID))) {
      if (task.member === row.handle && task.state !== "landed" && task.state !== "discarded") {
        // Over the task as read: one that moved meanwhile is read again and discarded as it stands.
        yield* saveOver(core, task, { ...task, state: "discarded" }).pipe(
          Effect.catchTags({
            CrewCommandError: () =>
              Effect.flatMap(requireTask(core, task.assignment), (now) =>
                now.state === "landed" || now.state === "discarded"
                  ? Effect.void
                  : Effect.asVoid(saveOver(core, now, { ...now, state: "discarded" })),
              ),
          }),
        );
      }
    }
    yield* asRefusal(core.store.deleteMember(CREW_ID, row.handle));
    for (const facts of [core.memory.apps, core.memory.laneStats, core.memory.progress]) {
      facts.delete(row.handle);
    }
    core.memory.missingLanes.delete(row.handle);
  });

/**
 * A crewmate's first conversation, opened without a turn so its chat opens
 * before its first message; a writer's once its copy is ready, since the
 * conversation runs in it.
 */
const openFirstStint = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = memberOf(applied, handle);
    if (member !== undefined) yield* currentOrFirstStint(core, member);
  });

/** Makes the writers' copies the tables do not have yet, with Apply's progress, then mirrors the home. */
const createLanes = (core: CrewCore, applied: AppliedCrew) =>
  Effect.gen(function* () {
    const { memory } = core;
    for (const spec of applied.definition.members) {
      const row = applied.members.get(spec.handle);
      if (spec.kind !== "writer" || spec.host === undefined || row === undefined) continue;
      if (Option.isSome(yield* asRefusal(core.store.getLane(CREW_ID, spec.handle)))) continue;
      const handle = spec.handle;
      const fail = (detail: string) =>
        Effect.sync(() => memory.progress.set(handle, { state: "failed", detail })).pipe(
          Effect.andThen(core.changed),
        );
      memory.progress.set(handle, { state: "creating", detail: null });
      yield* core.changed;
      const created = yield* asRefusal(
        core.workspace.create({ crew: CREW_ID, handle, host: spec.host }),
      );
      switch (created._tag) {
        case "no-head":
          yield* fail(`${spec.host}'s tree has no commit yet`);
          continue;
        case "no-space":
          yield* fail(
            `no free disk on ${spec.host}: a copy needs ${Math.ceil(created.needKiB / 1024)} MiB, ${Math.floor(created.availableKiB / 1024)} MiB are free`,
          );
          continue;
        case "mount-unseen":
          yield* fail(`the copy did not appear through ${spec.host}'s mount`);
          continue;
        case "exists":
          yield* asRefusal(
            core.store.putLane({
              crew: CREW_ID,
              lane: handle,
              host: spec.host,
              branch: `crew/${handle}`,
              dispatchCommit: created.tip,
              recordedTip: created.tip,
              lastLanding: null,
              refSnapshot: null,
              lockfileHash: null,
              frozenSince: null,
              state: "ready",
            }),
          );
          break;
        case "created":
          break;
      }
      if (spec.setup !== undefined) {
        memory.progress.set(handle, { state: "setting-up", detail: spec.setup });
        yield* core.changed;
        const setup = yield* asRefusal(
          core.checks.run({
            host: spec.host,
            lane: handle,
            kind: "setup",
            command: spec.setup,
            crewPort: row.crewPort ?? undefined,
            env: spec.env,
          }),
        );
        if (setup._tag !== "passed") {
          const last = "tail" in setup ? setup.tail.trimEnd().split("\n").at(-1) : undefined;
          yield* fail(`setup (${spec.setup}) ${setup._tag}${last ? `: ${last}` : ""}`);
          continue;
        }
      }
      const lockfileHash = yield* asRefusal(core.reads.lockfileHash(spec.host, handle));
      yield* asRefusal(
        core.store.updateLane(CREW_ID, handle, (lane) => ({ ...lane, lockfileHash })),
      );
      memory.progress.delete(handle);
      yield* refreshLaneStats(core, { row, spec });
      yield* openFirstStint(core, handle);
      yield* core.changed;
    }
    yield* flushState(core);
  });

const bumped = (core: CrewCore) =>
  asRefusal(core.store.bumpSeq(CREW_ID)).pipe(Effect.andThen(asRefusal(core.reload)));

/** How one crewmate takes a saved change to its prompt or its login. */
const applyChoice = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  choice: CrewApplyChoice,
  change: PromptChange,
  principal: TurnPrincipal,
  reason: RotationReason,
) =>
  Effect.gen(function* () {
    const { memory } = core;
    const handle = member.row.handle;
    const working = isWorking(core, applied, handle);
    const stint = currentStint(applied, handle);
    if (stint === undefined) return;
    /** The save waits for its moment: the conversation says so where the person reads it. */
    const waits = (apply: CrewApplyChoice) =>
      appendSeam(core, stint.threadId, savedSeamWords(change, reason, apply), {
        seam: "saved",
        apply,
      });
    switch (choice) {
      case "nextTurn":
        memory.applyChoices.set(handle, "nextTurn");
        yield* waits("nextTurn");
        return;
      case "fresh":
        if (working) {
          memory.freshAtTurnEnd.set(handle, reason);
          yield* waits("fresh");
        } else yield* rotateBetweenTurns(core, applied, member, reason);
        return;
      case "now": {
        if (!working) {
          yield* rotateBetweenTurns(core, applied, member, reason);
          return;
        }
        memory.continueAtTurnEnd.set(handle, { startedBy: principalUser(principal), change });
        yield* waits("now");
        const now = yield* core.now;
        yield* asRefusal(
          core.orchestration.dispatch({
            type: "thread.turn.interrupt",
            commandId: CommandId.make(`crew:apply-now:${stint.threadId}:${now}`),
            threadId: ThreadId.make(stint.threadId),
            createdAt: now,
          }),
        );
      }
    }
  });

/**
 * A crewmate runs only on a login whose agent carries the crew's profile —
 * its rules, gate and overrides — or it would work ungated; a lead also
 * needs the crew tools from it, to hand out and land the work.
 */
const requireCrewLogin = (
  core: CrewCore,
  member: Pick<CrewMemberSpec, "handle" | "kind">,
  login: string,
) =>
  Effect.gen(function* () {
    const agent = yield* core.agentOf(login);
    if (agent === undefined) {
      return yield* refuse(
        "invalid-definition",
        `@${member.handle} runs on ${login}, which isn't a login on this Mate: give it another login.`,
      );
    }
    if (agent.threadProfile === undefined) {
      return yield* refuse(
        "invalid-definition",
        `@${member.handle} runs on ${agent.displayName}, which can't run a crewmate: it would work without the crew's rules. Give it another login.`,
      );
    }
    if (member.kind === "lead" && !agent.threadProfile.tools) {
      return yield* refuse(
        "invalid-definition",
        `@${member.handle} leads the crew, and a lead needs the crew tools, which ${agent.displayName} cannot host: give the lead another login.`,
      );
    }
  });

/**
 * While a run that is not over keeps a dollar budget, every crewmate's agent
 * must report what it spends, or the run's spend would leave its turns out.
 */
const requireSpendUnderBudget = (
  core: CrewCore,
  members: ReadonlyArray<{ readonly handle: string; readonly login: string }>,
) =>
  Effect.gen(function* () {
    const run = (yield* core.applied)?.run;
    if (run === undefined || run.budgetUsd === null) return;
    if (run.state === "finished" || run.state === "stopped") return;
    for (const member of members) {
      const silent = yield* silentSpender(core, [member.login]);
      if (silent !== undefined) {
        return yield* refuse(
          "invalid-definition",
          `${noSpendWords(silent)}: give @${member.handle} another login, or keep the run going with No limit.`,
        );
      }
    }
  });

export const apply = (core: CrewCore, principal: TurnPrincipal, activate: Activate) =>
  Effect.gen(function* () {
    const definition = yield* loadHome(core);
    const { devHosts, verified } = yield* verifyHosts(core, definition);
    const databaseHosts: Array<string> = [];
    for (const host of verified.keys()) {
      if (yield* asRefusal(core.reads.reachesDatabase(host))) databaseHosts.push(host);
    }
    yield* core.recordDevHosts(
      devHosts,
      new Map([...verified.keys()].map((host) => [host, databaseHosts.includes(host)])),
    );
    const topology = validateCrewTopology(definition, { devHosts, databaseHosts });
    if (topology.length > 0) return yield* refusalOf(topology);
    const login = yield* defaultCrewLogin(core);
    for (const member of definition.members) {
      yield* requireCrewLogin(core, member, member.login ?? login);
    }
    yield* requireSpendUnderBudget(
      core,
      definition.members.map((member) => ({ handle: member.handle, login: member.login ?? login })),
    );
    for (const host of verified.keys()) {
      core.memory.integration.set(host, yield* asRefusal(core.reads.integration(host)));
    }

    const previous = yield* core.applied;
    const kept = new Set(definition.members.map((member) => member.handle));
    if (previous !== undefined) {
      for (const spec of previous.definition.members) {
        const next = definition.members.find((member) => member.handle === spec.handle);
        const row = previous.members.get(spec.handle);
        if (row === undefined) continue;
        const laneMoves =
          next !== undefined &&
          spec.kind === "writer" &&
          (next.kind !== "writer" || next.host !== spec.host);
        if (!kept.has(spec.handle)) yield* dropMember(core, previous, { row, spec }, false);
        else if (laneMoves) {
          const lane = yield* asRefusal(core.store.getLane(CREW_ID, spec.handle));
          if (Option.isSome(lane)) {
            const cleaned = yield* asRefusal(
              core.workspace.cleanup({ crew: CREW_ID, handle: spec.handle }),
            );
            if (cleaned._tag === "kept") {
              return yield* refuse(
                "unlanded-commits",
                `@${spec.handle}: ${cleaned.unlanded} commits not landed on ${spec.host}`,
              );
            }
          }
        }
      }
    }

    const save = versionsAfterSave(
      previous?.definition,
      previous === undefined
        ? undefined
        : {
            brief: previous.briefVersion,
            jobs: Object.fromEntries(
              [...previous.members.values()].map((row) => [row.handle, row.jobVersion]),
            ),
          },
      definition,
    );
    const tints = assignTints(definition.members, previous?.members ?? new Map());
    const ports = new Map<string, number | null>();
    for (const host of verified.keys()) {
      const yaml = yield* asRefusal(core.reads.zeropsYaml(host));
      const declared = yaml === undefined ? undefined : readDeclaredPorts(yaml, host);
      const crewPorts = declared?.crew ?? [];
      yield* asRefusal(
        core.store.putHost({ host, crewPorts: crewPorts.map((port) => ({ port, routed: null })) }),
      );
      const writers = definition.members.filter(
        (member) => member.kind === "writer" && member.host === host,
      );
      for (const [handle, port] of assignCrewPorts(
        crewPorts,
        writers.map((member) => ({
          handle: member.handle,
          crewPort: previous?.members.get(member.handle)?.crewPort ?? null,
        })),
      )) {
        ports.set(handle, port);
      }
    }

    const now = yield* core.now;
    const definitionRow =
      previous === undefined ? undefined : yield* asRefusal(core.store.getDefinition(CREW_ID));
    const stored = definitionRow === undefined ? undefined : Option.getOrUndefined(definitionRow);
    const homeHost = [...verified.keys()][0] ?? null;
    yield* asRefusal(
      core.store.putDefinition({
        crew: CREW_ID,
        homeHost,
        spec: definition,
        briefHash: null,
        briefVersion: save.versions.brief,
        appliedAt: now,
        appliedBy: principalUser(principal),
        seq: stored?.seq ?? 0,
        flushedSeq: stored?.flushedSeq ?? 0,
        state: "applied",
      }),
    );
    for (const spec of definition.members) {
      yield* asRefusal(
        core.store.putMember(
          memberRow(spec, {
            tint: tints.get(spec.handle) ?? null,
            login: spec.login ?? login,
            jobVersion: save.versions.jobs[spec.handle] ?? 1,
            crewPort: ports.get(spec.handle) ?? null,
          }),
        ),
      );
    }
    yield* bumped(core);
    yield* activate;
    const applied = yield* requireApplied(core);
    for (const handle of save.pending) {
      const member = yield* requireMember(applied, handle);
      yield* applyChoice(
        core,
        applied,
        member,
        "nextTurn",
        { kind: "job", version: member.row.jobVersion },
        principal,
        "prompt-changed",
      );
    }
    for (const handle of save.freshOnly) {
      const member = yield* requireMember(applied, handle);
      yield* applyChoice(
        core,
        applied,
        member,
        "fresh",
        { kind: "job", version: member.row.jobVersion },
        principal,
        "login-changed",
      );
    }
    for (const [handle, row] of applied.members) {
      if (
        row.kind !== "writer" ||
        Option.isSome(yield* asRefusal(core.store.getLane(CREW_ID, handle)))
      ) {
        yield* openFirstStint(core, handle);
      }
    }
    yield* core.background(createLanes(core, applied));
  });

/** `briefSave` (PRD §5.6): the saved brief reaches every crewmate by `choice`. */
export const saveBrief = (core: CrewCore, principal: TurnPrincipal, choice: CrewApplyChoice) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const next = (yield* loadHome(core)).brief;
    const brief = applied.definition.brief;
    if (next.title === brief.title && next.text === brief.text) return;
    const row = Option.getOrUndefined(yield* asRefusal(core.store.getDefinition(CREW_ID)));
    if (row === undefined) return yield* refuse("no-crew");
    const version = applied.briefVersion + 1;
    yield* asRefusal(
      core.store.putDefinition({
        ...row,
        spec: { ...applied.definition, brief: next },
        briefVersion: version,
      }),
    );
    yield* bumped(core);
    const saved = yield* requireApplied(core);
    for (const handle of saved.members.keys()) {
      yield* applyChoice(
        core,
        saved,
        yield* requireMember(saved, handle),
        choice,
        { kind: "brief", version },
        principal,
        "prompt-changed",
      );
    }
    yield* core.background(flushState(core));
  });

/** `jobSave` (PRD §5.6, §2.3): one crewmate's job and *Runs on*. A new login is always fresh. */
export const saveJob = (
  core: CrewCore,
  principal: TurnPrincipal,
  handle: string,
  choice: CrewApplyChoice,
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, handle);
    const next = (yield* loadHome(core)).members.find((spec) => spec.handle === handle);
    if (next === undefined) return yield* refuse("unknown-crewmate", `@${handle}`);
    if (next.kind !== member.spec.kind || next.host !== member.spec.host) {
      return yield* refuse("wrong-state", "a new kind or service applies with Apply");
    }
    const login = next.login ?? (yield* defaultCrewLogin(core));
    const loginChanged = login !== member.row.login;
    if (loginChanged && choice !== "fresh") return yield* refuse("login-needs-fresh");
    yield* requireCrewLogin(core, next, login);
    yield* requireSpendUnderBudget(core, [{ handle: next.handle, login }]);
    const jobChanged = next.job !== member.spec.job;
    const jobVersion = jobChanged ? member.row.jobVersion + 1 : member.row.jobVersion;
    yield* asRefusal(
      core.store.putMember(
        memberRow(next, {
          tint: next.tint ?? member.row.tint,
          login,
          jobVersion,
          crewPort: member.row.crewPort,
        }),
      ),
    );
    const row = Option.getOrUndefined(yield* asRefusal(core.store.getDefinition(CREW_ID)));
    if (row === undefined) return yield* refuse("no-crew");
    yield* asRefusal(
      core.store.putDefinition({
        ...row,
        spec: {
          ...applied.definition,
          members: applied.definition.members.map((spec) => (spec.handle === handle ? next : spec)),
        },
      }),
    );
    yield* bumped(core);
    if (jobChanged || loginChanged) {
      const saved = yield* requireApplied(core);
      yield* applyChoice(
        core,
        saved,
        yield* requireMember(saved, handle),
        choice,
        { kind: "job", version: jobVersion },
        principal,
        loginChanged ? "login-changed" : "prompt-changed",
      );
    }
    yield* core.background(flushState(core));
  });

/** *Start fresh* (PRD §5.6): a new conversation between turns; the task and the copy stay. */
export const startFresh = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, handle);
    if (isWorking(core, applied, handle)) {
      return yield* refuse("wrong-state", `@${handle}'s turn is running`);
    }
    yield* rotateBetweenTurns(core, applied, member, "start-fresh");
  });

/** *Remove from crew* (PRD §5.6): also taken out of `crew.yaml`, so the next Apply does not bring it back. */
export const removeCrewmate = (core: CrewCore, handle: string, discardUnlanded: boolean) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, handle);
    if (isWorking(core, applied, handle)) {
      return yield* refuse("wrong-state", `@${handle}'s turn is running`);
    }
    yield* dropMember(core, applied, member, discardUnlanded);
    const row = Option.getOrUndefined(yield* asRefusal(core.store.getDefinition(CREW_ID)));
    if (row !== undefined) {
      yield* asRefusal(
        core.store.putDefinition({
          ...row,
          spec: {
            ...applied.definition,
            members: applied.definition.members.filter((spec) => spec.handle !== handle),
          },
        }),
      );
    }
    const home = yield* core.home.load;
    if (home.definition !== undefined) {
      const rendered = renderCrewHome({
        ...home.definition,
        members: home.definition.members.filter((spec) => spec.handle !== handle),
      }).find((file) => file.path === CREW_HOME_FILE);
      if (rendered !== undefined) yield* core.home.write([rendered]);
    }
    yield* bumped(core);
  });

const requireWriter = (applied: AppliedCrew, handle: string) =>
  Effect.gen(function* () {
    const member = yield* requireMember(applied, handle);
    if (member.row.kind !== "writer" || member.row.host === null) {
      return yield* refuse("wrong-state", `@${handle} has no copy of the code`);
    }
    return { member, host: member.row.host };
  });

/** *Run* on the lane bar (PRD §5.7): the crewmate's Run command on its crew port. */
export const appRun = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const { member, host } = yield* requireWriter(applied, handle);
    const command = member.row.runCommand;
    if (command === null) return yield* refuse("wrong-state", `@${handle} has no Run command`);
    let port = member.row.crewPort;
    if (port === null) {
      const yaml = yield* asRefusal(core.reads.zeropsYaml(host));
      const crewPorts =
        (yaml === undefined ? undefined : readDeclaredPorts(yaml, host))?.crew ?? [];
      const others = [...applied.members.values()].filter(
        (row) => row.host === host && row.handle !== handle,
      );
      port =
        assignCrewPorts(crewPorts, [
          ...others.map((row) => ({ handle: row.handle, crewPort: row.crewPort })),
          { handle, crewPort: null },
        ]).get(handle) ?? null;
      if (port === null) return yield* refuse("wrong-state", `no free crew port on ${host}`);
      yield* asRefusal(core.store.putMember({ ...member.row, crewPort: port }));
      yield* asRefusal(core.reload);
    }
    const status = yield* asRefusal(
      core.app.run({ host, handle, command, port, env: member.spec.env }),
    );
    if (status.state === "lane-missing") {
      core.memory.missingLanes.add(handle);
      return yield* refuse("wrong-state", `@${handle}'s copy of the code is missing`);
    }
    core.memory.apps.set(handle, status.state);
  });

export const appStop = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const { host } = yield* requireWriter(applied, handle);
    yield* asRefusal(core.app.stop({ host, handle }));
    core.memory.apps.set(handle, "stopped");
  });

/** *Add crew ports* (PRD §5.7): the ports Fen's draft declares; the engine never deploys. */
export const addCrewPorts = (core: CrewCore, host: string, count: number) =>
  Effect.gen(function* () {
    const yaml = yield* asRefusal(core.reads.zeropsYaml(host));
    const ports = proposeCrewPorts(
      yaml === undefined ? undefined : readDeclaredPorts(yaml, host),
      count,
    );
    const [first, ...rest] = ports;
    if (first === undefined) return yield* refuse("wrong-state", "no ports to add");
    return { _tag: "crewPorts", host, ports: [first, ...rest] } satisfies CrewCommandResult;
  });

/** *Deliver*'s draft (CONCEPT §3.2): your tree's uncommitted paths, which no landing produced. */
export const deliverDraft = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const dirtyPaths: Array<string> = [];
    for (const [host, repository] of applied.repositories) {
      for (const path of yield* asRefusal(core.reads.dirtyPaths(host))) {
        dirtyPaths.push(`${repository.mountPath}/${path}`);
      }
      const landed = (yield* asRefusal(core.store.assignments(CREW_ID))).filter(
        (task) => task.landedCommit !== null && applied.members.get(task.member)?.host === host,
      );
      const delivered = yield* asRefusal(
        core.reads.delivered(
          host,
          landed.map((task) => task.landedCommit!),
        ),
      );
      for (const task of landed) {
        if (delivered.has(task.landedCommit!)) core.memory.delivered.add(task.assignment);
      }
    }
    return { _tag: "deliverDraft", dirtyPaths } satisfies CrewCommandResult;
  });

/** *Look for lost crew work*: `crew/*` branches no crewmate owns, on every writer's service. */
export const orphanScan = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const orphans: Array<{
      readonly host: string;
      readonly branch: string;
      readonly ahead: number;
    }> = [];
    for (const host of applied.repositories.keys()) {
      for (const orphan of yield* asRefusal(core.workspace.orphanScan(host))) {
        orphans.push({ host, branch: `crew/${orphan.handle}`, ahead: orphan.unlanded });
      }
    }
    return { _tag: "orphans", orphans } satisfies CrewCommandResult;
  });

/** *Adopt* a `crew/<handle>` branch as the copy of the writer with that handle on that service. */
export const adopt = (core: CrewCore, host: string, branch: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const handle = branch.replace(/^crew\//u, "");
    const { member, host: memberHost } = yield* requireWriter(applied, handle);
    if (memberHost !== host)
      return yield* refuse("wrong-state", `@${handle} works on ${memberHost}`);
    if (Option.isSome(yield* asRefusal(core.store.getLane(CREW_ID, handle)))) {
      return yield* refuse("wrong-state", `@${handle} already has a copy`);
    }
    const created = yield* asRefusal(core.workspace.create({ crew: CREW_ID, handle, host }));
    if (created._tag !== "created" && created._tag !== "exists") {
      return yield* refuse("wrong-state", `the copy could not be made (${created._tag})`);
    }
    if (created._tag === "exists") {
      yield* asRefusal(
        core.store.putLane({
          crew: CREW_ID,
          lane: handle,
          host,
          branch: `crew/${handle}`,
          dispatchCommit: created.tip,
          recordedTip: created.tip,
          lastLanding: null,
          refSnapshot: null,
          lockfileHash: null,
          frozenSince: null,
          state: "ready",
        }),
      );
    }
    core.memory.missingLanes.delete(member.row.handle);
  });
