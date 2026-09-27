/**
 * CrewRuntime — Show on dev (ARCHITECTURE §5 *Show on dev*, CONCEPT §3.3):
 * one claim per dev service lets a crewmate's copy run on the service's own
 * dev server and URL, in place of the tree.
 *
 * A crewmate asks with `crew_show_on_dev`; the person grants; a short claim
 * turn in the holder's thread restarts the dev server from the copy, and a
 * release turn restarts it from the tree. Whether a turn did it is never
 * taken from the engine's own record: what dev serves is read from the
 * working directory of zcp's dev-server process (`servedFrom`), and that
 * reading moves the claim (`claimEventFromServed`, then `claimTransition`).
 *
 * The claim is one `crew_claim` row per host, moved in one store transaction
 * per event; `none` removes it. An event the claim's state does not take is
 * refused (`CrewClaimRefused`), never applied. zcp's dev server writes its
 * pid to {@link DEV_SERVER_PIDFILE}, and the pid is the dev command itself,
 * started in its `workDir`.
 *
 * @module CrewRuntime
 */
import type { CrewClaimState, CrewServed } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { type ClaimEvent, claimTransition } from "./crewMachines.ts";
import type { CrewToolText } from "./crewSeams.ts";
import {
  CrewShell,
  field,
  runFields,
  type CrewGitError,
  type CrewShellError,
} from "./CrewShell.ts";
import { type CrewClaimRow, CrewStore, type CrewStoreError } from "./CrewStore.ts";

/** zcp's dev-server pidfile: its default log file plus `.pid` (zcp `ops/dev_server.go`). */
export const DEV_SERVER_PIDFILE = "/tmp/zcp-dev-server.log.pid";

const SERVED_TIMEOUT = Duration.seconds(10);

/** A host's Show-on-dev claim: its state and its holder or requester. */
export interface CrewClaim {
  readonly state: CrewClaimState;
  readonly handle: string | null;
}

const DELETED_SUFFIX = " (deleted)";

const isWithin = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * What a dev service's dev server serves, from the working directory of its
 * process (`readlink /proc/<pid>/cwd`): the tree, a crewmate's copy under
 * `.crew/<handle>`, or — for no process, a deleted directory, a copy no
 * crewmate owns or anywhere else — unknown.
 */
export const servedFrom = (
  cwd: string | undefined,
  remoteRoot: string,
  handles: ReadonlyArray<string>,
): CrewServed => {
  if (cwd === undefined || cwd.endsWith(DELETED_SUFFIX) || !isWithin(cwd, remoteRoot)) {
    return { by: "unknown" };
  }
  const lanes = `${remoteRoot}/.crew`;
  if (!isWithin(cwd, lanes)) return { by: "tree" };
  const handle = cwd.slice(lanes.length + 1).split("/")[0];
  return handle !== undefined && handles.includes(handle)
    ? { by: "crewmate", handle }
    : { by: "unknown" };
};

/**
 * The claim event that what dev serves stands for, read after a claim or a
 * release turn, or at boot. Starting: the holder's copy means held, anything
 * else that the claim turn did not take. Held: dev no longer serving the
 * holder's copy means someone else restarted it, and the person wins.
 * Releasing: only the tree ends it; anything else means the release failed.
 */
export const claimEventFromServed = (
  state: CrewClaimState,
  served: CrewServed,
  holder: string,
): ClaimEvent | undefined => {
  const servesHolder = served.by === "crewmate" && served.handle === holder;
  switch (state) {
    case "starting":
      return servesHolder ? "serves-lane" : "serves-other";
    case "held":
      return servesHolder ? undefined : "person-dev-server";
    case "releasing":
      return served.by === "tree" ? "serves-tree" : "turn-failed";
    case "release-failed":
      return served.by === "tree" ? "serves-tree" : undefined;
    default:
      return undefined;
  }
};

/** The crewmate whose copy dev serves under a held claim; the gate's `holdsClaim`. */
export const holdsClaim = (claim: CrewClaim | undefined, handle: string): boolean =>
  claim?.state === "held" && claim.handle === handle;

export type ShowOnDevOutcome =
  | { readonly kind: "requested" }
  | { readonly kind: "pending" }
  | { readonly kind: "shown" }
  | { readonly kind: "busy"; readonly by: string }
  | { readonly kind: "releasing" }
  | { readonly kind: "no-lane" };

/**
 * `crew_show_on_dev` against the host's claim: one claim per dev service, so
 * a request waits for nobody — it is refused while another crewmate's work
 * is asked for, shown, or on its way back to the tree.
 */
export const claimRequest = (
  claim: CrewClaim | undefined,
  handle: string,
  hasLane: boolean,
): ShowOnDevOutcome => {
  if (!hasLane) return { kind: "no-lane" };
  const state = claim?.state ?? "none";
  if (state === "none") return { kind: "requested" };
  if (state === "releasing" || state === "release-failed") return { kind: "releasing" };
  if (claim?.handle !== handle) return { kind: "busy", by: claim?.handle ?? "" };
  return state === "held" ? { kind: "shown" } : { kind: "pending" };
};

export const showOnDevAnswer = (outcome: ShowOnDevOutcome, host: string): CrewToolText => {
  switch (outcome.kind) {
    case "requested":
      return {
        text: `Asked the person to show your copy on ${host}. If they grant it, a short turn in this conversation restarts ${host}'s dev server from your copy.`,
        isError: false,
      };
    case "pending":
      return {
        text: `Your request to show your copy on ${host} is already with the person.`,
        isError: false,
      };
    case "shown":
      return { text: `${host} already shows your copy.`, isError: false };
    case "busy":
      return {
        text: `${host} is taken by @${outcome.by}'s work; ask again once it is released.`,
        isError: true,
      };
    case "releasing":
      return {
        text: `${host}'s dev server is going back to the tree; ask again once it has.`,
        isError: true,
      };
    case "no-lane":
      return { text: "You have no copy of the code to show.", isError: true };
  }
};

/**
 * Prints the tree's real path, and the working directory of the dev server's
 * process when the pidfile names a live one. `/proc` on a dev service; `lsof`
 * where there is no `/proc`.
 */
const servedScript = (pidFile: string): string =>
  `printf 'root\\t%s\\n' "$(pwd -P)"\n` +
  `pid=$(cat ${shellQuote(pidFile)} 2>/dev/null) || exit 0\n` +
  `case "$pid" in ''|*[!0-9]*) exit 0 ;; esac\n` +
  `kill -0 "$pid" 2>/dev/null || exit 0\n` +
  `cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')\n` +
  `[ -z "$cwd" ] || printf 'cwd\\t%s\\n' "$cwd"\n`;

/** An event the host's claim does not take in its state (`claimTransition`). */
export class CrewClaimRefused extends Schema.TaggedError<CrewClaimRefused>()("CrewClaimRefused", {
  host: Schema.String,
  state: Schema.String,
  event: Schema.String,
}) {
  override get message(): string {
    return `The Show-on-dev claim on '${this.host}' is ${this.state}; it does not take ${this.event}.`;
  }
}

/** Who asks for Show on dev: a crewmate, and the host of its copy if it has one. */
export interface CrewClaimant {
  readonly crew: string;
  readonly handle: string;
  readonly host: string | undefined;
}

/** Claim events that need no reading of the dev server. */
export type CrewClaimPress = Extract<
  ClaimEvent,
  "deny" | "timeout" | "report" | "press" | "turn-failed" | "person-dev-server" | "self-deploy"
>;

type ClaimResult = Effect.Effect<Option.Option<CrewClaimRow>, CrewStoreError | CrewClaimRefused>;

export interface CrewRuntimeService {
  /** What the host's dev server serves now, read from its process. */
  readonly served: (
    host: string,
  ) => Effect.Effect<CrewServed, CrewShellError | CrewGitError | CrewStoreError>;
  /**
   * `crew_show_on_dev`: records the request when the host's claim is free,
   * and the answer for the model either way.
   */
  readonly request: (
    claimant: CrewClaimant,
  ) => Effect.Effect<
    { readonly outcome: ShowOnDevOutcome; readonly answer: CrewToolText },
    CrewStoreError
  >;
  /** The person grants: the engine then dispatches the claim turn. */
  readonly grant: (host: string, by: string) => ClaimResult;
  readonly apply: (host: string, event: CrewClaimPress) => ClaimResult;
  /**
   * After a claim or a release turn, or at boot: what dev serves moves the
   * claim (held, or back to none, or a failed release).
   */
  readonly settle: (
    host: string,
  ) => Effect.Effect<
    Option.Option<CrewClaimRow>,
    CrewShellError | CrewGitError | CrewStoreError | CrewClaimRefused
  >;
}

export class CrewRuntime extends Context.Service<CrewRuntime, CrewRuntimeService>()(
  "t3/zerops/crew/CrewRuntime",
) {}

export interface CrewRuntimeOptions {
  readonly devServerPidFile: string;
}

/** A host's stored claim as the pure rules read it, e.g. `holdsClaim(claimOf(row), handle)`. */
export const claimOf = (row: Option.Option<CrewClaimRow>): CrewClaim | undefined =>
  Option.match(row, {
    onNone: () => undefined,
    onSome: (value) => ({ state: value.state, handle: value.member }),
  });

const now = Effect.map(DateTime.now, DateTime.formatIso);

export const makeCrewRuntime = (options: CrewRuntimeOptions) =>
  Effect.gen(function* () {
    const shell = yield* CrewShell;
    const store = yield* CrewStore;

    const served: CrewRuntimeService["served"] = (host) =>
      Effect.gen(function* () {
        const out = yield* runFields(
          shell,
          host,
          "served",
          servedScript(options.devServerPidFile),
          SERVED_TIMEOUT,
        );
        const lanes = yield* store.lanesOnHost(host);
        return servedFrom(
          field(out, "cwd"),
          field(out, "root") ?? "",
          lanes.map((lane) => lane.lane),
        );
      });

    /**
     * Moves the host's claim by `event` in one store transaction; `none`
     * removes the row. An event its state does not take changes nothing and
     * is refused.
     */
    const move = (
      host: string,
      event: ClaimEvent,
      edit: (row: CrewClaimRow, at: string) => Partial<CrewClaimRow> = () => ({}),
    ): ClaimResult =>
      Effect.gen(function* () {
        const at = yield* now;
        let refused: CrewClaimRefused | undefined;
        const after = yield* store.updateClaim(host, (claim) => {
          const from = Option.isSome(claim) ? claim.value.state : "none";
          const step = claimTransition(from, event);
          if (step.kind === "illegal" || Option.isNone(claim)) {
            refused = new CrewClaimRefused({ host, state: from, event });
            return claim;
          }
          return step.to === "none"
            ? Option.none()
            : Option.some({ ...claim.value, ...edit(claim.value, at), state: step.to });
        });
        return refused === undefined ? after : yield* refused;
      });

    const request: CrewRuntimeService["request"] = (claimant) =>
      Effect.gen(function* () {
        const { host } = claimant;
        if (host === undefined) {
          const outcome: ShowOnDevOutcome = { kind: "no-lane" };
          return { outcome, answer: showOnDevAnswer(outcome, "") };
        }
        const at = yield* now;
        let outcome: ShowOnDevOutcome = { kind: "no-lane" };
        yield* store.updateClaim(host, (claim) => {
          outcome = claimRequest(claimOf(claim), claimant.handle, true);
          return outcome.kind === "requested"
            ? Option.some({
                host,
                crew: claimant.crew,
                member: claimant.handle,
                lane: claimant.handle,
                state: "requested",
                requestedAt: at,
                grantedBy: null,
                grantedAt: null,
                expiresAt: null,
                releasedAt: null,
              })
            : claim;
        });
        return { outcome, answer: showOnDevAnswer(outcome, host) };
      });

    const settle: CrewRuntimeService["settle"] = (host) =>
      Effect.gen(function* () {
        const claim = yield* store.getClaim(host);
        if (Option.isNone(claim)) return claim;
        const event = claimEventFromServed(
          claim.value.state,
          yield* served(host),
          claim.value.member,
        );
        return event === undefined ? claim : yield* move(host, event);
      });

    return CrewRuntime.of({
      served,
      request,
      grant: (host, by) => move(host, "grant", (_row, at) => ({ grantedBy: by, grantedAt: at })),
      apply: (host, event) =>
        move(host, event, (_row, at) =>
          event === "report" || event === "press" || event === "timeout" ? { releasedAt: at } : {},
        ),
      settle,
    });
  });

export const layer = Layer.effect(
  CrewRuntime,
  makeCrewRuntime({ devServerPidFile: DEV_SERVER_PIDFILE }),
);
