/**
 * A Mate's setup, read off its own `/mate/setup.json` (`mateSetup.ts`) while its view shows it
 * coming up: the same answer in any browser, and whether a browser watches or not. Read every few
 * seconds while there is something left to happen, and no more once its runtimes and its
 * stand-up have settled.
 *
 * `undefined` while nothing readable came back — not asked yet, on its way up, or an older Mate
 * whose server has no such route: the caller then reads the container's health, as it always
 * did (`/mate/healthz`).
 */
import { readMateSetup, type MateSetup } from "@t3tools/client-runtime/zerops/mateSetup";
import { useEffect, useState } from "react";

/** How often a Mate's setup is read while something in it is still to happen. */
export const MATE_SETUP_POLL_MS = 4_000;

/** Nothing more will change without a person: the runtimes and the stand-up have settled. */
export function mateSetupSettled(setup: MateSetup): boolean {
  const runtimes = setup.runtimes;
  const standup = setup.standup;
  return (
    (runtimes === "none" ||
      runtimes === "done" ||
      runtimes === "failed" ||
      runtimes === "unknown") &&
    (standup === "none" || standup === "done" || standup === "failed")
  );
}

export function useMateSetup(origin: string | undefined): MateSetup | undefined {
  const [read, setRead] = useState<{ readonly origin: string; readonly setup: MateSetup } | null>(
    null,
  );
  useEffect(() => {
    if (origin === undefined) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const reading = await readMateSetup(origin, undefined, controller.signal);
      if (controller.signal.aborted) return;
      // An older Mate answers no setup: nothing is ever going to.
      if (reading.kind === "absent") return;
      if (reading.kind === "setup") {
        setRead({ origin, setup: reading.setup });
        if (mateSetupSettled(reading.setup)) return;
      }
      timer = setTimeout(() => void ask(), MATE_SETUP_POLL_MS);
    };
    void ask();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [origin]);
  return read !== null && read.origin === origin ? read.setup : undefined;
}
