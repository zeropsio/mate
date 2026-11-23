/**
 * An application's environment operations at HQ: the starts that add a stage or a production
 * (`environment`) or set up an attached environment's deploy key (`deploy_key`), each one request
 * on the person's token with a fresh id, and the operation HQ's navigation shows on the
 * application, to every device. Nothing of the setup runs in this tab.
 */
import { useAtomValue } from "@effect/atom-react";
import type { HqEnvironmentStart, HqOperation } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";

import { randomUUID } from "~/lib/utils";
import { hqNavigationAtom } from "~/state/zerops";

import { accountHqApi, configuredHq } from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** The operation HQ's navigation shows on an application; absent where it shows none. */
const applicationOperationAtom = Atom.family((appId: string) =>
  Atom.make(
    (get) => get(hqNavigationAtom).structure?.apps.find((app) => app.id === appId)?.operation,
  ).pipe(Atom.withLabel(`zerops:environment-operation:${appId}`)),
);

const NO_APPLICATION = Atom.make<HqOperation | undefined>(undefined);

export interface EnvironmentStarts {
  /** Starts a stage's or a production's addition; answers the operation's id. */
  readonly startEnvironment: (
    appId: string,
    start: Omit<HqEnvironmentStart, "id">,
  ) => Promise<string>;
  /** Starts setting up the deploy key of the environment `name`; answers the operation's id. */
  readonly startDeployKey: (appId: string, name: string) => Promise<string>;
}

/** The account's environment starts, for whichever application a surface acts on. */
export function useEnvironmentStarts(): EnvironmentStarts {
  const { activeOrganization, client } = useZeropsSession();
  const orgId = activeOrganization?.id;
  const api = useCallback(() => {
    if (orgId === undefined) throw new Error("Open an organization to set this up.");
    return accountHqApi(client, orgId, configuredHq());
  }, [client, orgId]);
  return useMemo(
    () => ({
      startEnvironment: async (appId, start) => {
        const id = randomUUID();
        await api().startEnvironment(appId, { ...start, id });
        return id;
      },
      startDeployKey: async (appId, name) => {
        const id = randomUUID();
        await api().startDeployKey(appId, name, { id });
        return id;
      },
    }),
    [api],
  );
}

/** One application's starts and the operation HQ shows on it. */
export function useEnvironmentOperation(appId: string | undefined): {
  readonly startEnvironment: (start: Omit<HqEnvironmentStart, "id">) => Promise<string>;
  readonly startDeployKey: (name: string) => Promise<string>;
  readonly operation: HqOperation | undefined;
} {
  const starts = useEnvironmentStarts();
  const operation = useAtomValue(
    appId === undefined ? NO_APPLICATION : applicationOperationAtom(appId),
  );
  return useMemo(
    () => ({
      startEnvironment: (start) => {
        if (appId === undefined) return Promise.reject(new Error("No application to set up."));
        return starts.startEnvironment(appId, start);
      },
      startDeployKey: (name) => {
        if (appId === undefined) return Promise.reject(new Error("No application to set up."));
        return starts.startDeployKey(appId, name);
      },
      operation,
    }),
    [appId, operation, starts],
  );
}

/** Every application's operation as HQ's navigation shows it, by application id. */
export const applicationOperationsAtom = Atom.make((get) => {
  const operations = new Map<string, HqOperation>();
  const structure = get(hqNavigationAtom).structure;
  // Unread, HQ's structure shows no operation yet.
  if (structure == null) return operations;
  for (const app of structure.apps)
    if (app.operation !== undefined) operations.set(app.id, app.operation);
  return operations;
}).pipe(Atom.withLabel("zerops:application-operations"));
