import { reconcileInventoryProjects } from "./inventoryReconciliation";
// @effect-diagnostics cryptoRandomUUID:off -- browser websocket receiver identity
import { useEffect, useRef, useState, type ReactNode } from "react";
import { zeropsClientsFromUser } from "@t3tools/client-runtime/zerops";
import {
  loadZeropsCandidates,
  type ZeropsCandidateServiceOutcome,
} from "@t3tools/client-runtime/zerops/candidateLoading";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { openPlatformWatch } from "@t3tools/client-runtime/zerops/platformWatch";
import { ZeropsLandingWait } from "../components/zerops/landing/ZeropsLandingShell";
import { refreshZeropsCandidates, useZeropsCandidatesVersion } from "./candidatesRefresh";
import { useZeropsSession } from "./ZeropsSessionProvider";

import { setAccountActionsAllowed } from "./accountLifetime";

import { loadOperableProjects } from "./projectAccess";

import { InventoryContext, type Inventory } from "./inventoryContext";
export { useZeropsInventory } from "./inventoryContext";

/** A complete read is authoritative; a failed or truncated read cannot delete
 * an environment. One account inventory feeds every product surface. */
export function ZeropsInventoryProvider({ children }: { readonly children: ReactNode }) {
  const { client, organizations, updateVerifiedMemberships, signOut } = useZeropsSession();
  const version = useZeropsCandidatesVersion();
  const [snapshot, setSnapshot] = useState<Inventory>({
    projects: [],
    services: new Map(),
    isLoading: true,
    error: null,
  });
  const [ready, setReady] = useState(false);
  const [readWindowExpired, setReadWindowExpired] = useState(false);
  const lastVerifiedAt = useRef(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const isCancelled = () => generation.current !== current;
    const services = new Map<string, ZeropsCandidateServiceOutcome>();
    setSnapshot((previous) => ({ ...previous, isLoading: true, error: null }));
    void (async () => {
      const verified = await client.fetchUser();
      if (!isCancelled()) updateVerifiedMemberships(verified);
      const memberships = zeropsClientsFromUser(verified);
      return loadZeropsCandidates(
        {
          listProjectServices: (projectId) => client.listProjectServices(projectId),
          listAccessibleClientProjects: async (organizationId) => {
            const membership = memberships.find((entry) => entry.id === organizationId);
            return membership ? loadOperableProjects(client, membership) : [];
          },
        },
        {
          organizationIds: memberships.map((organization) => organization.id),
          connectedOrigins: new Map(),
          isCancelled,
          onServiceOutcome: (project, outcome) => {
            services.set(project.id, outcome);
          },
        },
      );
    })()
      .then((result) => {
        if (isCancelled()) return;
        const failedOrganizations = new Set(
          result.failures.map((failure) => failure.organizationId),
        );
        setSnapshot((previous) => {
          const projects = reconcileInventoryProjects(
            previous.projects,
            result.projects,
            failedOrganizations,
          );
          return {
            projects,
            services: new Map(
              projects.map((project) => {
                const outcome = services.get(project.id);
                return [
                  project.id,
                  outcome?.status === "resolved"
                    ? outcome
                    : (previous.services.get(project.id) ?? { status: "failed" }),
                ];
              }),
            ),
            isLoading: false,
            error: null,
          };
        });
        const servicesComplete =
          result.failures.length === 0 &&
          [...services.values()].every((outcome) => outcome.status === "resolved");
        if (servicesComplete) {
          lastVerifiedAt.current = Date.now();
          setReadWindowExpired(false);
        }
        setAccountActionsAllowed(servicesComplete);
        client.setWritesAllowed(servicesComplete);
        if (!servicesComplete)
          setSnapshot((previous) => ({
            ...previous,
            error: "Some project access or services could not be verified. Try again.",
          }));
        if (result.failures.length === 0) setReady(true);
      })
      .catch((cause: unknown) => {
        if (!isCancelled()) {
          setAccountActionsAllowed(false);
          client.setWritesAllowed(false);
          setSnapshot((previous) => ({
            ...previous,
            isLoading: false,
            error: zeropsErrorMessage(cause),
          }));
        }
      });
    return () => {
      generation.current += 1;
    };
  }, [client, organizations, updateVerifiedMemberships, version]);

  useEffect(() => {
    let pending: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible" || pending !== undefined) return;
      pending = window.setTimeout(() => {
        pending = undefined;
        refreshZeropsCandidates();
      }, 250);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    // Membership/project deletion is not guaranteed to produce a service push.
    const interval = window.setInterval(refresh, 60_000);
    const watches = organizations.map((organization) => {
      const watch = openPlatformWatch({
        client,
        orgId: organization.id,
        makeSocket: (url) => {
          const socket = new WebSocket(url);
          const adapter = {
            send: (data: string) => socket.send(data),
            close: () => socket.close(),
            onopen: null as (() => void) | null,
            onclose: null as (() => void) | null,
            onerror: null as ((event: unknown) => void) | null,
            onmessage: null as ((event: { data: string }) => void) | null,
          };
          socket.onopen = () => adapter.onopen?.();
          socket.onclose = () => adapter.onclose?.();
          socket.onerror = (event) => adapter.onerror?.(event);
          socket.onmessage = (event) => adapter.onmessage?.({ data: String(event.data) });
          return adapter;
        },
        makeReceiverId: () => crypto.randomUUID(),
        timers: {
          setTimer: (callback, delay) => window.setTimeout(callback, delay),
          clearTimer: (handle) => window.clearTimeout(handle as number),
        },
      });
      const unsubscribe = watch.events.subscribe((event) => {
        if (event.type !== "disconnected") refresh();
      });
      return () => {
        unsubscribe();
        watch.close();
      };
    });
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.clearInterval(interval);
      window.clearTimeout(pending);
      for (const close of watches) close();
    };
  }, [client, organizations]);

  useEffect(() => {
    if (!snapshot.error) return;
    const remaining = Math.max(0, lastVerifiedAt.current + 15 * 60_000 - Date.now());
    const timeout = window.setTimeout(() => setReadWindowExpired(true), remaining);
    return () => window.clearTimeout(timeout);
  }, [snapshot.error]);

  if (!ready || readWindowExpired) {
    if (snapshot.error)
      return (
        <div role="alert" className="p-8">
          Could not load your Zerops projects. {snapshot.error}{" "}
          <button type="button" onClick={refreshZeropsCandidates}>
            Try again
          </button>{" "}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      );
    return <ZeropsLandingWait label="Checking your Zerops projects…" />;
  }
  return (
    <InventoryContext value={snapshot}>
      {snapshot.error ? (
        <div role="alert" className="fixed inset-x-0 top-0 z-50 bg-background p-4">
          Project access could not be verified.{" "}
          <button type="button" onClick={refreshZeropsCandidates}>
            Try again
          </button>{" "}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      ) : null}
      <div inert={snapshot.error !== null} className="contents">
        {children}
      </div>
    </InventoryContext>
  );
}
