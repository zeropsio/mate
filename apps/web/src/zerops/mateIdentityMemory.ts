/**
 * The Mates' names and faces as the last visit had them, by environment: a reload paints them on
 * its first frame, before HQ answers, and HQ's answer replaces them ("a reload paints nothing it
 * takes back"). With nothing remembered a surface holds its place without a name.
 */
import type { HqMateIdentity } from "@t3tools/client-runtime/data";
import { sameValue } from "../lib/sameValue";
import { accountLocalStorage } from "./accountLifetime";

const KEY = "mate:identities:v1";

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
 * read, an environment it no longer lists is forgotten. The same memory when nothing changed.
 */
export function rememberMates(
  memory: MateMemory,
  identities: ReadonlyArray<HqMateIdentity>,
  listRead: boolean,
): MateMemory {
  const next: Record<string, HqMateIdentity> = listRead ? {} : { ...memory };
  for (const identity of identities) {
    if (identity.environmentId !== undefined) next[identity.environmentId] = identity;
  }
  return sameValue(next, memory) ? memory : next;
}

/**
 * The identities a surface draws: HQ's own once its list is read; before that, HQ's where it
 * named one and the remembered ones where it has not yet.
 */
export function seededIdentities(
  identities: ReadonlyArray<HqMateIdentity>,
  memory: MateMemory,
  listRead: boolean,
): ReadonlyArray<HqMateIdentity> {
  if (listRead) return identities;
  const named = new Set<string>(identities.flatMap((identity) => identity.environmentId ?? []));
  return [
    ...identities,
    ...Object.entries(memory).flatMap(([environmentId, identity]) =>
      named.has(environmentId) ? [] : [{ ...identity, environmentId } as HqMateIdentity],
    ),
  ];
}
