/**
 * An application's environment operations at HQ: the starts that add a stage or a production
 * (`environment`) or set up an attached environment's deploy key (`deploy_key`), each one request
 * on the person's token with a fresh id, and the operation HQ's navigation shows on the
 * application, to every device. Nothing of the setup runs in this tab.
 */
import { useAtomValue } from "@effect/atom-react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqEnvironmentStart, HqOperation } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { hqNavigationAtom } from "~/state/zerops";

import { useAccountOperationsOptional } from "./accountOperations";
import { accountHqApi, configuredHq } from "./accountHq";
import { keyRenewalOf, type KeyRenewal } from "./renewDeployKey.logic";
import { useProjectCapabilities } from "./usePlatformCapabilities";
import { writeTrouble } from "./zeropsWrite";
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

export interface DeployKeyRenewal {
  readonly run: KeyRenewal;
  /**
   * Renews the key, or continues the renewal waiting for this person's fresh sign-in; absent for a
   * person without admin access to the project, while another person's renewal waits for them,
   * and while the environment is not known.
   */
  readonly onRenew: (() => void) | undefined;
  /** Forgets how this surface's last renewal ended. */
  readonly reset: () => void;
}

/**
 * An environment's deploy key renewed from where its trouble is said: one `deploy_key` start, and
 * how it stands from the operation HQ's navigation shows on the application, to every device. One
 * hook for every surface that offers it, so each says the same.
 */
export function useDeployKeyRenewal(
  environment:
    | {
        /** The application whose environment it is. */
        readonly appId: string;
        /** The environment's Zerops project, whose admins may renew its key. */
        readonly projectId: string;
        /** Its name, as HQ names it. */
        readonly name: string;
      }
    | undefined,
): DeployKeyRenewal {
  const { activeOrganization, user } = useZeropsSession();
  const operations = useAccountOperationsOptional();
  const { startDeployKey, operation } = useEnvironmentOperation(environment?.appId);
  const access = useProjectCapabilities(environment?.projectId);
  const standing = hqOperationOf(operation, "deploy_key", user?.id);
  // The start this surface made: refused, its id once HQ answered it, and whether HQ showed it.
  const [asked, setAsked] = useState<
    | { readonly refused: string }
    | { readonly id?: string; readonly seen?: true; readonly ended?: true }
    | undefined
  >(undefined);
  useEffect(() => {
    if (asked === undefined || "refused" in asked || asked.id === undefined || asked.ended) return;
    const shown = operation?.id === asked.id;
    if (shown && asked.seen !== true) setAsked({ ...asked, seen: true });
    // Gone from the application: it ended done. Ended failed, HQ shows it with its failure.
    else if (!shown && asked.seen === true) setAsked({ ...asked, ended: true });
  }, [asked, operation?.id]);

  const run = keyRenewalOf(
    standing,
    asked === undefined
      ? undefined
      : "refused" in asked
        ? asked
        : asked.ended === true
          ? "ended"
          : asked.seen === true
            ? undefined
            : "pending",
  );
  const orgId = activeOrganization?.id;
  const continueRenewal =
    standing.kind === "waiting" &&
    standing.yours &&
    environment !== undefined &&
    operations !== null &&
    orgId !== undefined
      ? () => {
          void operations
            .submit({
              kind: "continue-operation",
              orgId,
              id: standing.id,
              appId: environment.appId,
            })
            .then(({ progress, evidence }) => {
              const said = writeTrouble(progress, evidence);
              if (said !== null) setAsked({ refused: said });
            });
        }
      : undefined;
  const renew =
    environment === undefined ||
    standing.kind === "waiting" ||
    (access.projectAccessKnown && !access.administer)
      ? undefined
      : () => {
          if (run.kind === "working") return;
          setAsked({});
          startDeployKey(environment.name).then(
            (id) => setAsked({ id }),
            (cause: unknown) => setAsked({ refused: zeropsErrorMessage(cause) }),
          );
        };
  return {
    run,
    onRenew: continueRenewal ?? renew,
    reset: () => setAsked(undefined),
  };
}
