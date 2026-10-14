/**
 * CrewApp - a crewmate's own app on its crew port (PRD §5.7).
 *
 * The dev service's supervisor `zcp-devsup` owns every process it runs (spec-mate §2.8a.2): the
 * engine adds the app as the supervisor's runtime entry `crew-<handle>` over ssh — `cwd` its copy
 * `.crew/<handle>`, `port` its crew port — and removes it to stop it. The supervisor starts it as
 * the leader of its own process group, keeps its output in its own log, stops the whole group, and
 * outlives the ssh session that asked, so an OOM that kills the session loses only the answer.
 * Every `ctl` verb is idempotent: `run` of an entry already running as asked starts nothing.
 *
 * A container restart keeps the supervisor's entries; a redeploy drops them, and the engine adds
 * them again once the redeploy ends. A dev service whose dev setup runs no supervisor runs no
 * crew app: its dev setup needs the supervisor first.
 *
 * `CREW_PORT` is the crewmate's crew port, exported with its `env:` ahead of its *Run command*.
 *
 * @module CrewApp
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { CrewAppState } from "@t3tools/contracts";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { laneEnvironment } from "./CrewChecks.ts";
import {
  CrewGitError,
  CrewShell,
  laneDirectory,
  script,
  type CrewShellError,
  type ShellResult,
} from "./CrewShell.ts";

export interface AppLane {
  readonly host: string;
  readonly handle: string;
}

export interface AppRun extends AppLane {
  readonly command: string;
  readonly port: number;
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export type AppStatus =
  | { readonly state: Extract<CrewAppState, "running">; readonly pid: number }
  | { readonly state: Extract<CrewAppState, "stopped"> }
  | { readonly state: "lane-missing" }
  | { readonly state: "no-supervisor" };

/** The supervisor's name for a crewmate's app; a handle fits its name rule behind the prefix. */
export const appEntryName = (handle: string): string => `crew-${handle}`;

/** `zcp-devsup ctl` exit codes (spec-mate §2.8a.2). */
const CTL_NO_SUPERVISOR = 2;
const CTL_UNKNOWN_NAME = 3;

const LANE_MISSING = "crew-app-lane-missing";

const APP_SCRIPT_TIMEOUT = Duration.seconds(30);

/** One server of the supervisor's answer; only what the app's status needs. */
const SupervisedServer = Schema.Struct({ status: Schema.String, pid: Schema.Number });
const SupervisorAnswer = Schema.Struct({
  servers: Schema.Record(Schema.String, SupervisedServer),
});
const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(SupervisorAnswer));

export interface CrewAppService {
  /** Starts the app unless it already runs as asked; either way, its status. */
  readonly run: (input: AppRun) => Effect.Effect<AppStatus, CrewShellError | CrewGitError>;
  readonly stop: (lane: AppLane) => Effect.Effect<AppStatus, CrewShellError | CrewGitError>;
}

export class CrewApp extends Context.Service<CrewApp, CrewAppService>()("t3/zerops/crew/CrewApp") {}

/**
 * `zcp-devsup ctl` with these arguments, answering in JSON; a service without the binary has no
 * supervisor. `--json` goes first: everything after `--` is the command.
 */
const ctl = (args: ReadonlyArray<string>): string =>
  `command -v zcp-devsup >/dev/null 2>&1 || exit ${CTL_NO_SUPERVISOR}\n` +
  `exec zcp-devsup ctl --json ${args.map(shellQuote).join(" ")}\n`;

/** The app as the supervisor's answer shows it: a live group runs, `starting` included. */
const statusOf = (stdout: string, handle: string): AppStatus | undefined => {
  const answer = decodeAnswer(stdout);
  if (Option.isNone(answer)) return undefined;
  const server = answer.value.servers[appEntryName(handle)];
  if (server === undefined) return { state: "stopped" };
  return server.status === "running" || server.status === "starting"
    ? { state: "running", pid: server.pid }
    : { state: "stopped" };
};

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;

  const failed = (host: string, operation: string, result: ShellResult) =>
    new CrewGitError({
      host,
      operation,
      detail: result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`,
    });

  const run: CrewAppService["run"] = (input) => {
    const directory = laneDirectory(input.handle);
    const body =
      `[ -d ${shellQuote(directory)} ] || { printf '%s\\n' ${LANE_MISSING}; exit 0; }\n` +
      ctl([
        "run",
        "--name",
        appEntryName(input.handle),
        "--cwd",
        directory,
        "--port",
        String(input.port),
        "--",
        laneEnvironment(input.port, input.env) + input.command,
      ]);
    return Effect.flatMap(
      shell.run(input.host, script(body), { timeout: APP_SCRIPT_TIMEOUT }),
      (result): Effect.Effect<AppStatus, CrewGitError> => {
        if (result.code === CTL_NO_SUPERVISOR) return Effect.succeed({ state: "no-supervisor" });
        if (result.code === 0 && result.stdout.trim() === LANE_MISSING) {
          return Effect.succeed({ state: "lane-missing" });
        }
        const status = result.code === 0 ? statusOf(result.stdout, input.handle) : undefined;
        return status === undefined
          ? Effect.fail(failed(input.host, "appRun", result))
          : Effect.succeed(status);
      },
    );
  };

  // Without a supervisor, or once it forgot the entry, nothing of the app's runs.
  const stop: CrewAppService["stop"] = (lane) =>
    Effect.flatMap(
      shell.run(lane.host, script(ctl(["rm", appEntryName(lane.handle)])), {
        timeout: APP_SCRIPT_TIMEOUT,
      }),
      (result): Effect.Effect<AppStatus, CrewGitError> =>
        result.code === 0 || result.code === CTL_NO_SUPERVISOR || result.code === CTL_UNKNOWN_NAME
          ? Effect.succeed({ state: "stopped" })
          : Effect.fail(failed(lane.host, "appStop", result)),
    );

  return CrewApp.of({ run, stop });
});

export const layer = Layer.effect(CrewApp, make);
