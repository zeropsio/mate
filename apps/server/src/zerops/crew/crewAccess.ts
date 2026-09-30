/**
 * crewAccess — D6 at the crew's door. A crewmate runs on a login somebody
 * signed in, and only that person runs it; admission refuses a crew *turn*
 * for anybody else (`CrewDispatch.ts`), but most presses start no turn at
 * once — a task queued for a busy crewmate, a run resumed on its starter's
 * login, a job changed, a conversation cleared, a landing that starts the
 * next task. So every press that runs or changes the crew is judged here
 * first, as the person who pressed it, on every login it reaches
 * (`crewCommandReach`, `crewReachLogins`: the same answer a client reads off
 * its snapshot), and refused as `not-allowed` in admission's own words
 * (`ZeropsTurnAdmission.admitOperator`) before anything moves.
 *
 * A write to the crew home reaches the crewmates it changes — their login
 * before and after — and every crewmate's when it changes what they share,
 * the goal or the crew's name; a home written for the first time is all new.
 *
 * @module crewAccess
 */
import {
  crewCommandReach,
  crewReachLogins,
  type CrewCommand,
  type CrewCommandReach,
  type CrewFiles,
  type CrewLoginRoster,
} from "@t3tools/contracts";
import { parseCrewHome, type CrewDefinition } from "@t3tools/shared/crewHome";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import {
  asRefusal,
  defaultCrewLogin,
  DEFAULT_CREW_LOGIN,
  refuse,
  type CrewCore,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";

/** What a write to the crew home changes: what every crewmate shares, and which crewmates. */
export interface CrewHomeChange {
  readonly shared: boolean;
  readonly handles: ReadonlyArray<string>;
}

/** The crewmates `after` changes from `before`, by their whole entry and job; `before` absent is all new. */
export function crewHomeChange(
  before: CrewDefinition | undefined,
  after: CrewDefinition,
): CrewHomeChange {
  if (before === undefined) return { shared: true, handles: [] };
  const shared =
    before.name !== after.name ||
    before.brief.title !== after.brief.title ||
    before.brief.text !== after.brief.text;
  const entry = (definition: CrewDefinition, handle: string) => {
    const member = definition.members.find((candidate) => candidate.handle === handle);
    return member === undefined ? undefined : JSON.stringify(member);
  };
  const handles = [
    ...new Set([...before.members, ...after.members].map((member) => member.handle)),
  ].filter((handle) => entry(before, handle) !== entry(after, handle));
  return { shared, handles };
}

/** The applied crewmates in the crew's order, each with the login its turns run on. */
const appliedCrewmates = (core: CrewCore) =>
  Effect.map(core.applied, (applied) =>
    applied === undefined
      ? []
      : applied.definition.members.flatMap((spec) => {
          const row = applied.members.get(spec.handle);
          return row === undefined
            ? []
            : [{ handle: row.handle, kind: row.kind, login: row.login ?? DEFAULT_CREW_LOGIN }];
        }),
  );

/** A definition's crewmates and the login each would run on: its own, else the project's default. */
const definitionLogins = (core: CrewCore, definition: CrewDefinition | undefined) =>
  Effect.gen(function* () {
    if (definition === undefined) return [];
    const fallback = yield* defaultCrewLogin(core);
    return definition.members.map((member) => ({
      handle: member.handle,
      login: member.login ?? fallback,
    }));
  });

/** The crew as `reach` resolves against it: the tables, the claims, the crew home where it counts. */
const rosterFor = (core: CrewCore, reach: CrewCommandReach) =>
  Effect.gen(function* () {
    const owners = new Map<string, string>();
    if (reach.kind === "tasks") {
      for (const taskId of reach.taskIds) {
        const task = yield* asRefusal(core.store.getAssignment(taskId));
        if (Option.isSome(task)) owners.set(taskId, task.value.member);
      }
    }
    const home =
      reach.kind === "home" || reach.kind === "job"
        ? yield* definitionLogins(core, (yield* core.home.load).definition)
        : undefined;
    return {
      crewmates: yield* appliedCrewmates(core),
      ownerOf: (taskId) => owners.get(taskId),
      claimOf: (host) => core.memory.claims.get(host)?.handle ?? undefined,
      ...(home === undefined ? {} : { home }),
    } satisfies CrewLoginRoster;
  });

/** Refused as `not-allowed`, in admission's words, when `principal` may not run one of `logins`. */
const admitOperator = (core: CrewCore, logins: ReadonlyArray<string>, principal: TurnPrincipal) =>
  logins.length === 0
    ? Effect.void
    : core.admission
        .admitOperator({ instanceIds: logins, principal })
        .pipe(Effect.mapError((error) => refuse("not-allowed", error.message)));

/** A press, judged on every login it reaches before it runs. */
export const guardCommand = (core: CrewCore, command: CrewCommand, principal: TurnPrincipal) =>
  Effect.gen(function* () {
    const reach = crewCommandReach(command);
    if (reach.kind === "reads") return;
    const roster = yield* rosterFor(core, reach);
    yield* admitOperator(core, crewReachLogins(reach, roster), principal);
  });

/**
 * A write to the crew home, judged on the logins of what it changes. A home
 * the write would leave unparsable is the write's own refusal to make.
 */
export const guardFilesWrite = (core: CrewCore, files: CrewFiles, principal: TurnPrincipal) =>
  Effect.gen(function* () {
    const current = yield* core.home.read;
    const written = new Set(files.files.map((file) => file.path));
    const before = parseCrewHome(CREW_ID, current).definition;
    const after = parseCrewHome(CREW_ID, [
      ...current.filter((file) => !written.has(file.path)),
      ...files.files,
    ]).definition;
    if (after === undefined) return;
    const change = crewHomeChange(before, after);
    const crewmates = yield* appliedCrewmates(core);
    const was = yield* definitionLogins(core, before);
    const will = yield* definitionLogins(core, after);
    const every = [...crewmates, ...was, ...will];
    const reached = change.shared
      ? every
      : every.filter((mate) => change.handles.includes(mate.handle));
    yield* admitOperator(core, [...new Set(reached.map((mate) => mate.login))], principal);
  });
