/**
 * The account's build logs, made beside its store and ended with it: on the account lifetime's
 * close (sign-out, another account), and when the mount lets them go; `null` until made.
 */
import {
  makeAccountBuildLogs,
  makeBuildLogTransport,
  type AccountStore,
  type BuildLogRegistry,
} from "@t3tools/client-runtime/data";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { onAccountLifetimeClose } from "./accountLifetime";

export function useAccountBuildLogs(
  client: Pick<ZeropsApiClient, "fetchProjectLogAccess">,
  store: AccountStore,
): BuildLogRegistry | null {
  const [logs, setLogs] = useState<BuildLogRegistry | null>(null);
  // Made in the effect that ends them: a mount React runs twice (StrictMode) ends the first and
  // makes a second, never reading logs it already ended.
  useEffect(() => {
    const made = makeAccountBuildLogs({ store, transport: makeBuildLogTransport({ client }) });
    setLogs(made);
    const stopOnClose = onAccountLifetimeClose(made.shutdown);
    return () => {
      stopOnClose();
      made.shutdown();
    };
  }, [client, store]);
  return logs;
}
