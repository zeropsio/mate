/**
 * The account's personal context as mobile hands it to the account runtime (DESIGN §7.5): its
 * container intents in memory, and HQ, which the device does not run. Plain values, no React
 * Native.
 */
import type { AccountEnvironmentPorts } from "@t3tools/client-runtime/zerops/account/runtime";

/** The account's container intents (C8), kept for as long as the app runs. */
export function memoryIntents(): AccountEnvironmentPorts["intents"] {
  let held: string | null = null;
  return {
    read: () => held,
    write: (value) => {
      held = value;
    },
  };
}

/**
 * HQ as the device sees it: absent. The device runs no HQ flow, so HQ will not answer here — no
 * environment's project named, no close-off said.
 */
export function hqAbsent(): Pick<AccountEnvironmentPorts, "hqIndex" | "closeOff"> {
  const quiet = () => () => undefined;
  return {
    hqIndex: { projectOf: () => null, subscribe: quiet },
    closeOff: { read: () => null, subscribe: quiet },
  };
}
