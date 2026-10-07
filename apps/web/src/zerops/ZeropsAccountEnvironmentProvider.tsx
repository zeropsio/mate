import { RegistryContext } from "@effect/atom-react";
import {
  makeAccountRuntime,
  type AccountRuntime,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type AccountScope,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ZeropsFrameWait } from "../components/zerops/landing/ZeropsLandingShell";
import { bindAccountEnvironments } from "./accountEnvironments";
import { bindAccountFlow } from "./accountForge";
import { bindAccountInvalidations } from "./accountInvalidations";
import { holdRegistryUntil } from "../rpc/atomRegistry";
import { currentAccountEpoch, onAccountLifetimeClose } from "./accountLifetime";
import { browserPlatformSignals } from "./browserSignals";
import { webEnvironmentPorts } from "./environmentPorts";
import { useAccountStoreForAdapters } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";

/** The verified session mounts the account's Mate adapter. Zerops has one transport, in AccountData. */
export function ZeropsAccountEnvironmentProvider({
  children,
  pending,
}: {
  readonly children: ReactNode;
  readonly pending?: ReactNode;
}) {
  const { client, status, user, activeOrganization, signOut } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const store = useAccountStoreForAdapters();
  const accountId = status === "signed-in" ? (user?.id ?? null) : null;
  const [opened, setOpened] = useState<{
    readonly scope: AccountScope;
    readonly account: AccountRuntime;
    readonly context: ZeropsDataContextValue;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{
    readonly accountId: string;
    readonly attempt: number;
    readonly message: string;
  } | null>(null);
  useEffect(() => {
    if (accountId === null || store === null) return;
    const scope: AccountScope = {
      account: {
        apiOrigin: makeZeropsApiOrigin(client.baseUrl),
        accountId: ZeropsAccountId.make(accountId),
      },
      epoch: AccountEpoch.make(currentAccountEpoch()),
    };
    const signals = browserPlatformSignals(document, window);
    let closed = false;
    let built: AccountRuntime | null = null;
    let finish: () => void = () => undefined;
    const teardown = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const stopHold = onAccountLifetimeClose(() => holdRegistryUntil(teardown));
    void teardown.then(stopHold);
    let closing: Promise<void> | null = null;
    const shutdown = (account: AccountRuntime) => {
      closing ??= Effect.runPromise(account.close("account-replaced")).finally(finish);
      return closing;
    };
    let unbind = () => undefined as void;
    const close = () => {
      if (closed) return;
      closed = true;
      unbind();
      if (built !== null) void shutdown(built);
    };
    const stopLifetime = onAccountLifetimeClose(close);
    void Effect.runPromise(
      makeAccountRuntime({
        account: scope,
        signals,
        atomRegistry: registry,
        environments: webEnvironmentPorts({ client, registry }),
        store,
      }),
    ).then(
      (account) => {
        built = account;
        if (closed) {
          void shutdown(account);
          return;
        }
        const releases = [
          bindAccountEnvironments(account.environments),
          bindAccountFlow(account),
          bindAccountInvalidations(account.invalidations),
        ];
        unbind = () => {
          for (const release of releases) release();
        };
        const organizationRef = (id: string) => ({
          kind: "organization" as const,
          account: scope.account,
          organizationId: ZeropsOrganizationId.make(id),
        });
        setOpened({
          scope,
          account,
          context: {
            scope,
            signals,
            organizationRef,
            projectRef: (orgId, id) => ({
              kind: "project",
              organization: organizationRef(orgId),
              projectId: ZeropsProjectId.make(id),
            }),
          },
        });
      },
      (cause: unknown) => {
        finish();
        if (!closed)
          setFailure({
            accountId,
            attempt,
            message: cause instanceof Error ? cause.message : "Could not start Zerops data.",
          });
      },
    );
    return () => {
      stopLifetime();
      close();
      setOpened(null);
    };
  }, [accountId, client, registry, store, attempt]);
  useEffect(() => {
    opened?.account.environments.setActiveOrganization(activeOrganization?.id ?? null);
  }, [opened, activeOrganization?.id]);
  const value = useMemo(
    () => (opened?.scope.account.accountId === accountId ? opened.context : null),
    [opened, accountId],
  );
  const startupError =
    failure?.accountId === accountId && failure.attempt === attempt ? failure.message : null;
  if (value === null)
    return (
      <>
        {pending}
        {startupError === null ? (
          <ZeropsFrameWait label="Starting Zerops data…" signedIn />
        ) : (
          <ZeropsDataStartupFailure
            message={startupError}
            retry={() => setAttempt((value) => value + 1)}
            signOut={() => void signOut()}
          />
        )}
      </>
    );
  return <ZeropsDataContext value={value}>{children}</ZeropsDataContext>;
}

export function ZeropsDataStartupFailure({
  message,
  retry,
  signOut,
}: {
  readonly message: string;
  readonly retry: () => void;
  readonly signOut: () => void;
}) {
  return (
    <div role="alert" className="p-8">
      Could not start Zerops data. {message}{" "}
      <button type="button" onClick={retry}>
        Try again
      </button>{" "}
      <button type="button" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}
