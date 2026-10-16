/**
 * The Mates' names and faces as the last visit had them, by environment, and whose Chief HQ said
 * the viewer has, by organization: a reload paints them on its first frame, before HQ answers, and
 * HQ's answer replaces them ("a reload paints nothing it takes back"). With nothing remembered a
 * surface holds its place without a name.
 */
import type { HqMateIdentity } from "@t3tools/client-runtime/data";
import { sameValue } from "../lib/sameValue";
import { accountLocalStorage } from "./accountLifetime";

const KEY = "mate:identities:v1";
const CHIEF_KEY = "mate:chief:v1";
const OVERVIEW_CARDS_KEY = "mate:overview-cards:v1";

/** What a Mate's name and face need, by its environment. */
export type MateMemory = Readonly<Record<string, HqMateIdentity>>;

const EMPTY: MateMemory = {};

function isIdentity(value: unknown): value is HqMateIdentity {
  if (typeof value !== "object" || value === null) return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.projectId === "string" &&
    typeof identity.name === "string" &&
    typeof identity.tint === "string" &&
    typeof identity.shape === "string" &&
    typeof identity.projectUrl === "string"
  );
}

/** The account's own storage: another account's sign-in reads its own, never this one's. */
const accountStorage = (): Pick<Storage, "getItem" | "setItem"> | undefined =>
  typeof window === "undefined" ? undefined : accountLocalStorage;

/** What the last visit remembered; nothing when storage is missing, blocked or unreadable. */
export function readMateMemory(
  storage: Pick<Storage, "getItem"> | undefined = accountStorage(),
): MateMemory {
  try {
    const raw = storage?.getItem(KEY);
    if (raw == null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, HqMateIdentity] => isIdentity(entry[1]),
      ),
    );
  } catch {
    return EMPTY;
  }
}

export function writeMateMemory(
  memory: MateMemory,
  storage: Pick<Storage, "setItem"> | undefined = accountStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* A storage policy can make this visit forget. */
  }
}

/**
 * The memory once HQ named `identities`: each named Mate as HQ names it now; once HQ's list is
 * read, a project it no longer lists is forgotten. The same memory when nothing changed.
 */
export function rememberMates(
  memory: MateMemory,
  identities: ReadonlyArray<HqMateIdentity>,
  listRead: boolean,
): MateMemory {
  const next: Record<string, HqMateIdentity> = {};
  for (const identity of seededIdentities(identities, memory, listRead)) {
    if (identity.environmentId !== undefined) next[identity.environmentId] = identity;
  }
  return sameValue(next, memory) ? memory : next;
}

/**
 * Navigation owns names, faces and project membership; the separately observed overview owns
 * the environment. A still-listed project keeps its remembered environment until that join
 * arrives. Before navigation is complete, retain projects it has not named yet as well.
 */
export function seededIdentities(
  identities: ReadonlyArray<HqMateIdentity>,
  memory: MateMemory,
  listRead: boolean,
): ReadonlyArray<HqMateIdentity> {
  const remembered = new Map(
    Object.entries(memory).map(([environmentId, identity]) => [
      identity.projectId,
      { ...identity, environmentId: environmentId as HqMateIdentity["environmentId"] },
    ]),
  );
  const named = new Set(identities.map((identity) => identity.projectId));
  return [
    ...identities.map((identity) =>
      identity.environmentId === undefined && remembered.has(identity.projectId)
        ? { ...identity, environmentId: remembered.get(identity.projectId)?.environmentId }
        : identity,
    ),
    ...(listRead
      ? []
      : [...remembered.values()].filter((identity) => !named.has(identity.projectId))),
  ];
}

/** Whose Chief the last visit had HQ name in `orgId`: its project, none, or undefined if unknown. */
export function readChiefMemory(
  orgId: string,
  storage: Pick<Storage, "getItem"> | undefined = accountStorage(),
): string | null | undefined {
  try {
    const raw = storage?.getItem(CHIEF_KEY);
    if (raw == null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !Object.hasOwn(parsed, orgId))
      return undefined;
    const chief = (parsed as Record<string, unknown>)[orgId];
    return chief === null || typeof chief === "string" ? chief : undefined;
  } catch {
    return undefined;
  }
}

export function writeChiefMemory(
  orgId: string,
  chief: string | null,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = accountStorage(),
): void {
  try {
    const raw = storage?.getItem(CHIEF_KEY);
    const parsed: unknown = raw == null ? {} : JSON.parse(raw);
    const held = typeof parsed === "object" && parsed !== null ? parsed : {};
    storage?.setItem(CHIEF_KEY, JSON.stringify({ ...held, [orgId]: chief }));
  } catch {
    /* A storage policy can make this visit forget. */
  }
}

/**
 * How many project cards the last visit's overview drew: what its stand-in draws on the next
 * load's first frame, so it promises no card it takes back. `null` when nothing is remembered.
 */
export function readOverviewCardsMemory(
  storage: Pick<Storage, "getItem"> | undefined = accountStorage(),
): string | null {
  try {
    return storage?.getItem(OVERVIEW_CARDS_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeOverviewCardsMemory(
  count: number,
  storage: Pick<Storage, "setItem"> | undefined = accountStorage(),
): void {
  try {
    storage?.setItem(OVERVIEW_CARDS_KEY, String(count));
  } catch {
    /* A storage policy can make this visit forget. */
  }
}
