/**
 * The close-off gate on the phone (security review 3). The phone holds no HQ word, and its Zerops
 * store carries no project's isolation, so a Mate's project is read once as the person opens it —
 * an explicit action, never idle traffic: its `envIsolation`, and where that is not `service`, the
 * press's marker on its container (`MATE_SETUP_RUNTIMES`). A marked Mate on a project not closed
 * off is held — told to the account's environments as a project this device knows is not closed
 * off (`closeOffPending`) — and says why. No fact, no hold: an isolation unknown or unreadable,
 * or a marker that could not be read, lets it in.
 */

/** Why a held Mate does not open on the phone. */
export const CLOSE_OFF_STOPPED_LINE =
  "Its setup stopped before its project was closed off. Finish setup on the web closes it off.";

/** The isolation that closes a project off (`projectIsolation.ts`). */
const CLOSED_OFF_ISOLATION = "service";

/** The projects this device knows are not closed off, as the account's environments read them. */
export interface CloseOffFacts {
  readonly read: () => ReadonlySet<string>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly hold: (projectId: string, held: boolean) => void;
}

export function makeCloseOffFacts(): CloseOffFacts {
  let held: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    read: () => held,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hold: (projectId, hold) => {
      if (held.has(projectId) === hold) return;
      const next = new Set(held);
      if (hold) next.add(projectId);
      else next.delete(projectId);
      held = next;
      for (const listener of listeners) listener();
    },
  };
}

/** This device's facts, for its one account's environments (`environment-ports.ts`). */
export const closeOffFacts = makeCloseOffFacts();

/**
 * The Mate's close-off, read once as the person opens it: `held` where its project is not closed
 * off and its container carries the press's marker; `clear` on anything else, read or not.
 */
export async function checkCloseOff(
  facts: CloseOffFacts,
  input: {
    readonly projectId: string;
    /** The project's `envIsolation`; undefined where its env does not say. */
    readonly readIsolation: () => Promise<string | undefined>;
    /** Whether the Mate's container carries the press's marker. */
    readonly readMarker: () => Promise<boolean>;
  },
): Promise<"held" | "clear"> {
  const known = async <T>(read: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await read();
    } catch {
      return undefined;
    }
  };
  const isolation = await known(input.readIsolation);
  const held =
    isolation !== undefined &&
    isolation !== CLOSED_OFF_ISOLATION &&
    (await known(input.readMarker)) === true;
  facts.hold(input.projectId, held);
  return held ? "held" : "clear";
}
