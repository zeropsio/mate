/**
 * The Mate whose screen is open on this device — one of its threads — is the account's route
 * (krok-a-hub §3): a remembered Mate connects when it is opened, not only through Connect. The
 * stage reads it as it starts (`openMateRoute`, its `route` port); a standing stage is told.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";

let open: EnvironmentId | null = null;

/** The environment whose Mate's screen is open now; null when none is. */
export const openMateRoute = (): EnvironmentId | null => open;

/**
 * Opens the screen of this environment's Mate, and tells the stage when one stands; the answer
 * closes it.
 */
export function openMateScreen(
  environments: AccountEnvironments | null,
  environmentId: EnvironmentId,
): () => void {
  open = environmentId;
  environments?.setRoute(environmentId);
  return () => {
    if (open === environmentId) open = null;
    environments?.setRoute(null);
  };
}
