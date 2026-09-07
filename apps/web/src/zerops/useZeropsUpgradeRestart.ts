import { mateServerCompatibility } from "@t3tools/client-runtime/zerops/serverCompatibility";
import { useEffect, useRef, useState } from "react";
import {
  deriveZeropsCandidates,
  normalizeOrigin,
  zeropsMateBaseUrl,
} from "@t3tools/client-runtime/zerops/candidates";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  accountActionsAllowed,
  captureAccountLifetime,
  onAccountLifetimeClose,
} from "./accountLifetime";
import { useZeropsInventory } from "./inventoryContext";
import { useZeropsSession } from "./sessionContext";
import { refreshZeropsCandidates } from "./candidatesRefresh";
import { restartAndVerifyMate } from "./upgradeRestart";

export interface UpgradeRecovery {
  readonly serverVersion?: string;
  readonly state: "idle" | "confirm" | "waiting" | "failed";
  readonly error: string | null;
  readonly request: () => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

/** This door uses the verified platform inventory, so it also works before a Mate connection. */
export function useZeropsUpgradeRestart(
  origin: string | null,
  reconnect: () => void,
): UpgradeRecovery | null {
  const { client } = useZeropsSession();
  const inventory = useZeropsInventory();
  const [state, setState] = useState<UpgradeRecovery["state"]>("idle");
  const [serverVersion, setServerVersion] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const reconnectRef = useRef(reconnect);
  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);
  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setState("idle");
    setError(null);
    setServerVersion(undefined);
    const close = () => active.current?.abort();
    const unsubscribe = onAccountLifetimeClose(close);
    return () => {
      close();
      unsubscribe();
    };
  }, [origin]);
  const candidate =
    origin === null
      ? undefined
      : inventory.projects
          .flatMap((project) => {
            const services = inventory.services.get(project.id);
            return deriveZeropsCandidates(
              project,
              services?.status === "resolved" ? services.services : null,
              new Map(),
            );
          })
          .find(
            (entry) =>
              entry.containerOrigin &&
              normalizeOrigin(entry.containerOrigin) === normalizeOrigin(origin),
          );
  if (!origin) return null;
  return {
    state,
    error,
    ...(serverVersion ? { serverVersion } : {}),
    request: () => {
      if (!active.current) setState("confirm");
    },
    cancel: () => {
      if (!active.current) setState("idle");
    },
    confirm: () => {
      if (active.current || state !== "confirm") return;
      if (!candidate?.service?.id || inventory.error || !accountActionsAllowed()) {
        setError("Project access could not be verified. Refresh your projects before restarting.");
        setState("failed");
        return;
      }
      const controller = new AbortController();
      active.current = controller;
      const alive = captureAccountLifetime();
      const isCurrent = () => alive() && !controller.signal.aborted;
      setState("waiting");
      setError(null);
      void restartAndVerifyMate({
        restart: () => client.restartService(candidate.service!.id),
        isCurrent,
        wait: () =>
          new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(finish, 2000);
            controller.signal.addEventListener("abort", finish, { once: true });
          }),
        probe: async () => {
          try {
            const response = await fetch(
              `${zeropsMateBaseUrl(origin)}/.well-known/t3/environment`,
              {
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
                cache: "no-store",
              },
            );
            if (!response.ok) return "unreachable";
            const descriptor: unknown = await response.json();
            if (
              typeof descriptor !== "object" ||
              descriptor === null ||
              !("environmentId" in descriptor) ||
              typeof descriptor.environmentId !== "string" ||
              !("serverVersion" in descriptor) ||
              typeof descriptor.serverVersion !== "string"
            )
              return "unreachable";
            if (isCurrent()) setServerVersion(descriptor.serverVersion);
            return mateServerCompatibility(descriptor.serverVersion) === "too-old"
              ? "incompatible"
              : "compatible";
          } catch {
            return "unreachable";
          }
        },
      })
        .then((result) => {
          if (!isCurrent()) return;
          refreshZeropsCandidates();
          if (result === "compatible") {
            reconnectRef.current();
            return;
          }
          setState("failed");
          setError(
            result === "incompatible"
              ? "The container still runs an incompatible Mate version. A compatible release may not be available through zcp yet. Check the connection again after it is released."
              : "The container has not come back yet. Check it in Zerops, then try connecting again.",
          );
        })
        .catch((cause: unknown) => {
          if (!isCurrent()) return;
          setState("failed");
          setError(zeropsErrorMessage(cause));
        })
        .finally(() => {
          if (active.current === controller) active.current = null;
        });
    },
  };
}
