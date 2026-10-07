/**
 * The upgrade restart: one explicit restart of a container whose Mate is too old, recorded as an
 * `upgrade-restart` intent, so its container shows restarting(you) until a read fact proves it
 * back (DESIGN §4.5, C8). The version it comes back on then decides — a compatible one
 * reconnects, a healthy old one is not success. The container store does the reading; this hook
 * only says where the verb stands.
 *
 * The restart is the account's `mate-restart` operation, restarting the container as it is.
 *
 * This door uses the verified platform inventory, so it also works before a Mate connection.
 */
import { mateUpgradeRecovery, type MateUpgradeRecovery } from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOperations } from "./accountOperations";
import { useInventoryCandidates, useZeropsInventory } from "./inventoryContext";
import { useAccountData, useProjection } from "./ZeropsAccountData";
import { intendContainer, readContainerInitAt, useTargetContainer } from "./zeropsContainers";

export interface UpgradeRecovery {
  readonly serverVersion?: string;
  readonly state: "idle" | "confirm" | "waiting" | "failed" | "unresolved";
  readonly error: string | null;
  readonly request: () => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

type RestartReference = {
  readonly requestId: string;
  readonly targetKey: string;
  readonly previousInitAt: string | null;
};
// Only our operation identity and its boot reference; all outcomes are read from the account store.
const requested = new WeakMap<object, Map<string, RestartReference>>();
const referenceKey = (orgId: string | null, origin: string) => JSON.stringify([orgId, origin]);
const WAITING = Atom.make<MateUpgradeRecovery>({ state: "waiting" });
const NOT_VERIFIED =
  "Project access could not be verified. Refresh your projects before restarting.";

export function useMateUpgradeRecovery(
  origin: string | null,
  reconnect: () => void,
): UpgradeRecovery | null {
  const operations = useAccountOperations();
  const { orgId, data } = useAccountData();
  const inventory = useZeropsInventory();
  const candidates = useInventoryCandidates();
  const [state, setState] = useState<UpgradeRecovery["state"]>("idle");
  const [error, setError] = useState<string | null>(null);
  /** The restart this hook is waiting on is ours to follow: the intent landed on its container. */
  const [following, setFollowing] = useState<RestartReference | null>(() =>
    origin === null ? null : (requested.get(data)?.get(referenceKey(orgId, origin)) ?? null),
  );
  const alive = useRef<(() => boolean) | null>(null);
  const reconnectRef = useRef(reconnect);
  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);
  useEffect(() => {
    alive.current = null;
    setState("idle");
    setError(null);
    setFollowing(
      origin === null ? null : (requested.get(data)?.get(referenceKey(orgId, origin)) ?? null),
    );
    return onAccountLifetimeClose(() => {
      alive.current = null;
    });
  }, [data, orgId, origin]);
  const candidate =
    origin === null
      ? undefined
      : candidates.find(
          (entry) =>
            entry.containerOrigin &&
            normalizeOrigin(entry.containerOrigin) === normalizeOrigin(origin),
        );
  const container = useTargetContainer(candidate?.key ?? null);

  const serverVersion = container.serverVersion;
  const recovery = useProjection(mateUpgradeRecovery, following, WAITING);
  useEffect(() => {
    if (following === null || recovery.state !== "ready") return;
    if (origin !== null) requested.get(data)?.delete(referenceKey(orgId, origin));
    setFollowing(null);
    setState("idle");
    reconnectRef.current();
  }, [data, following, orgId, origin, recovery]);
  const visibleState =
    state === "confirm"
      ? "confirm"
      : following === null || recovery.state === "ready"
        ? state
        : recovery.state;
  const visibleError =
    following !== null && (recovery.state === "failed" || recovery.state === "unresolved")
      ? recovery.reason
      : error;

  if (!origin) return null;
  return {
    state: visibleState,
    error: visibleError,
    ...(serverVersion ? { serverVersion } : {}),
    request: () => {
      if (visibleState !== "waiting") setState("confirm");
    },
    cancel: () => {
      if (visibleState !== "waiting") setState("idle");
    },
    confirm: () => {
      if (state !== "confirm") return;
      if (!candidate?.service?.id || inventory.error || orgId === null) {
        setError(NOT_VERIFIED);
        setState("failed");
        return;
      }
      const isCurrent = captureAccountLifetime();
      alive.current = isCurrent;
      const key = candidate.key;
      setState("waiting");
      setFollowing(null);
      setError(null);
      const restart = {
        kind: "mate-restart",
        orgId,
        projectId: candidate.project.id,
        serviceId: candidate.service.id,
        way: "restart",
      } as const;
      // The container's initAt is read before the verb: the restart is over once it moves.
      void readContainerInitAt(key)
        .then(async (initAt) => {
          if (alive.current !== isCurrent || !isCurrent()) return;
          const { requestId, progress } = await operations.submit(restart);
          if (alive.current !== isCurrent || !isCurrent()) return;
          if (
            progress.stage === "accepted" ||
            progress.stage === "reflected" ||
            (progress.stage === "done" && progress.outcome === "succeeded")
          )
            intendContainer(key, { kind: "upgrade-restart", initAt });
          const reference = { requestId, targetKey: key, previousInitAt: initAt };
          let own = requested.get(data);
          if (own === undefined) {
            own = new Map();
            requested.set(data, own);
          }
          own.set(referenceKey(orgId, origin), reference);
          setFollowing(reference);
        })
        .catch((cause: unknown) => {
          if (alive.current !== isCurrent || !isCurrent()) return;
          setState("failed");
          setError(zeropsErrorMessage(cause));
        });
    },
  };
}
