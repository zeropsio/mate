import { HqError, type HqApi } from "../../../zerops/hq/client.ts";

/**
 * A press's hold at its organization's HQ (`PUT /api/presses/{projectId}`, B5): what another
 * browser reads to tell a running press from one whose tab closed, and what keeps two presses from
 * writing one project twice. Taken once the press's project is known, taken again with its
 * container import's process once Zerops answered it, and ended at its end: a press that finished
 * leaves no record, one that stopped keeps it for its setup to be finished for its kind. The hold
 * lives with its organization's HQ stream, which the press keeps open while it holds (`keep`): it
 * sends HQ nothing else to keep it. A stream that stays away past HQ's grace loses it: the press
 * lapsed, and writes nothing more. A hold HQ does not answer is not the press's to wait on: it goes
 * on; only HQ's refusal for another browser's press stops it. One HQ refuses this person outright
 * leaves the press unheld, never asked again.
 */
export interface PressHold {
  /** Holds the press of `projectId`: `elsewhere` where another browser's press holds it. */
  readonly take: (projectId: string) => Promise<"held" | "elsewhere">;
  /** Records the import's process, or says HQ refused it or no write was sent. An unknown answer throws. */
  readonly imported: (processId: string) => Promise<"recorded" | "refused" | "unsent">;
  /** Ends the hold at the press's end: whether it `finished`, or stopped. */
  readonly end: (finished: boolean) => Promise<void>;
  /**
   * The press's environment is registered in its application: HQ ends a stage's or a
   * production's hold with that registration — the press is over there — so it is let go here,
   * its stream kept no more while the press waits on its services. A Mate's hold goes on to its end.
   */
  readonly registered: () => void;
  /** HQ no longer holds this press's hold: its stream stayed away past HQ's grace, or another took it. */
  readonly lapsed: () => boolean;
}

/**
 * Keeps the press's organization's HQ stream open while it holds `projectId`, whichever
 * organization is shown, and calls `lapsed` once HQ holds it no more (`keepPress`); the release
 * lets the stream go.
 */
export type KeepPress = (projectId: string, lapsed: () => void) => () => void;

type HoldOutcome =
  | { readonly kind: "recorded" | "unsent" }
  | { readonly kind: "refused"; readonly reason: string | undefined };

export function acquireHqPressLease(
  api: Pick<HqApi, "holdPress" | "endPress"> | null,
  keep: KeepPress | null,
  press: {
    readonly kind: "mate" | "stage" | "production";
    readonly appId?: string | undefined;
    readonly active?: () => boolean;
  },
  owner: string,
): PressHold {
  let projectId: string | null = null;
  let importProcessId: string | undefined;
  let release: (() => void) | null = null;
  let lapsed = false;
  // Every hold sent, one after another: the end waits for the last to land.
  let sending: Promise<void> = Promise.resolve();
  // HQ holds this press no more: its stream is kept no more, and its end has nothing to end there.
  const letGo = () => {
    projectId = null;
    importProcessId = undefined;
    const kept = release;
    release = null;
    kept?.();
  };
  const lapse = () => {
    lapsed = true;
    letGo();
  };
  const hold = (): Promise<HoldOutcome> => {
    const held = projectId;
    if (api === null || held === null || press.active?.() === false)
      return Promise.resolve({ kind: "unsent" });
    const body = {
      owner,
      kind: press.kind,
      ...(press.appId === undefined ? {} : { appId: press.appId }),
      ...(importProcessId === undefined ? {} : { importProcessId }),
    };
    const sent = sending.then(async (): Promise<HoldOutcome> => {
      // The press ended while this waited its turn: nothing is held any more.
      if (projectId !== held || press.active?.() === false) return { kind: "unsent" };
      try {
        await api.holdPress(held, body);
        return { kind: "recorded" };
      } catch (cause) {
        if (cause instanceof HqError && cause.kind === "refused")
          return { kind: "refused", reason: cause.reason };
        throw cause;
      }
    });
    // The next waits for this one to land, however it lands; its caller hears how.
    sending = Promise.allSettled([sent]).then(() => undefined);
    return sent;
  };
  return {
    take: async (pressed) => {
      letGo();
      lapsed = false;
      projectId = pressed;
      // The stream the hold lives with is open before HQ is asked for it.
      if (api !== null && keep !== null) release = keep(pressed, lapse);
      try {
        const outcome = await hold();
        if (outcome.kind === "refused" && outcome.reason === "press_held") {
          letGo();
          return "elsewhere";
        }
        // HQ's refusal of this person's hold is definitive: the press goes on unheld, and is
        // never asked again. One HQ did not answer is asked again with its import.
        if (outcome.kind === "refused") {
          letGo();
          return "held";
        }
      } catch {
        // An unanswered hold may be asked again with its import.
      }
      return "held";
    },
    imported: async (processId) => {
      const held = projectId;
      importProcessId = processId;
      const outcome = await hold();
      // Another browser's press holds it now: this one's hold lapsed.
      if (outcome.kind === "refused" && outcome.reason === "press_held" && projectId === held)
        lapse();
      return outcome.kind;
    },
    end: async (finished) => {
      const held = projectId;
      letGo();
      if (api === null || held === null || press.active?.() === false) return;
      // A hold in flight lands first: the end is always the last word HQ hears of this press.
      await sending;
      if (press.active?.() === false) return;
      try {
        await api.endPress(held, owner, finished);
      } catch {
        // A hold HQ did not end goes with its stream: it is the press's lease.
      }
    },
    registered: () => {
      if (press.kind !== "mate") letGo();
    },
    lapsed: () => lapsed,
  };
}
