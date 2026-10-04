/**
 * A Mate's setup, read off its own `/mate/setup.json` (`mateSetup.ts`) while its view shows it
 * coming up: the same answer in any browser, and whether a browser watches or not. Read every few
 * seconds while there is something left to happen, and no more once its Git access, its runtimes
 * and its stand-up have settled.
 *
 * `undefined` while nothing readable came back — not asked yet, on its way up, or an older Mate
 * whose server has no such route: the caller then reads the container's health, as it always
 * did (`/mate/healthz`).
 */
import { readMateSetup, type MateSetup } from "@t3tools/client-runtime/zerops/mateSetup";
import { useCallback, useSyncExternalStore } from "react";
import { onAccountLifetimeClose } from "./accountLifetime";

/** How often a Mate's setup is read while something in it is still to happen. */
export const MATE_SETUP_POLL_MS = 4_000;

/**
 * Nothing more will change: the Git access granted — one on its way, or failed, comes or heals
 * (HQ set up, the Mate's setup finished) — and the runtimes and the stand-up settled.
 */
export function mateSetupSettled(setup: MateSetup): boolean {
  const runtimes = setup.runtimes;
  const standup = setup.standup;
  return (
    (setup.git === undefined || setup.git === "done") &&
    (runtimes === "none" ||
      runtimes === "done" ||
      runtimes === "failed" ||
      runtimes === "unknown") &&
    (standup === "none" || standup === "done" || standup === "failed")
  );
}

interface SetupObservation {
  readonly origin: string;
  readonly listeners: Set<() => void>;
  setup: MateSetup | undefined;
  controller: AbortController | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  inFlight: boolean;
  dirty: boolean;
}
const observations = new Map<string, SetupObservation>();
function observation(origin: string): SetupObservation {
  let held = observations.get(origin);
  if (held === undefined) {
    held = {
      origin,
      listeners: new Set(),
      setup: undefined,
      controller: undefined,
      timer: undefined,
      inFlight: false,
      dirty: false,
    };
    observations.set(origin, held);
  }
  return held;
}

async function ask(held: SetupObservation): Promise<void> {
  if (held.inFlight || held.listeners.size === 0) return;
  const controller = held.controller ?? new AbortController();
  held.controller = controller;
  held.inFlight = true;
  const reading = await readMateSetup(held.origin, undefined, controller.signal);
  if (controller.signal.aborted || held.controller !== controller) return;
  held.inFlight = false;
  if (reading.kind === "setup") {
    held.setup = reading.setup;
    for (const listener of held.listeners) listener();
  }
  if (held.dirty) {
    held.dirty = false;
    void ask(held);
  } else if (
    reading.kind !== "absent" &&
    !(reading.kind === "setup" && mateSetupSettled(reading.setup))
  ) {
    held.timer = setTimeout(() => {
      held.timer = undefined;
      void ask(held);
    }, MATE_SETUP_POLL_MS);
  }
}

/** Re-read after an explicit action. Never clears the last answer. */
export function refreshMateSetup(origin: string): void {
  const held = observations.get(origin);
  if (held === undefined) return;
  if (held.timer !== undefined) clearTimeout(held.timer);
  held.timer = undefined;
  if (held.inFlight) held.dirty = true;
  else void ask(held);
}

function stop(held: SetupObservation): void {
  held.controller?.abort();
  held.controller = undefined;
  held.inFlight = false;
  held.dirty = false;
  if (held.timer !== undefined) clearTimeout(held.timer);
  held.timer = undefined;
}

export function useMateSetup(origin: string | undefined): MateSetup | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (origin === undefined) return () => undefined;
      const held = observation(origin);
      held.listeners.add(listener);
      if (held.listeners.size === 1) void ask(held);
      return () => {
        held.listeners.delete(listener);
        if (held.listeners.size === 0) stop(held);
      };
    },
    [origin],
  );
  const snapshot = useCallback(
    () => (origin === undefined ? undefined : observations.get(origin)?.setup),
    [origin],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

onAccountLifetimeClose(() => {
  for (const held of observations.values()) stop(held);
  observations.clear();
});
