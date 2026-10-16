/**
 * How a person picks one of a Mate's public addresses (`mateAddresses`): a
 * pick opens it in the panel's Browser, and the browser's own new-tab
 * gestures — ⌘/ctrl/shift-click, a middle click — open it in a new tab. Any
 * other button (`auxclick` fires for the right one too) opens nothing.
 */
import type { MateAddressRole } from "~/zerops/mateAddresses.logic";

export type MateAddressOpenTarget = "panel" | "new-tab" | "none";

export function mateAddressOpenTarget(
  event:
    | {
        readonly button: number;
        readonly metaKey: boolean;
        readonly ctrlKey: boolean;
        readonly shiftKey: boolean;
      }
    | undefined,
): MateAddressOpenTarget {
  if (event === undefined) return "panel";
  if (event.button > 1) return "none";
  return event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey
    ? "new-tab"
    : "panel";
}

const ROLE_WORDS: Record<MateAddressRole, string> = {
  dev: "Dev",
  preview: "Preview",
  stage: "Stage",
  production: "Production",
};

/** What an address is to the person; a service outside the roles is its name alone. */
export function mateAddressRoleWord(role: MateAddressRole | undefined): string | undefined {
  return role === undefined ? undefined : ROLE_WORDS[role];
}

/**
 * What a site's row says after its role: what tells it from another of that role — an
 * environment's name, a dev server's port — never the service's bare hostname, which the role and
 * the address below it already say. A service outside the roles is named by the role's place.
 */
export function mateAddressNameWords(address: {
  readonly role: MateAddressRole | undefined;
  readonly name: string;
}): string | undefined {
  if (address.role === undefined) return undefined;
  return /\s/u.test(address.name) ? address.name : undefined;
}
