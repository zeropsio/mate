/**
 * CrewRuntime — Show on dev (ARCHITECTURE §5 *Show on dev*, CONCEPT §3.3):
 * one claim per dev service lets a crewmate's copy run on the service's own
 * dev server and URL, in place of the tree.
 *
 * A short claim turn in the holder's thread runs one command ({@link showOnDevCommand}): the
 * dev service's supervisor `zcp-devsup` (spec-mate §2.8a.2) stops the declared
 * dev server and runs the copy in its place as the runtime entry
 * `show-<handle>`, same port and command. A release turn removes the entry and
 * starts the declared server again ({@link backToTreeCommand}). Whether a turn
 * did it is never taken from the engine's own record: what dev serves is read
 * from the working directory of the supervisor's entry live on the dev port
 * (`servedFrom`).
 *
 * The dev server is the one `.zcp/dev-servers.json` declares on the dev
 * setup's main port (`zerops.yaml`).
 *
 * @module CrewRuntime
 */
import type { CrewServed } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { readDeclaredPorts } from "./crewPorts.ts";
import {
  CrewGitError,
  CrewShell,
  laneDirectory,
  script,
  type CrewShellError,
} from "./CrewShell.ts";
import { CrewStore, type CrewStoreError } from "./CrewStore.ts";

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

export interface CrewRuntimeService {
  /** What the host's dev server serves now, and the declared dev server a claim stands in for. */
  readonly devServer: (
    host: string,
  ) => Effect.Effect<DevServerReading, CrewShellError | CrewGitError | CrewStoreError>;
}

export class CrewRuntime extends Context.Service<CrewRuntime, CrewRuntimeService>()(
  "t3/zerops/crew/CrewRuntime",
) {}

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

  return CrewRuntime.of({ devServer });
});

export const layer = Layer.effect(CrewRuntime, make);
