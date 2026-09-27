/**
 * CrewApp - a crewmate's own app on its crew port (PRD §5.7).
 *
 * The engine runs the crewmate's *Run command* itself, like `setup` and
 * `check`: over ssh, in the lane, never as a turn and never through zcp's
 * `zerops_dev_server` (one default pidfile, stop by the command's first
 * token). The command starts under `setsid`, so it leads its own session and
 * process group; its output goes to `.crew/<handle>.run.log` and its pid to
 * `.crew/<handle>.run.pid`, both beside the lane and outside every tree.
 * Stop signals the whole group - the dev server and whatever it spawned -
 * TERM first, KILL after five seconds. Status reads the pid; a dead one is
 * `stopped` (a redeploy or container replacement stops every crew app).
 *
 * `CREW_PORT` is the crewmate's crew port, exported with its `env:`.
 *
 * @module CrewApp
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { CrewAppState } from "@t3tools/contracts";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { laneEnvironment } from "./CrewChecks.ts";
import {
  CrewShell,
  field,
  laneDirectory,
  runFields,
  type CrewGitError,
  type CrewShellError,
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

export const appLogPath = (handle: string): string => `${laneDirectory(handle)}.run.log`;
export const appPidPath = (handle: string): string => `${laneDirectory(handle)}.run.pid`;

const APP_SCRIPT_TIMEOUT = Duration.seconds(30);

/** Seconds between TERM and KILL, in tenths polled by the stop script. */
const STOP_GRACE_TENTHS = 50;

export interface CrewAppService {
  /** Starts the app unless it already runs; either way, its status. */
  readonly run: (input: AppRun) => Effect.Effect<AppStatus, CrewShellError | CrewGitError>;
  readonly stop: (lane: AppLane) => Effect.Effect<AppStatus, CrewShellError | CrewGitError>;
  readonly status: (lane: AppLane) => Effect.Effect<AppStatus, CrewShellError | CrewGitError>;
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

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;

  const runScript = (host: string, operation: string, body: string) =>
    runFields(shell, host, operation, body, APP_SCRIPT_TIMEOUT).pipe(Effect.map(toStatus));

  const run: CrewAppService["run"] = (input) => {
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

  const stop: CrewAppService["stop"] = (lane) => {
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

  const status: CrewAppService["status"] = (lane) =>
    runScript(
      lane.host,
      "appStatus",
      IF_RUNNING(shellQuote(appPidPath(lane.handle))) + `printf 'state\\tstopped\\n'\n`,
    );

  return CrewApp.of({ run, stop, status });
});

export const layer = Layer.effect(CrewApp, make);
