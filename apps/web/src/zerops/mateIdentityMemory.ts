/**
 * Who lives in each environment, as this browser last knew it (`zeropsMateAt` over the candidate
 * listing), so a reload of a Mate's conversation draws its stage — its face and its name — from
 * the first frame, before the catalog is read (the owner, 2026-09-30: a conversation URL sat
 * blank for 3 s). What the listing says replaces it the moment it is read. Kept per account, like
 * the menu's memory, and forgotten when the account closes.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_IDS, MATE_TINT_IDS } from "@t3tools/shared/brand";

import { accountLocalStorage, currentAccountId, onAccountLifetimeClose } from "./accountLifetime";
import type { ZeropsMateDirectory, ZeropsMateIdentity } from "./mateIdentities";

export const MATE_IDENTITY_MEMORY_KEY = "mate:zerops:mate-identities";

/**
 * Environment → the Mate that lives there, its socket never known to be up; whether its container
 * was running (`running`) and until when it is arriving (`arrivingUntil`) are kept, so its
 * opening wears the pose it last had — the one its menu row wears.
 */
export type MateIdentityMemory = Readonly<Record<string, ZeropsMateIdentity>>;

const TINTS: ReadonlySet<string> = new Set(MATE_TINT_IDS);
const SHAPES: ReadonlySet<string> = new Set(MATE_SHAPE_IDS);

const remembered = (mate: ZeropsMateIdentity): ZeropsMateIdentity => ({
  ...(mate.serviceId === undefined ? {} : { serviceId: mate.serviceId }),
  ...(mate.projectId === undefined ? {} : { projectId: mate.projectId }),
  ...(mate.running === undefined ? {} : { running: mate.running }),
  ...(mate.arrivingUntil === undefined ? {} : { arrivingUntil: mate.arrivingUntil }),
  name: mate.name,
  tint: mate.tint,
  shape: mate.shape,
  project: mate.project,
  projectUrl: mate.projectUrl,
  connected: false,
});

const same = (a: ZeropsMateIdentity, b: ZeropsMateIdentity): boolean =>
  a.serviceId === b.serviceId &&
  a.projectId === b.projectId &&
  a.running === b.running &&
  a.arrivingUntil === b.arrivingUntil &&
  a.name === b.name &&
  a.tint === b.tint &&
  a.shape === b.shape &&
  a.project === b.project &&
  a.projectUrl === b.projectUrl;

/** The memory with what the directory decides: its Mates remembered, its empty environments gone. */
export function withMateIdentities(
  memory: MateIdentityMemory,
  directory: ZeropsMateDirectory,
  /** The listing behind the directory was read whole: what it does not name is gone. */
  options: { readonly complete: boolean } = { complete: false },
): MateIdentityMemory {
  let next: Record<string, ZeropsMateIdentity> | null = null;
  const edit = () => (next ??= { ...memory });
  if (options.complete) {
    for (const environmentId of Object.keys(memory)) {
      if (!directory.has(environmentId as EnvironmentId)) delete edit()[environmentId];
    }
  }
  for (const [environmentId, mate] of directory) {
    const held = memory[environmentId];
    if (mate === null) {
      if (held !== undefined) delete edit()[environmentId];
      continue;
    }
    if (held === undefined || !same(held, mate)) edit()[environmentId] = remembered(mate);
  }
  return next ?? memory;
}

const readMate = (value: unknown): ZeropsMateIdentity | null => {
  if (typeof value !== "object" || value === null) return null;
  const mate = value as Record<string, unknown>;
  if (
    typeof mate.name !== "string" ||
    typeof mate.tint !== "string" ||
    !TINTS.has(mate.tint) ||
    typeof mate.shape !== "string" ||
    !SHAPES.has(mate.shape) ||
    typeof mate.projectUrl !== "string" ||
    (mate.project !== undefined && typeof mate.project !== "string") ||
    (mate.serviceId !== undefined && typeof mate.serviceId !== "string") ||
    (mate.projectId !== undefined && typeof mate.projectId !== "string") ||
    (mate.running !== undefined && typeof mate.running !== "boolean") ||
    (mate.arrivingUntil !== undefined && typeof mate.arrivingUntil !== "number")
  ) {
    return null;
  }
  return remembered(mate as unknown as ZeropsMateIdentity);
};

/** The memory as stored; an unreadable one, or one from a shape before this, remembers nothing. */
export function readIdentityMemory(text: string | null): MateIdentityMemory {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return {};
    const memory: Record<string, ZeropsMateIdentity> = {};
    for (const [environmentId, value] of Object.entries(parsed)) {
      const mate = readMate(value);
      if (mate !== null) memory[environmentId] = mate;
    }
    return memory;
  } catch {
    return {};
  }
}

export function writeIdentityMemory(memory: MateIdentityMemory): string {
  return JSON.stringify(memory);
}

let held: { readonly account: string; memory: MateIdentityMemory } | null = null;
// A closed account's memory is gone with it, like the menu's.
onAccountLifetimeClose(() => {
  held = null;
  try {
    accountLocalStorage.removeItem(MATE_IDENTITY_MEMORY_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});

function memoryNow(): MateIdentityMemory {
  const account = typeof window === "undefined" ? null : currentAccountId();
  if (account === null) return {};
  if (held?.account !== account) {
    let text: string | null = null;
    try {
      text = accountLocalStorage.getItem(MATE_IDENTITY_MEMORY_KEY);
    } catch {
      text = null;
    }
    held = { account, memory: readIdentityMemory(text) };
  }
  return held.memory;
}

/** Every Mate this browser last knew, by environment. */
export function rememberedMateIdentities(): MateIdentityMemory {
  return memoryNow();
}

/** The Mate this browser last knew in `environmentId`, asleep; undefined where it knew none. */
export function rememberedMateIdentity(
  environmentId: EnvironmentId,
): ZeropsMateIdentity | undefined {
  return memoryNow()[environmentId];
}

/** The Mate this memory knows in `projectId`, and the environment it lives in. */
export function mateOfProject(
  memory: MateIdentityMemory,
  projectId: string,
): { readonly environmentId: EnvironmentId; readonly mate: ZeropsMateIdentity } | undefined {
  for (const [environmentId, mate] of Object.entries(memory)) {
    if (mate.projectId === projectId) {
      return { environmentId: environmentId as EnvironmentId, mate };
    }
  }
  return undefined;
}

/** The Mate this browser last knew in `projectId` (a Mate's own page has only its project). */
export function rememberedMateOfProject(projectId: string): ReturnType<typeof mateOfProject> {
  return mateOfProject(memoryNow(), projectId);
}

/** Remembers what the directory decides, written at once only when it changed something. */
export function rememberMateIdentities(
  directory: ZeropsMateDirectory,
  options: { readonly complete: boolean },
): void {
  const before = memoryNow();
  if (held === null) return;
  const next = withMateIdentities(before, directory, options);
  if (next === before) return;
  held.memory = next;
  try {
    accountLocalStorage.setItem(MATE_IDENTITY_MEMORY_KEY, writeIdentityMemory(next));
  } catch {
    // A full or blocked storage remembers nothing; the listing still draws the Mate.
  }
}
