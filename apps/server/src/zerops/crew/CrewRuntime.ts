/**
 * CrewRuntime — Show on dev (ARCHITECTURE §5 *Show on dev*, CONCEPT §3.3):
 * one claim per dev service lets a crewmate's copy run on the service's own
 * dev server and URL, in place of the tree.
 *
 * A crewmate asks with `crew_show_on_dev`; the person grants; a short claim
 * turn in the holder's thread runs one command ({@link showOnDevCommand}): the
 * dev service's supervisor `zcp-devsup` (spec-mate §2.8a.2) stops the declared
 * dev server and runs the copy in its place as the runtime entry
 * `show-<handle>`, same port and command. A release turn removes the entry and
 * starts the declared server again ({@link backToTreeCommand}). Whether a turn
 * did it is never taken from the engine's own record: what dev serves is read
 * from the working directory of the supervisor's entry live on the dev port
 * (`servedFrom`), and that reading moves the claim (`claimEventFromServed`,
 * then `claimTransition`).
 *
 * The dev server is the one `.zcp/dev-servers.json` declares on the dev
 * setup's main port (`zerops.yaml`).
 *
 * The claim is one `crew_claim` row per host, moved in one store transaction
 * per event; `none` removes it. An event the claim's state does not take is
 * refused (`CrewClaimRefused`), never applied.
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
import { readDeclaredPorts } from "./crewPorts.ts";
import type { CrewToolText } from "./crewSeams.ts";
import {
  CrewGitError,
  CrewShell,
  laneDirectory,
  script,
  type CrewShellError,
} from "./CrewShell.ts";
import { type CrewClaimRow, CrewStore, type CrewStoreError } from "./CrewStore.ts";

/** The declared dev server a claim stands a copy in for. */
export interface DevServerShape {
  readonly name: string;
  readonly port: number;
  readonly command: string;
  /** Its working directory in the repository, `.` for the root. */
  readonly cwd: string;
}

/** What dev serves now, and the dev server a claim would stand in for (`null`: none declared). */
export interface DevServerReading {
  readonly served: CrewServed;
  readonly devServer: DevServerShape | null;
}

/** The supervisor's name for a copy shown on dev; a handle fits its name rule behind the prefix. */
export const showEntryName = (handle: string): string => `show-${handle}`;

/** Where the copy runs the dev server: the declared `cwd`, inside the copy. */
export const copyWorkDir = (handle: string, devServer: DevServerShape): string =>
  devServer.cwd === "." || devServer.cwd === ""
    ? laneDirectory(handle)
    : `${laneDirectory(handle)}/${devServer.cwd.replace(/^\.\//u, "")}`;

const ctlLine = (args: ReadonlyArray<string>): string =>
  `zcp-devsup ctl --json ${args.map(shellQuote).join(" ")}`;

/** On the dev service: the declared server stops, the copy runs in its place on its port. */
export const showOnDevScript = (
  handle: string,
  devServer: DevServerShape,
  workDir = copyWorkDir(handle, devServer),
): string =>
  `${ctlLine(["stop", devServer.name])} && ${ctlLine([
    "run",
    "--name",
    showEntryName(handle),
    "--cwd",
    workDir,
    "--port",
    String(devServer.port),
    "--",
    devServer.command,
  ])}`;

/** On the dev service: the copy's entry goes, the declared server starts again. */
export const backToTreeScript = (handle: string, devServer: DevServerShape): string =>
  `${ctlLine(["rm", showEntryName(handle)])}; ${ctlLine(["start", devServer.name])}`;

/** The claim turn's one command. */
export const showOnDevCommand = (
  host: string,
  handle: string,
  devServer: DevServerShape,
  workDir = copyWorkDir(handle, devServer),
) => `ssh ${shellQuote(host)} ${shellQuote(showOnDevScript(handle, devServer, workDir))}`;

/** The release turn's one command. */
export const backToTreeCommand = (host: string, handle: string, devServer: DevServerShape) =>
  `ssh ${shellQuote(host)} ${shellQuote(backToTreeScript(handle, devServer))}`;

const SERVED_TIMEOUT = Duration.seconds(10);

/** A host's Show-on-dev claim: its state and its holder or requester. */
export interface CrewClaim {
  readonly state: CrewClaimState;
  readonly handle: string | null;
}

const isWithin = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * What a dev service's dev server serves, from the working directory of the
 * supervisor's entry live on the dev port: the tree, a crewmate's copy under
 * `.crew/<handle>`, or — for no live entry, a copy no crewmate owns or
 * anywhere else — unknown.
 */
export const servedFrom = (
  cwd: string | undefined,
  remoteRoot: string,
  handles: ReadonlyArray<string>,
): CrewServed => {
  if (cwd === undefined || !isWithin(cwd, remoteRoot)) {
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

const SECTION = "@@t3-crew:";

/**
 * Prints the tree's real path, then `zerops.yaml`, the dev-server declaration and the supervisor's
 * `status`, each behind its section line; a part the service lacks is left out.
 */
const DEV_SERVER_SCRIPT =
  `printf 'root\\t%s\\n' "$(pwd -P)"\n` +
  `for f in zerops.yaml zerops.yml; do [ -f "$f" ] && { echo '${SECTION}yaml'; cat "$f"; echo; break; }; done\n` +
  `[ -f .zcp/dev-servers.json ] && { echo '${SECTION}declaration'; cat .zcp/dev-servers.json; echo; }\n` +
  `command -v zcp-devsup >/dev/null 2>&1 && { echo '${SECTION}status'; zcp-devsup ctl --json status; echo; }\n` +
  `exit 0\n`;

/** The declaration's servers (spec-mate §2.8a.1); only what Show on dev reads. */
const Declaration = Schema.Struct({
  servers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      port: Schema.optional(Schema.Number),
      command: Schema.String,
      cwd: Schema.optional(Schema.String),
      service: Schema.optional(Schema.String),
    }),
  ),
});
const decodeDeclaration = Schema.decodeUnknownOption(Schema.fromJsonString(Declaration));

/** The supervisor's `status` answer (spec-mate §2.8a.2); a declared entry carries no cwd or port. */
const SupervisorStatus = Schema.Struct({
  servers: Schema.Record(
    Schema.String,
    Schema.Struct({
      status: Schema.String,
      cwd: Schema.optional(Schema.String),
      port: Schema.optional(Schema.Number),
    }),
  ),
});
const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(SupervisorStatus));

const sectionsOf = (stdout: string): Readonly<Record<string, string>> => {
  const sections: Record<string, Array<string>> = {};
  let current: Array<string> | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith(SECTION)) sections[line.slice(SECTION.length)] = current = [];
    else if (line.startsWith("root\t") && current === undefined) sections.root = [line.slice(5)];
    else current?.push(line);
  }
  return Object.fromEntries(
    Object.entries(sections).map(([name, lines]) => [name, lines.join("\n")]),
  );
};

/** A repository-relative `cwd` under `root`, with `.` and repeated slashes folded. */
const under = (root: string, cwd: string): string =>
  [root, ...cwd.split("/").filter((segment) => segment !== "" && segment !== ".")].join("/");

const LIVE = new Set(["running", "starting"]);

/**
 * What dev serves and its declared server, from one reading of the service: the declared server
 * on the dev setup's main port, and the working directory of whichever entry is live on it.
 */
export const devServerReading = (
  stdout: string,
  host: string,
  handles: ReadonlyArray<string>,
): DevServerReading => {
  const sections = sectionsOf(stdout);
  const root = sections.root ?? "";
  const main =
    sections.yaml === undefined ? null : (readDeclaredPorts(sections.yaml, host)?.main ?? null);
  const declared = Option.match(decodeDeclaration(sections.declaration ?? ""), {
    onNone: () => [],
    onSome: (declaration) =>
      declaration.servers.filter(
        (server) => server.service === undefined || server.service === host,
      ),
  });
  const own = main === null ? undefined : declared.find((server) => server.port === main);
  const status = Option.getOrUndefined(decodeStatus(sections.status ?? ""));
  const live = Object.entries(status?.servers ?? {}).flatMap(([name, entry]) => {
    const declaration = declared.find((server) => server.name === name);
    const port = entry.port ?? declaration?.port;
    return LIVE.has(entry.status) && port === main && main !== null
      ? [entry.cwd ?? declaration?.cwd ?? "."]
      : [];
  });
  return {
    served: servedFrom(live[0] === undefined ? undefined : under(root, live[0]), root, handles),
    devServer:
      own?.port === undefined
        ? null
        : { name: own.name, port: own.port, command: own.command, cwd: own.cwd ?? "." },
  };
};

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
  /** What the host's dev server serves now, and the declared dev server a claim stands in for. */
  readonly devServer: (
    host: string,
  ) => Effect.Effect<DevServerReading, CrewShellError | CrewGitError | CrewStoreError>;
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

/** A host's stored claim as the pure rules read it, e.g. `holdsClaim(claimOf(row), handle)`. */
export const claimOf = (row: Option.Option<CrewClaimRow>): CrewClaim | undefined =>
  Option.match(row, {
    onNone: () => undefined,
    onSome: (value) => ({ state: value.state, handle: value.member }),
  });

const now = Effect.map(DateTime.now, DateTime.formatIso);

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;
  const store = yield* CrewStore;

  const devServer: CrewRuntimeService["devServer"] = (host) =>
    Effect.gen(function* () {
      const result = yield* shell.run(host, script(DEV_SERVER_SCRIPT), {
        timeout: SERVED_TIMEOUT,
      });
      if (result.code !== 0) {
        return yield* new CrewGitError({
          host,
          operation: "devServer",
          detail: result.stderr.trim() || `exit ${result.code}`,
        });
      }
      const lanes = yield* store.lanesOnHost(host);
      return devServerReading(
        result.stdout,
        host,
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
        (yield* devServer(host)).served,
        claim.value.member,
      );
      return event === undefined ? claim : yield* move(host, event);
    });

  return CrewRuntime.of({
    devServer,
    request,
    grant: (host, by) => move(host, "grant", (_row, at) => ({ grantedBy: by, grantedAt: at })),
    apply: (host, event) =>
      move(host, event, (_row, at) =>
        event === "report" || event === "press" || event === "timeout" ? { releasedAt: at } : {},
      ),
    settle,
  });
});

export const layer = Layer.effect(CrewRuntime, make);
