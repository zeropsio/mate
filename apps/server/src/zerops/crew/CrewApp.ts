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
 * them again once the redeploy ends.
 *
 * A dev service whose supervisor does not answer (its zcp has none yet, or its dev setup runs none)
 * runs the app as before the supervisor, decided at each call: under `setsid`, so it leads its own
 * session and process group, its output in `.crew/<handle>.run.log` and its pid in
 * `.crew/<handle>.run.pid`, both beside the lane and outside every tree. Stop signals the whole
 * group - the dev server and whatever it spawned - TERM first, KILL after five seconds.
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
  field,
  laneDirectory,
  runFields,
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
  | { readonly state: "lane-missing" };

/** The supervisor's name for a crewmate's app; a handle fits its name rule behind the prefix. */
export const appEntryName = (handle: string): string => `crew-${handle}`;

/** `zcp-devsup ctl` exit codes (spec-mate §2.8a.2). */
const CTL_NO_SUPERVISOR = 2;
const CTL_UNKNOWN_NAME = 3;

const LANE_MISSING = "crew-app-lane-missing";

export const appLogPath = (handle: string): string => `${laneDirectory(handle)}.run.log`;
export const appPidPath = (handle: string): string => `${laneDirectory(handle)}.run.pid`;

const APP_SCRIPT_TIMEOUT = Duration.seconds(30);

/** Seconds between TERM and KILL, in tenths polled by the stop script. */
const STOP_GRACE_TENTHS = 50;

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

/** Prints the running pid and exits when the pidfile names a live process. */
const IF_RUNNING = (pidFile: string) =>
  `if [ -f ${pidFile} ] && pid=$(cat ${pidFile}) && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then\n` +
  `  printf 'state\\trunning\\npid\\t%s\\n' "$pid"; exit 0\n` +
  `fi\n`;

const toStatus = (out: ReadonlyArray<readonly [string, string]>): AppStatus => {
  const state = field(out, "state");
  if (state === "lane-missing") return { state: "lane-missing" };
  return state === "running"
    ? { state: "running", pid: Number(field(out, "pid")) }
    : { state: "stopped" };
};

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

  const runScript = (host: string, operation: string, body: string) =>
    runFields(shell, host, operation, body, APP_SCRIPT_TIMEOUT).pipe(Effect.map(toStatus));

  const setsidRun = (input: AppRun) => {
    const directory = shellQuote(laneDirectory(input.handle));
    const pidFile = shellQuote(appPidPath(input.handle));
    return runScript(
      input.host,
      "appRun",
      `[ -d ${directory} ] || { printf 'state\\tlane-missing\\n'; exit 0; }\n` +
        IF_RUNNING(pidFile) +
        `(\n` +
        `  cd ${directory} || exit 1\n` +
        laneEnvironment(input.port, input.env) +
        `  exec setsid sh -c ${shellQuote(input.command)}\n` +
        `) > ${shellQuote(appLogPath(input.handle))} 2>&1 < /dev/null &\n` +
        `pid=$!\n` +
        `printf '%s\\n' "$pid" > ${pidFile}\n` +
        `printf 'state\\trunning\\npid\\t%s\\n' "$pid"\n`,
    );
  };

  const setsidStop = (lane: AppLane) => {
    const pidFile = shellQuote(appPidPath(lane.handle));
    return runScript(
      lane.host,
      "appStop",
      `if [ -f ${pidFile} ] && pid=$(cat ${pidFile}) && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then\n` +
        `  kill -s TERM -- -"$pid" 2>/dev/null || kill -s TERM "$pid" 2>/dev/null\n` +
        `  n=0\n` +
        `  while kill -0 "$pid" 2>/dev/null && [ "$n" -lt ${STOP_GRACE_TENTHS} ]; do sleep 0.1; n=$((n + 1)); done\n` +
        `  kill -0 "$pid" 2>/dev/null && kill -s KILL -- -"$pid" 2>/dev/null\n` +
        `fi\n` +
        `rm -f ${pidFile}\n` +
        `printf 'state\\tstopped\\n'\n`,
    );
  };

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
      (result): Effect.Effect<AppStatus, CrewShellError | CrewGitError> => {
        if (result.code === CTL_NO_SUPERVISOR) return setsidRun(input);
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

  // Once the supervisor forgot the entry, nothing of the app's runs.
  const stop: CrewAppService["stop"] = (lane) =>
    Effect.flatMap(
      shell.run(lane.host, script(ctl(["rm", appEntryName(lane.handle)])), {
        timeout: APP_SCRIPT_TIMEOUT,
      }),
      (result): Effect.Effect<AppStatus, CrewShellError | CrewGitError> => {
        if (result.code === CTL_NO_SUPERVISOR) return setsidStop(lane);
        return result.code === 0 || result.code === CTL_UNKNOWN_NAME
          ? Effect.succeed({ state: "stopped" })
          : Effect.fail(failed(lane.host, "appStop", result));
      },
    );

  return CrewApp.of({ run, stop });
});

export const layer = Layer.effect(CrewApp, make);
