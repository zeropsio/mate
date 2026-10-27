/**
 * What a message tells its agent besides the person's words, fitted to what the engine takes: the
 * changes merged since it last spoke, then each vault change on a line of its own — names, never a
 * value. More than fits ends in how many more vault changes there are; those wait for the next
 * message. Context never makes a send fail, so nothing here outgrows the bound.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module data/projections/agentContext
 */
import { ENGINE_SEND_CONTEXT_LIMITS } from "@t3tools/contracts";

import { vaultNote } from "./vaultChanges.ts";
import type { VaultChange } from "./vaultModel.ts";

const { lines: MAX_LINES, lineChars: MAX_CHARS } = ENGINE_SEND_CONTEXT_LIMITS;
const ELLIPSIS = "…";

/** A line cut to the bound on a word boundary, with an ellipsis; a line that fits stays whole. */
export function fitContextLine(line: string): string {
  const whole = line.trim();
  if (whole.length <= MAX_CHARS) return whole;
  const room = MAX_CHARS - ELLIPSIS.length;
  const head = whole.slice(0, room);
  const atBoundary = /\s/u.test(whole.charAt(room));
  const lastSpace = head.search(/\s\S*$/u);
  const cut = atBoundary || lastSpace <= 0 ? head : head.slice(0, lastSpace);
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

/**
 * The context lines for a message, and the vault changes they tell: only those are marked told,
 * so the rest are told with a later message.
 */
export function agentContext(
  landed: ReadonlyArray<string>,
  vault: ReadonlyArray<VaultChange>,
): { readonly lines: ReadonlyArray<string>; readonly told: ReadonlyArray<VaultChange> } {
  const landings = landed.map(fitContextLine).filter((line) => line.length > 0);
  if (landings.length + vault.length <= MAX_LINES) {
    return { lines: [...landings, ...vault.map(lineOf)], told: vault };
  }
  // The newest landings keep their lines; one line is kept for what the vault cannot list.
  const kept = vault.length === 0 ? landings.slice(-MAX_LINES) : landings.slice(-(MAX_LINES - 1));
  if (vault.length === 0) return { lines: kept, told: [] };
  const listed = vault.slice(0, MAX_LINES - kept.length - 1);
  const more = vault.length - listed.length;
  return {
    lines: [
      ...kept,
      ...listed.map(lineOf),
      `and ${String(more)} more vault ${more === 1 ? "change" : "changes"}`,
    ],
    told: listed,
  };
}

const lineOf = (change: VaultChange): string => fitContextLine(vaultNote([change]) ?? change.key);
