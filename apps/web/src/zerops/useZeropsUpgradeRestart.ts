/**
 * The upgrade restart: one explicit restart of a container whose Mate is too old, recorded as an
 * `upgrade-restart` intent, so its container shows restarting(you) until a read fact proves it
 * back (DESIGN §4.5, C8). The version it comes back on then decides — a compatible one
 * reconnects, a healthy old one is not success. The container store does the reading; this hook
 * only says where the verb stands.
 *
 * This door uses the verified platform inventory, so it also works before a Mate connection.
 */
import { mateServerCompatibility } from "@t3tools/client-runtime/zerops/serverCompatibility";
import {
  CAPABILITY_WAIT_MS,
  grantCapabilities,
  ZeropsServiceId,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import {
  findInventoryProjectRef,
  inventoryCandidates,
  useZeropsInventory,
} from "./inventoryContext";
import { intendContainer, useTargetContainer } from "./zeropsContainers";
import { runZeropsCommand, useZeropsData } from "./zeropsDataContext";

export interface UpgradeRecovery {
  readonly serverVersion?: string;
  readonly state: "idle" | "confirm" | "waiting" | "failed";
  readonly error: string | null;
  readonly request: () => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

const NOT_VERIFIED =
  "Project access could not be verified. Refresh your projects before restarting.";

export function useZeropsUpgradeRestart(
  origin: string | null,
  reconnect: () => void,
): UpgradeRecovery | null {
  const { runtime } = useZeropsData();
  const capabilities = useMemo(() => grantCapabilities(runtime.access), [runtime]);
  const inventory = useZeropsInventory();
  const [state, setState] = useState<UpgradeRecovery["state"]>("idle");
  const [error, setError] = useState<string | null>(null);
  /** The restart this hook is waiting on is ours to follow: the intent landed on its container. */
  const [following, setFollowing] = useState(false);
  const alive = useRef<(() => boolean) | null>(null);
  const reconnectRef = useRef(reconnect);
  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);
  useEffect(() => {
    alive.current = null;
    setState("idle");
    setError(null);
    setFollowing(false);
    return onAccountLifetimeClose(() => {
      alive.current = null;
    });
  }, [origin]);
  const candidate =
    origin === null
      ? undefined
      : inventoryCandidates(inventory).find(
          (entry) =>
            entry.containerOrigin &&
            normalizeOrigin(entry.containerOrigin) === normalizeOrigin(origin),
        );
  const container = useTargetContainer(candidate?.key ?? null);

  // The container decides when the restart is over; the version it answers on decides the rest.
  const level = container.verdict.level;
  const overdue = "overdue" in container.verdict && container.verdict.overdue;
  const serverVersion = container.serverVersion;
  useEffect(() => {
    if (!following || state !== "waiting") return;
    if (level === "ready" && serverVersion !== undefined) {
      setFollowing(false);
      if (mateServerCompatibility(serverVersion) === "too-old") {
        setState("failed");
        setError(
          "The container still runs an incompatible Mate version. A compatible release may not be available through zcp yet. Check the connection again after it is released.",
        );
        return;
      }
      setState("idle");
      reconnectRef.current();
      return;
    }
    if (overdue) {
      setFollowing(false);
      setState("failed");
      setError(
        "The container has not come back yet. Check it in Zerops, then try connecting again.",
      );
    }
  }, [following, level, overdue, serverVersion, state]);

  if (!origin) return null;
  return {
    state,
    error,
    ...(serverVersion ? { serverVersion } : {}),
    request: () => {
      if (state !== "waiting") setState("confirm");
    },
    cancel: () => {
      if (state !== "waiting") setState("idle");
    },
    confirm: () => {
      if (state !== "confirm") return;
      if (!candidate?.service?.id || inventory.error) {
        setError(NOT_VERIFIED);
        setState("failed");
        return;
      }
      const project = findInventoryProjectRef(inventory, candidate.project.id);
      if (project === null) {
        setError(NOT_VERIFIED);
        setState("failed");
        return;
      }
      const isCurrent = captureAccountLifetime();
      alive.current = isCurrent;
      const key = candidate.key;
      setState("waiting");
      setError(null);
      const service = {
        kind: "service" as const,
        project,
        serviceId: ZeropsServiceId.make(candidate.service.id),
      };
      void Effect.runPromise(
        capabilities.await(
          { kind: "platformWrite", project: project.projectId },
          { withinMs: CAPABILITY_WAIT_MS },
        ),
      )
        .then(() => runZeropsCommand(runtime.commands.restartService(service)))
        .then(() => {
          if (alive.current !== isCurrent || !isCurrent()) return;
          if (intendContainer(key, { kind: "upgrade-restart" })) {
            setFollowing(true);
            return;
          }
          setState("failed");
          setError(
            "The container has not come back yet. Check it in Zerops, then try connecting again.",
          );
        })
        .catch((cause: unknown) => {
          if (alive.current !== isCurrent || !isCurrent()) return;
          setState("failed");
          setError(zeropsErrorMessage(cause));
        });
    },
  };
}
