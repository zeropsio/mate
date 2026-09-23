/**
 * The birth store (DESIGN §4.5, §2.C C9): one persisted record per Mate this account is bringing
 * up, from the moment the platform accepted its creation until the connect that names its
 * environment, and the opening job each creation left for that environment.
 *
 * - A birth starts at **create-accepted** and owes, in order, `tags` (its registry entry on the
 *   account's Gitea project), `registry` (the rest of its group registration: the broker's grant,
 *   and for a stage or a production its deploy token and declaration), `harden` (its project
 *   closed off, before anyone is admitted) and `health` (its Mate answering). The birth worker
 *   (`birthWorker.ts`) drives them; this store only keeps where each one got to.
 * - Records are personal context under one account key (§1.1): never authority for existence or
 *   access, revalidated against the platform's facts by the worker. They carry no expiry: a birth
 *   ends when its connect promotes it, or when it is forgotten (its project failed or was removed).
 * - The opening job (`creationHandoff.ts`) moves from the birth to the environment the connect
 *   named, and stays there until the chat says it.
 *
 * Every write reads the stored value first, so another tab's write is never overwritten by a stale
 * copy; a storage event from another tab is a `reload`. Storage that refuses reads or writes
 * leaves the ledger in this tab's memory.
 */
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import { parseCreationHandoff, type ZeropsCreationHandoff } from "../creationHandoff.ts";

export const BIRTHS_KEY = "zerops-mate.births.v1";

export type BirthStep = "tags" | "registry" | "harden" | "health";

const STEPS: ReadonlySet<string> = new Set<BirthStep>(["tags", "registry", "harden", "health"]);
const KINDS: ReadonlySet<string> = new Set<RoleProjectKind>(["mate", "stage", "production"]);

/** The group writes a birth owes, as the creation that started it knew them. */
export interface BirthRegistration {
  /** The account's Gitea project, where the registry lives. */
  readonly giteaProjectId: string;
  /** The account's Gitea, where a stage or a production is declared; null for a Mate. */
  readonly giteaOrigin: string | null;
  readonly groupId: string;
  readonly kind: RoleProjectKind;
  /** What the person called the environment. */
  readonly displayName: string;
}

export interface BirthRecord {
  readonly projectId: string;
  /** The organization the project was created in — never the one a tab has open now. */
  readonly organizationId: string;
  /** When the platform accepted the creation, wall ms. */
  readonly startedAt: number;
  readonly step: BirthStep;
  /** The current step outlasted its cap (MC-13): words, never another step. */
  readonly overdue: boolean;
  /** The group writes this birth owes; null when none are this person's to write. */
  readonly registration: BirthRegistration | null;
  /** Whether a Mate container is born: false for a stage or a production without an agent. */
  readonly container: boolean;
  /** The Mate's service and origin, once hardening found them; `health` resumes on them. */
  readonly serviceId: string | null;
  readonly origin: string | null;
  /** The environment's opening job; the connect moves it onto the environment. */
  readonly handoff: ZeropsCreationHandoff | null;
}

export interface BirthLedger {
  readonly births: ReadonlyArray<BirthRecord>;
  /** Opening jobs by the environment their birth connected to. */
  readonly jobs: Readonly<Record<string, ZeropsCreationHandoff>>;
}

/** What a creation knows at create-accepted. */
export interface BeginBirth {
  readonly projectId: string;
  readonly organizationId: string;
  readonly registration: BirthRegistration | null;
  readonly container: boolean;
  readonly handoff: ZeropsCreationHandoff | null;
}

export type BirthPatch = Partial<Pick<BirthRecord, "step" | "overdue" | "serviceId" | "origin">>;

/** One account's storage, synchronous: the opening job is read inside a route effect. */
export interface BirthsStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export interface BirthStore {
  /** The stored births and jobs; the same object until they change. */
  readonly ledger: () => BirthLedger;
  readonly birth: (projectId: string) => BirthRecord | undefined;
  /** The platform accepted a creation: its birth starts, in place of an older one of the project. */
  readonly begin: (input: BeginBirth) => void;
  readonly update: (projectId: string, patch: BirthPatch) => void;
  /** The connect named the environment: the birth is over, and its job waits there. */
  readonly promote: (projectId: string, environmentId: string) => void;
  /** The project failed or was removed: nothing is born of it. */
  readonly forget: (projectId: string) => void;
  readonly job: (environmentId: string) => ZeropsCreationHandoff | undefined;
  readonly forgetJob: (environmentId: string) => void;
  /** Another tab wrote the records. */
  readonly reload: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

const EMPTY: BirthLedger = { births: [], jobs: {} };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function parseRegistration(value: unknown): BirthRegistration | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const { giteaProjectId, giteaOrigin, groupId, kind, displayName } = value;
  if (
    !nonEmpty(giteaProjectId) ||
    !nullableString(giteaOrigin) ||
    !nonEmpty(groupId) ||
    typeof kind !== "string" ||
    !KINDS.has(kind) ||
    typeof displayName !== "string"
  ) {
    return undefined;
  }
  return { giteaProjectId, giteaOrigin, groupId, kind: kind as RoleProjectKind, displayName };
}

function parseRecord(value: unknown): BirthRecord | undefined {
  if (!isObject(value)) return undefined;
  const registration = parseRegistration(value.registration);
  const handoff = value.handoff === null ? null : parseCreationHandoff(value.handoff);
  const { projectId, organizationId, startedAt, step, overdue, container } = value;
  const { serviceId, origin } = value;
  if (
    !nonEmpty(projectId) ||
    !nonEmpty(organizationId) ||
    typeof startedAt !== "number" ||
    typeof step !== "string" ||
    !STEPS.has(step) ||
    typeof overdue !== "boolean" ||
    registration === undefined ||
    typeof container !== "boolean" ||
    !nullableString(serviceId) ||
    !nullableString(origin) ||
    handoff === undefined
  ) {
    return undefined;
  }
  return {
    projectId,
    organizationId,
    startedAt,
    step: step as BirthStep,
    overdue,
    registration,
    container,
    serviceId,
    origin,
    handoff,
  };
}

/** Parses the stored ledger; anything this version cannot read is dropped, never guessed. */
export function parseBirths(raw: string | null): BirthLedger {
  if (raw === null) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!isObject(parsed)) return EMPTY;
  const births = Array.isArray(parsed.births)
    ? parsed.births.flatMap((value) => parseRecord(value) ?? [])
    : [];
  const jobs: Record<string, ZeropsCreationHandoff> = {};
  if (isObject(parsed.jobs)) {
    for (const [environmentId, value] of Object.entries(parsed.jobs)) {
      const handoff = parseCreationHandoff(value);
      if (handoff !== undefined) jobs[environmentId] = handoff;
    }
  }
  return { births, jobs };
}

/**
 * The projects whose Mate is not closed off yet (DESIGN §4.5): nothing connects to them on its
 * own until their birth reaches `health`, however long that takes.
 */
export function unhardenedBirths(births: ReadonlyArray<BirthRecord>): ReadonlySet<string> {
  return new Set(
    births
      .filter((birth) => birth.container && birth.step !== "health")
      .map((birth) => birth.projectId),
  );
}

/** The step a birth starts on: the first thing it owes. */
function firstStep(input: BeginBirth): BirthStep | null {
  if (input.registration !== null) return "tags";
  return input.container ? "harden" : null;
}

export function makeBirthStore(ports: {
  readonly storage: BirthsStorage;
  /** Wall ms: a birth's start survives a reload. */
  readonly now: () => number;
}): BirthStore {
  const { storage } = ports;
  const listeners = new Set<() => void>();
  /** What storage held when this store last read or wrote it. */
  let stored: string | null = null;
  const read = (): string | null => {
    try {
      return storage.getItem(BIRTHS_KEY);
    } catch {
      return stored;
    }
  };
  stored = read();
  let ledger = parseBirths(stored);
  /** The ledger as published, serialized: a write that changes nothing tells nobody. */
  let published = JSON.stringify(ledger);

  const publish = () => {
    for (const listener of listeners) listener();
  };

  const reload = () => {
    const next = read();
    if (next === stored) return;
    stored = next;
    ledger = parseBirths(next);
    published = JSON.stringify(ledger);
    publish();
  };

  const mutate = (change: (current: BirthLedger) => BirthLedger) => {
    // Another tab's write since this store's own is the base; storage that refuses reads or
    // writes leaves the ledger in memory, driven by this tab alone.
    const now = read();
    const next = change(now === stored ? ledger : parseBirths(now));
    const serialized = JSON.stringify(next);
    try {
      storage.setItem(BIRTHS_KEY, serialized);
      stored = serialized;
    } catch {
      stored = now;
    }
    ledger = next;
    if (serialized === published) return;
    published = serialized;
    publish();
  };

  const without = (current: BirthLedger, projectId: string) =>
    current.births.filter((birth) => birth.projectId !== projectId);

  return {
    ledger: () => ledger,
    birth: (projectId) => ledger.births.find((birth) => birth.projectId === projectId),
    begin: (input) => {
      const step = firstStep(input);
      if (step === null) return;
      mutate((current) => {
        const older = current.births.find((birth) => birth.projectId === input.projectId);
        const record: BirthRecord = {
          projectId: input.projectId,
          organizationId: input.organizationId,
          startedAt: ports.now(),
          step,
          overdue: false,
          registration: input.registration,
          container: input.container,
          serviceId: null,
          origin: null,
          handoff: input.handoff ?? older?.handoff ?? null,
        };
        return { ...current, births: [...without(current, input.projectId), record] };
      });
    },
    update: (projectId, patch) => {
      mutate((current) => ({
        ...current,
        births: current.births.map((birth) =>
          birth.projectId === projectId ? { ...birth, ...patch } : birth,
        ),
      }));
    },
    promote: (projectId, environmentId) => {
      mutate((current) => {
        const birth = current.births.find((entry) => entry.projectId === projectId);
        if (birth === undefined) return current;
        return {
          births: without(current, projectId),
          jobs:
            birth.handoff === null
              ? current.jobs
              : { ...current.jobs, [environmentId]: birth.handoff },
        };
      });
    },
    forget: (projectId) => {
      mutate((current) => ({ ...current, births: without(current, projectId) }));
    },
    job: (environmentId) => ledger.jobs[environmentId],
    forgetJob: (environmentId) => {
      mutate((current) => {
        const { [environmentId]: _spent, ...jobs } = current.jobs;
        return { ...current, jobs };
      });
    },
    reload,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
