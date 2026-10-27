/**
 * The picker's Connect (DESIGN §4.4, §7.5): the person's tap is the account's exchange driver's
 * Connect on the row's target — a user retry that wants the Mate from now on. The driver runs the
 * exchange and installs the credential; this only words how it ended.
 */
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import { reachabilityPhrase, type TargetKey } from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId } from "@t3tools/contracts";

import { CLOSE_OFF_STOPPED_LINE } from "./close-off";

export type MateConnectResult =
  | { readonly _tag: "Connected"; readonly environmentId: EnvironmentId }
  | { readonly _tag: "Failed"; readonly error: string };

export async function connectMate(
  environments: Pick<AccountEnvironments, "connect">,
  key: TargetKey,
  /** The Mate's close-off, read as the person opens it (`checkCloseOff`): a held one says why. */
  closeOff?: () => Promise<"held" | "clear">,
): Promise<MateConnectResult> {
  if ((await closeOff?.()) === "held") return { _tag: "Failed", error: CLOSE_OFF_STOPPED_LINE };
  const outcome = await environments.connect(key, "user");
  switch (outcome._tag) {
    case "Connected":
      return outcome;
    case "Closed":
      return { _tag: "Failed", error: "This account session has ended." };
    case "NotConnected": {
      const { text } = reachabilityPhrase(outcome.reachability, {
        nowMs: Date.now(),
        mateName: "This Mate",
      });
      return {
        _tag: "Failed",
        error: `Could not connect to this container. ${text ?? ""}`.trim(),
      };
    }
  }
}
