/**
 * How a person picks one of a Mate's public addresses (`mateAddresses`): a
 * pick opens it in the panel's Browser, and the browser's own new-tab
 * gestures — ⌘/ctrl/shift-click, a middle click — open it in a new tab.
 */
import type { MateAddressRole } from "~/zerops/mateAddresses.logic";

export type MateAddressOpenTarget = "panel" | "new-tab";

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
  return event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey
    ? "new-tab"
    : "panel";
}

const ROLE_WORDS: Record<MateAddressRole, string> = {
  dev: "Dev",
  stage: "Stage",
  production: "Production",
};

/** What an address is to the person; a service outside the roles is its name alone. */
export function mateAddressRoleWord(role: MateAddressRole | undefined): string | undefined {
  return role === undefined ? undefined : ROLE_WORDS[role];
}
