/**
 * The birth store (DESIGN §4.5, §2.C C9): one persisted record per Mate this account is bringing
 * up, from the moment the platform accepted its creation until the connect that names its
 * environment.
 *
 * - A birth starts at **create-accepted** and owes, in order, `tags` (its registry entry on the
 *   account's Gitea project), `registry` (the rest of its group registration: the broker's grant,
 *   and for a stage or a production its deploy token and declaration), `harden` (its project
 *   closed off, before anyone is admitted), `runtimes` (its tier's runtimes imported, once nothing
 *   that runs code can start holding the Mate's key) and `health` (its Mate answering). The birth
 *   worker (`birthWorker.ts`) drives them; this store only keeps where each one got to, and the
 *   runtimes' import document from the creation that planned it.
 * - Records are personal context under one account key (§1.1): never authority for existence or
 *   access, revalidated against the platform's facts by the worker. They carry no expiry: a birth
 *   ends when it is forgotten: its connect named the environment, or its project failed or was
 *   removed.
 *
 * Every write reads the stored value first, so another tab's write is never overwritten by a stale
 * copy; a storage event from another tab is a `reload`. Storage that refuses reads or writes
 * leaves the ledger in this tab's memory.
 */
import {
  MATE_SHAPE_IDS,
  MATE_TINT_IDS,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import type { RecipeRuntime, RecipeRuntimeRole } from "../recipeTier.ts";

export const BIRTHS_KEY = "zerops-mate.births.v1";

export type BirthStep = "tags" | "registry" | "harden" | "runtimes" | "health";

const STEPS: ReadonlySet<string> = new Set<BirthStep>([
  "tags",
  "registry",
  "harden",
  "runtimes",
  "health",
]);
const KINDS: ReadonlySet<string> = new Set<RoleProjectKind>(["mate", "stage", "production"]);
const TINTS: ReadonlySet<string> = new Set<string>(MATE_TINT_IDS);
const SHAPES: ReadonlySet<string> = new Set<string>(MATE_SHAPE_IDS);
const RUNTIME_ROLES: ReadonlySet<string> = new Set<RecipeRuntimeRole>(["dev", "stage", "utility"]);

/**
 * The tier's runtimes a Mate's birth imports once its project is closed off
 * (`createEnvironment.ts`), carried from the creation's plan so that a reload
 * between the two loses nothing.
 */
export interface BirthRuntimes {
  /** The one import, services only, converted (`splitRecipeTier`). */
  readonly yaml: string;
  /** Each runtime it creates, in the tier's order. */
  readonly services: ReadonlyArray<RecipeRuntime>;
  /** The platform would not take them, in its words: the birth went on to its Mate without them. */
  readonly failed?: string;
}

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

/**
 * Where the environment being born stands in the account's projects, as the creation that started
 * it knew it — drawn in its group before the organization's listing holds the project. Kept apart
 * from {@link BirthRegistration}, which is null whenever the person may not write the registry.
 */
export interface BirthPlacement {
  readonly groupId: string;
  /** The group's name as the creation knew it; names a group the listing does not hold yet. */
  readonly groupName: string;
  readonly kind: RoleProjectKind;
  /** What the person called the environment. */
  readonly displayName: string;
  /** What a Mate is called — its name, not its environment's — drawn while it comes up. */
  readonly botName?: string;
  /**
   * The face its person picked for a Mate (the New Mate dialog), worn asleep while it comes up —
   * before the listing holds its project and its `mate:face:` tag can be read. Absent for a stage
   * or a production, and for a face this build cannot read.
   */
  readonly face?: { readonly tint: MateTintId; readonly shape: MateShapeId };
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
  /**
   * Whether a Mate container is born: false for a stage or a production without an agent, and for
   * a creation whose container import failed after its project was accepted.
   */
  readonly container: boolean;
  /** The Mate's service and origin, once hardening found them; `health` resumes on them. */
  readonly serviceId: string | null;
  readonly origin: string | null;
  /** Its group, where the creation knew one; null for a project already listed or claimed. */
  readonly placement: BirthPlacement | null;
  /** The runtimes it imports after closing the project off; absent for a birth that imports none. */
  readonly runtimes?: BirthRuntimes;
}

export interface BirthLedger {
  readonly births: ReadonlyArray<BirthRecord>;
}

/** What a creation knows at create-accepted. */
export interface BeginBirth {
  readonly projectId: string;
  readonly organizationId: string;
  readonly registration: BirthRegistration | null;
  readonly container: boolean;
  readonly placement: BirthPlacement | null;
  /** The tier's runtimes its plan left for after the project is closed off. */
  readonly runtimes?: BirthRuntimes;
}

export type BirthPatch = Partial<
  Pick<BirthRecord, "step" | "overdue" | "container" | "serviceId" | "origin" | "runtimes">
>;

/** One account's storage, synchronous. */
export interface BirthsStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export interface BirthStore {
  /** The stored births; the same object until they change. */
  readonly ledger: () => BirthLedger;
  readonly birth: (projectId: string) => BirthRecord | undefined;
  /** The platform accepted a creation: its birth starts, in place of an older one of the project. */
  readonly begin: (input: BeginBirth) => void;
  readonly update: (projectId: string, patch: BirthPatch) => void;
  /** The birth is over: the connect named its environment, or its project failed or was removed. */
  readonly forget: (projectId: string) => void;
  /** Another tab wrote the records. */
  readonly reload: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

const EMPTY: BirthLedger = { births: [] };

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

/** A placement's face, where this build knows both its tint and its shape. */
function parseFace(value: unknown): BirthPlacement["face"] {
  if (!isObject(value)) return undefined;
  const { tint, shape } = value;
  if (typeof tint !== "string" || !TINTS.has(tint)) return undefined;
  if (typeof shape !== "string" || !SHAPES.has(shape)) return undefined;
  return { tint: tint as MateTintId, shape: shape as MateShapeId };
}

function parsePlacement(value: unknown): BirthPlacement | null | undefined {
  // A record stored before births were placed names none: it is placed nowhere.
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return undefined;
  const { groupId, groupName, kind, displayName } = value;
  if (
    !nonEmpty(groupId) ||
    typeof groupName !== "string" ||
    typeof kind !== "string" ||
    !KINDS.has(kind) ||
    typeof displayName !== "string"
  ) {
    return undefined;
  }
  // A face or a name it cannot read is not drawn: the record stands without it.
  const face = parseFace(value.face);
  const botName = nonEmpty(value.botName) ? value.botName : undefined;
  return {
    groupId,
    groupName,
    kind: kind as RoleProjectKind,
    displayName,
    ...(botName === undefined ? {} : { botName }),
    ...(face === undefined ? {} : { face }),
  };
}

/** A runtime this build knows the role of. */
function parseRuntime(value: unknown): RecipeRuntime | undefined {
  if (!isObject(value)) return undefined;
  const { hostname, role } = value;
  if (!nonEmpty(hostname) || typeof role !== "string" || !RUNTIME_ROLES.has(role)) return undefined;
  return { hostname, role: role as RecipeRuntimeRole };
}

/** Null for a record that carries none; undefined for runtimes this build cannot read. */
function parseRuntimes(value: unknown): BirthRuntimes | null | undefined {
  if (value === undefined) return null;
  if (!isObject(value)) return undefined;
  const { yaml, services, failed } = value;
  if (!nonEmpty(yaml) || !Array.isArray(services)) return undefined;
  if (failed !== undefined && typeof failed !== "string") return undefined;
  const runtimes = services.map(parseRuntime);
  if (runtimes.some((runtime) => runtime === undefined)) return undefined;
  return {
    yaml,
    services: runtimes as ReadonlyArray<RecipeRuntime>,
    ...(failed === undefined ? {} : { failed }),
  };
}

function parseRecord(value: unknown): BirthRecord | undefined {
  if (!isObject(value)) return undefined;
  const registration = parseRegistration(value.registration);
  const placement = parsePlacement(value.placement);
  const runtimes = parseRuntimes(value.runtimes);
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
    placement === undefined ||
    runtimes === undefined
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
    placement,
    ...(runtimes === null ? {} : { runtimes }),
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
  return { births };
}

/**
 * The projects whose Mate is not closed off yet (DESIGN §4.5), or whose runtimes are still being
 * asked for: nothing connects to them on its own until their birth reaches `health`, however long
 * that takes.
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
          placement: input.placement ?? older?.placement ?? null,
          ...(input.runtimes === undefined ? {} : { runtimes: input.runtimes }),
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
    forget: (projectId) => {
      mutate((current) => ({ ...current, births: without(current, projectId) }));
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
