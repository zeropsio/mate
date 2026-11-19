/**
 * A short claim turn in the holder's thread runs one command ({@link showOnDevCommand}).
 * A release turn removes the entry and starts the declared server again ({@link backToTreeCommand}).
 */
import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { laneDirectory } from "./crewLanes.ts";

/** The declared dev server a claim stands a copy in for. */
export interface DevServerShape {
  readonly name: string;
  readonly port: number;
  readonly command: string;
  /** Its working directory in the repository, `.` for the root. */
  readonly cwd: string;
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
