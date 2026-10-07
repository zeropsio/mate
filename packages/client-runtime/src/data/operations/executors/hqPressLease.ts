import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Fiber from "effect/Fiber";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";

/** HQ lease protocol policy; renewal never decides operation settlement. */
export const PRESS_RENEW_MS = 60_000;

/** The least time between two renewals a press's steps ask for: its steps move far more often. */
export const PRESS_STEP_RENEW_MS = 20_000;

/**
 * A press's hold at its organization's HQ (`PUT /api/presses/{projectId}`, B5): what another
 * browser reads to tell a press still running — however slow — from one whose tab closed, and what
 * keeps two presses from writing one project twice. Taken once the press's project is known,
 * renewed every {@link PRESS_RENEW_MS} and at each of its steps while it runs, given its container
 * import's process once Zerops answered it, and ended at its end: a press that finished leaves no
 * record, one that stopped keeps it for its setup to be finished for its kind. A hold HQ does not
 * answer is not the press's to wait on: it goes on, renewing; only HQ's refusal for another
 * browser's press stops it. One HQ refuses this person outright leaves the press unheld, never
 * asked again.
 */
export interface PressHold {
  /** Holds the press of `projectId`: `elsewhere` where another browser's press holds it. */
  readonly take: (projectId: string) => Promise<"held" | "elsewhere">;
  /**
   * Renews the hold now — a step of the press moved — unless it was renewed within
   * {@link PRESS_STEP_RENEW_MS}.
   */
  readonly renew: () => void;
  /** Names the container import's Zerops process the press is followed by from now on. */
  readonly imported: (processId: string) => Promise<void>;
  /** Ends the hold at the press's end: whether it `finished`, or stopped. */
  readonly end: (finished: boolean) => Promise<void>;
}

export function acquireHqPressLease(
  api: Pick<HqApi, "holdPress" | "endPress"> | null,
  press: {
    readonly kind: "mate" | "stage" | "production";
    readonly appId?: string | undefined;
    readonly active?: () => boolean;
  },
  owner: string,
): PressHold {
  let projectId: string | null = null;
  let importProcessId: string | undefined;
  let renewal: Fiber.Fiber<void> | null = null;
  let heldAt = Number.NEGATIVE_INFINITY;
  // Whether HQ answered a hold of this press: from then on each hold only renews its own live
  // hold, so one landing after the press's end changes nothing there.
  let taken = false;
  // Every hold sent, one after another: the end waits for the last to land.
  let sending: Promise<void> = Promise.resolve();
  const hold = (): Promise<void> => {
    const held = projectId;
    if (api === null || held === null || press.active?.() === false) return Promise.resolve();
    heldAt = Effect.runSync(Clock.currentTimeMillis);
    const body = {
      owner,
      kind: press.kind,
      ...(press.appId === undefined ? {} : { appId: press.appId }),
      ...(importProcessId === undefined ? {} : { importProcessId }),
    };
    const sent = sending.then(async () => {
      // The press ended while this waited its turn: nothing is held any more.
      if (projectId !== held || press.active?.() === false) return;
      await api.holdPress(held, taken ? { ...body, renew: true } : body);
      taken = true;
    });
    // The next waits for this one to land, however it lands; its caller hears how.
    sending = Promise.allSettled([sent]).then(() => undefined);
    return sent;
  };
  const renewNow = () => {
    hold().catch(() => undefined);
  };
  const renew = () => {
    if (Effect.runSync(Clock.currentTimeMillis) - heldAt >= PRESS_STEP_RENEW_MS) renewNow();
  };
  return {
    take: async (pressed) => {
      projectId = pressed;
      try {
        await hold();
      } catch (cause) {
        if (cause instanceof HqError && cause.reason === "press_held") return "elsewhere";
        // HQ's refusal of this person's hold is definitive: the press goes on unheld, and is
        // never asked again. One HQ did not answer is renewed as the press runs.
        if (cause instanceof HqError && cause.kind === "refused") {
          projectId = null;
          return "held";
        }
      }
      if (api !== null && renewal === null)
        renewal = Effect.runFork(
          Effect.gen(function* () {
            while (true) {
              yield* Effect.sleep(PRESS_RENEW_MS);
              yield* Effect.promise(() => hold().catch(() => undefined));
            }
          }),
        );
      return "held";
    },
    renew,
    imported: async (processId) => {
      importProcessId = processId;
      await hold().catch(() => undefined);
    },
    end: async (finished) => {
      if (renewal !== null) await Effect.runPromise(Fiber.interrupt(renewal));
      renewal = null;
      const held = projectId;
      projectId = null;
      importProcessId = undefined;
      if (api === null || held === null || press.active?.() === false) return;
      // A renewal in flight lands first: the end is always the last word HQ hears of this press.
      await sending;
      if (press.active?.() === false) return;
      try {
        await api.endPress(held, owner, finished);
      } catch {
        // A hold HQ did not end runs out on its own: it is the press's lease.
      }
    },
  };
}
