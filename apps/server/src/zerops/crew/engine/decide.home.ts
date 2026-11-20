/**
 * The crew home as saved and applied: its crewmates, the logins its door names, their copies and agents.
 *
 * @module crew/engine/decide.home
 */
import {
  type CrewCommand,
  crewCommandReach,
  type CrewCommandReach,
  crewReachLogins,
} from "@t3tools/contracts";
import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";
import { crewHomeChange } from "../crewAccess.ts";
import { savedSeamWords } from "../crewCards.ts";
import { assignCrewPorts } from "../crewPorts.ts";
import { versionsAfterSave } from "../crewVersions.ts";
import { CREW_ROTATE_AFTER_DEFAULT, type RotationReason } from "../rotationDecision.ts";
import { type HostRead } from "./command.ts";
import {
  DEFAULT_CREW_LOGIN,
  crewmateConversationId,
  isFree,
  membersInOrder,
  openTaskOf,
  type CrewState,
  type MemberRecord,
} from "./state.ts";
import { Rejected, type Builder, userOf, crewAs, laneEnvironmentOf } from "./decide.step.ts";
import { deliver, rotateSession } from "./decide.turns.ts";
import { seam } from "./decide.land.ts";

/** A crew home's crewmates and the login each would run on. */
const homeLogins = (definition: CrewDefinition | undefined) =>
  (definition?.members ?? []).map((member) => ({
    handle: member.handle,
    login: member.login ?? DEFAULT_CREW_LOGIN,
  }));

/**
 * The logins a press reaches (D6): the actor asks admission for these as the presser before the
 * press is decided, and hands in its refusal. Stops and reads reach none.
 */
export const doorLogins = (
  state: CrewState,
  press: CrewCommand,
  home?: CrewDefinition,
): ReadonlyArray<string> => {
  const reach: CrewCommandReach = crewCommandReach(press);
  return crewReachLogins(reach, {
    crewmates: membersInOrder(state).map((member) => ({
      handle: member.handle,
      kind: member.kind,
      login: member.login,
    })),
    ownerOf: (taskId) => state.tasks[taskId]?.owner,
    claimOf: (host) => state.claims[host]?.handle,
    ...(reach.kind === "home" || reach.kind === "job" ? { home: homeLogins(home) } : {}),
  });
};

/**
 * The logins a write to the crew home reaches: the crewmates it changes, before and after, and
 * every one when it changes what they share (`crewAccess.crewHomeChange`).
 */
export const filesDoorLogins = (
  state: CrewState,
  before: CrewDefinition | undefined,
  after: CrewDefinition,
): ReadonlyArray<string> => {
  const change = crewHomeChange(before, after);
  const every = [
    ...membersInOrder(state).map((member) => ({ handle: member.handle, login: member.login })),
    ...homeLogins(before),
    ...homeLogins(after),
  ];
  const reached = change.shared
    ? every
    : every.filter((mate) => change.handles.includes(mate.handle));
  return [...new Set(reached.map((mate) => mate.login))];
};

export const firstLine = (text: string): string =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";

const memberFromSpec = (
  b: Builder,
  crew: string,
  spec: CrewMemberSpec,
  jobVersion: number,
  crewPort?: number | null,
): MemberRecord => {
  const existing = b.state.members[spec.handle];
  const login = spec.login ?? DEFAULT_CREW_LOGIN;
  const writer = spec.kind === "writer";
  return {
    handle: spec.handle,
    kind: spec.kind,
    displayName: spec.displayName,
    tint: spec.tint ?? existing?.tint ?? null,
    login,
    model: spec.model ?? null,
    effort: spec.effort ?? null,
    host: writer ? (spec.host ?? null) : null,
    check: spec.check ?? null,
    setup: spec.setup ?? null,
    runCommand: spec.run ?? null,
    restartAfterMerge: spec.restartAfterMerge,
    rotateAfter: spec.rotateAfter ?? CREW_ROTATE_AFTER_DEFAULT,
    crewPort: crewPort === undefined ? (existing?.crewPort ?? null) : crewPort,
    jobFirstLine: firstLine(spec.job),
    conversationId: (existing?.conversationId ??
      crewmateConversationId(
        crew,
        spec.handle,
        (b.state.ordinals[spec.handle] ?? 0) + 1,
      )) as MemberRecord["conversationId"],
    jobVersion,
    session: existing?.session ?? {
      count: 1,
      lastReason: null,
      running: null,
      principal: null,
      login,
      compactions: 0,
      startedAt: b.now,
    },
    apply: existing?.apply ?? null,
    rotateWhenFree: existing?.rotateWhenFree ?? null,
    active: existing?.active ?? null,
    lastEnd: existing?.lastEnd ?? null,
    carryOn: existing?.carryOn ?? null,
    lastNote: existing?.lastNote ?? null,
    lane: writer
      ? (existing?.lane ?? {
          branch: `crew/${spec.handle}`,
          state: "creating",
          detail: null,
          stats: null,
        })
      : null,
    app: existing?.app ?? "stopped",
  };
};

export const createLane = (b: Builder, member: MemberRecord): void => {
  if (member.host === null) return;
  b.emit({
    _tag: "CrewmateUpdated",
    handle: member.handle,
    set: {
      lane: { branch: `crew/${member.handle}`, state: "creating", detail: null, stats: null },
    },
  });
  b.effect(
    {
      kind: "crew.lane.create",
      handle: member.handle,
      host: member.host,
      branch: `crew/${member.handle}`,
      setup: member.setup,
      ...laneEnvironmentOf(b.state, member),
    },
    member.handle,
    { handle: member.handle, host: member.host },
  );
};

export const assignAgent = (b: Builder, member: MemberRecord): void => {
  deliver(
    b,
    member,
    {
      _tag: "AssignAgent",
      instanceId: member.login,
      model: member.model,
      effort: member.effort,
      profile: { kind: "crewmate", id: member.handle, name: member.displayName },
    },
    { purpose: "assign", taskId: null, principal: b.envelope.principal, text: null },
  );
};

/** The crew home as saved, applied: versions, crewmates, their conversations and copies. */
export const applyHome = (
  b: Builder,
  home: CrewDefinition,
  choice: "nextTurn" | "now" | "fresh",
  hosts?: Readonly<Record<string, HostRead>>,
): { readonly pending: ReadonlyArray<string>; readonly freshOnly: ReadonlyArray<string> } => {
  const previous = b.state.applied;
  const save = versionsAfterSave(
    previous?.definition,
    previous === null
      ? undefined
      : {
          brief: previous.briefVersion,
          jobs: Object.fromEntries(
            membersInOrder(b.state).map((member) => [member.handle, member.jobVersion]),
          ),
        },
    home,
  );
  const ordered = [
    ...home.members.filter((spec) => spec.kind === "lead"),
    ...home.members.filter((spec) => spec.kind !== "lead"),
  ];
  // A crew port each writer keeps while its service still declares it; the rest take the free.
  const assigned = new Map<string, number | null>();
  for (const [host, read] of Object.entries(hosts ?? {})) {
    const writers = ordered.filter((spec) => spec.kind === "writer" && spec.host === host);
    for (const [handle, port] of assignCrewPorts(
      read.crewPorts,
      writers.map((spec) => ({
        handle: spec.handle,
        crewPort: b.state.members[spec.handle]?.crewPort ?? null,
      })),
    )) {
      assigned.set(handle, port);
    }
  }
  const members = ordered.map((spec) =>
    memberFromSpec(
      b,
      home.crew,
      spec,
      save.versions.jobs[spec.handle] ?? 1,
      assigned.has(spec.handle) ? assigned.get(spec.handle)! : undefined,
    ),
  );
  for (const [host, read] of Object.entries(hosts ?? {})) {
    b.emit({
      _tag: "HostUpdated",
      host,
      set: {
        crewPorts: read.crewPorts.map((port) => ({ port, routed: null })),
        integration: read.integration,
      },
    });
  }
  const handles = new Set(members.map((member) => member.handle));
  const removed = b.state.order.filter((handle) => !handles.has(handle));
  const before = { ...b.state.members };
  b.emit({
    _tag: "CrewApplied",
    definition: home,
    briefVersion: save.versions.brief,
    members: members.map((member) => {
      const pending = save.pending.includes(member.handle) ? { ...member, apply: choice } : member;
      // A new crewmate's conversation opens on the crew home as applied: it runs these versions.
      return before[member.handle] === undefined && pending.session.running === null
        ? {
            ...pending,
            session: {
              ...pending.session,
              running: { brief: save.versions.brief, job: pending.jobVersion },
            },
          }
        : pending;
    }),
    removed,
  });
  for (const member of membersInOrder(b.state)) {
    const old = before[member.handle];
    if (
      old === undefined ||
      old.login !== member.login ||
      old.model !== member.model ||
      old.effort !== member.effort ||
      old.displayName !== member.displayName
    ) {
      assignAgent(b, member);
    }
    if (member.host !== null && b.state.hosts[member.host] === undefined) {
      b.emit({ _tag: "HostUpdated", host: member.host, set: {} });
    }
    if (old === undefined && member.kind === "writer") createLane(b, member);
  }
  for (const handle of removed) {
    const old = before[handle];
    if (old !== undefined) {
      deliver(
        b,
        old,
        { _tag: "Archive" },
        {
          purpose: "archive",
          taskId: null,
          principal: b.envelope.principal,
          text: null,
        },
      );
    }
  }
  return save;
};

/** A saved brief or job, applied as the person chose: at the next turn, now, or fresh. */
export const saveHome = (
  b: Builder,
  home: CrewDefinition,
  choice: "nextTurn" | "now" | "fresh",
): void => {
  const previous = b.state.applied!;
  const preview = versionsAfterSave(
    previous.definition,
    {
      brief: previous.briefVersion,
      jobs: Object.fromEntries(
        membersInOrder(b.state).map((member) => [member.handle, member.jobVersion]),
      ),
    },
    home,
  );
  if (preview.freshOnly.length > 0 && choice !== "fresh") {
    // V1's reason, which the section reads to offer *fresh*.
    throw new Rejected(
      "login-needs-fresh",
      `${preview.freshOnly.map((handle) => `@${handle}`).join(", ")} runs on a different login, ` +
        "kind or service now: save it as fresh",
    );
  }
  const save = applyHome(b, home, choice);
  const as = b.envelope.principal;
  const reached = [...save.pending, ...save.freshOnly];
  const change = {
    kind: b.state.applied!.briefVersion > previous.briefVersion ? "brief" : "job",
    version: b.state.applied!.briefVersion,
  } as const;
  for (const handle of reached) {
    const member = b.state.members[handle];
    if (member === undefined) continue;
    const rotation: RotationReason = save.freshOnly.includes(handle)
      ? "login-changed"
      : "prompt-changed";
    seam(b, member, { seam: "saved", apply: choice }, savedSeamWords(change, rotation, choice));
    if (choice === "nextTurn" && rotation === "prompt-changed") continue;
    const open = openTaskOf(b.state, handle);
    if (choice === "now" && open?.state === "working") {
      b.emit({
        _tag: "CrewmateUpdated",
        handle,
        set: {
          carryOn: {
            why: "Your job or the crew's goal changed, so a new session goes on with your task now.",
            // Carried on by the crew for whoever saved it (V1's AS_CREW).
            as: crewAs(userOf(as)),
          },
        },
      });
    }
    if (isFree(b.state, handle)) {
      rotateSession(b, member, rotation, as);
      continue;
    }
    b.emit({ _tag: "CrewmateUpdated", handle, set: { rotateWhenFree: rotation } });
    if (choice === "now" && member.active !== null) {
      deliver(
        b,
        member,
        { _tag: "Stop", runId: member.active.runId },
        {
          purpose: "stop",
          taskId: null,
          principal: as,
          text: null,
        },
      );
    }
  }
};
