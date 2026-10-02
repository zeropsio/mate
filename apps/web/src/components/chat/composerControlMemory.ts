/**
 * The composer's one control as it last looked for a model — its agent's mark, "Opus 5.5 ·
 * Medium" — remembered in this browser, so a conversation that opens before its agents' catalog is
 * read draws it as it will stand, not as the raw selection ("claude-opus-5-5") relabelled a
 * second later (pass 30: one composer look from the first frame). The catalog's word always
 * wins once read.
 */
import type { ProviderDriverKind } from "@t3tools/contracts";

import type { ComposerModelControlLabel } from "./ComposerModelControl.logic";

export interface ComposerControlLook {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly label: ComposerModelControlLabel;
}

export type ComposerControlMemory = Readonly<Record<string, ComposerControlLook>>;

const STORAGE_KEY = "mate:composer-control:v1";
/** Enough for the models a person switches between and the conversations they open; oldest first out. */
const ROOM = 48;

export function composerControlKey(instanceId: string, model: string): string {
  return `${instanceId}\u0000${model}`;
}

/** A conversation's own control, for its composer's stand-in before the conversation is read. */
export function composerThreadControlKey(threadKey: string): string {
  return `thread\u0000${threadKey}`;
}

/** What the control shows: the catalog's look once read, else — while it is read — the last one. */
export function shownComposerControl(input: {
  readonly resolved: ComposerControlLook | null;
  readonly pending: boolean;
  readonly remembered: ComposerControlLook | undefined;
}): ComposerControlLook | null {
  if (input.resolved !== null) return input.resolved;
  return input.pending ? (input.remembered ?? null) : null;
}

const isLabel = (value: unknown): value is ComposerModelControlLabel => {
  if (typeof value !== "object" || value === null) return false;
  const label = value as Record<string, unknown>;
  return (
    typeof label.model === "string" &&
    Array.isArray(label.traits) &&
    label.traits.every((trait) => typeof trait === "string") &&
    typeof label.fast === "boolean"
  );
};

const isLook = (value: unknown): value is ComposerControlLook => {
  if (typeof value !== "object" || value === null) return false;
  const look = value as Record<string, unknown>;
  return (
    typeof look.driverKind === "string" &&
    typeof look.displayName === "string" &&
    (look.accentColor === undefined || typeof look.accentColor === "string") &&
    isLabel(look.label)
  );
};

export function readComposerControls(text: string | null): ComposerControlMemory {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return {};
    const memory: Record<string, ComposerControlLook> = {};
    for (const [key, value] of Object.entries(parsed)) if (isLook(value)) memory[key] = value;
    return memory;
  } catch {
    return {};
  }
}

const same = (a: ComposerControlLook | undefined, b: ComposerControlLook): boolean =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** The memory with `look` as the newest, the oldest dropped past its room. */
export function withComposerControl(
  memory: ComposerControlMemory,
  key: string,
  look: ComposerControlLook,
): ComposerControlMemory {
  const entries = Object.entries(memory).filter(([held]) => held !== key);
  entries.push([key, look]);
  return Object.fromEntries(entries.slice(-ROOM));
}

let held: ComposerControlMemory | null = null;

function memoryNow(): ComposerControlMemory {
  if (held === null) {
    let text: string | null = null;
    try {
      text = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      text = null;
    }
    held = readComposerControls(text);
  }
  return held;
}

export function rememberedComposerControl(key: string): ComposerControlLook | undefined {
  return typeof window === "undefined" ? undefined : memoryNow()[key];
}

/** Remembers how the control looks for `key`, written only when it changed. */
export function rememberComposerControl(key: string, look: ComposerControlLook): void {
  const memory = memoryNow();
  if (same(memory[key], look)) return;
  held = withComposerControl(memory, key, look);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(held));
  } catch {
    // Storage refused: the next load draws the raw selection until the catalog is read.
  }
}
