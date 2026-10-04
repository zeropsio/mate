/**
 * *Check what its key can read* (security review 2): on an HQ older than this pass, which keeps no
 * word on a Mate's key (`keyWider`), an owner or an admin asks from the Mate's menu. Only then is
 * the organization's token list read — never on a load (2026-10-03) — and a key an earlier client
 * widened with READ_ONLY on siblings (`findWiderMateKey`) is hardened by the harden Finish setup
 * runs, by its id, leaving it on its own project.
 */
import { findWiderMateKey, type ZeropsIntegrationToken } from "@t3tools/client-runtime/zerops";

/** Whether the check is on a Mate's menu: HQ holds its record and says nothing of its key. */
export function mateKeyCheckOffered(input: {
  /** HQ's record of the Mate; null where HQ holds none — adopting it hardens it anyway. */
  readonly mate: { readonly keyWider?: boolean } | null | undefined;
  /** The viewer may write a Mate's key: an owner or an admin (`canWriteRegistry`). */
  readonly writer: boolean;
}): boolean {
  return input.writer && input.mate != null && input.mate.keyWider === undefined;
}

export type MateKeyCheck =
  /** Its key reads its own project alone, or no key of its was found: nothing written. */
  | { readonly kind: "own" }
  /** Its key read other projects; it reads its own project alone now. */
  | { readonly kind: "narrowed" }
  /** Its key reads other projects, and the platform refused this account its write. */
  | { readonly kind: "not-lowered"; readonly reason: string };

export async function checkMateKey(input: {
  readonly projectId: string;
  /** When its zcp container was made: a key made after it is no key of its. */
  readonly containerCreated: () => Promise<string | undefined>;
  readonly listTokens: () => Promise<ReadonlyArray<ZeropsIntegrationToken>>;
  /** The harden Finish setup runs, on this key alone (`hardenMate`). */
  readonly harden: (keyTokenId: string) => Promise<{ readonly keyNotLowered: string | null }>;
}): Promise<MateKeyCheck> {
  const created = await input.containerCreated();
  const wider = findWiderMateKey(await input.listTokens(), input.projectId, created);
  if (wider === undefined) return { kind: "own" };
  const hardened = await input.harden(wider.id);
  return hardened.keyNotLowered === null
    ? { kind: "narrowed" }
    : { kind: "not-lowered", reason: hardened.keyNotLowered };
}

/** What the check says once done, as a person reads it. */
export function mateKeyCheckWords(name: string, outcome: MateKeyCheck): string {
  switch (outcome.kind) {
    case "own":
      return `${name}'s key reads its own project only.`;
    case "narrowed":
      return `${name}'s key read other projects. It reads its own project only now.`;
    case "not-lowered":
      return `${name}'s key reads other projects, and couldn't be lowered: ${outcome.reason.replace(/\.$/u, "")}; an owner can do it.`;
  }
}
