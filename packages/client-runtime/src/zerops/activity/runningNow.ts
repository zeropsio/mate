/**
 * What a place's platform is doing now, one line a process: the service, what it is in a person's
 * words (Building v0.1.60, Creating, Restarting), where a build's pipeline stands as three parts,
 * and when it began. The platform's own running work (`projectProcesses`' `running`) is all it
 * reads: nothing here asks Zerops, and no id, "pipeline" or "app version" is ever a word.
 *
 * Pure: no network, no clock.
 *
 * @module zerops/activity/runningNow
 */
import { deployedVersion } from "../groupRows.ts";
import { processActionWord } from "../operations/phrases.ts";
import type { ActivityProcess } from "./dto.ts";
import { getPipelineState, type PipelineState, type PipelineStepStatus } from "./pipelineState.ts";

export type RunningTrailLabel = "Build container" | "Build" | "Deploy";

export interface RunningTrailPart {
  readonly label: RunningTrailLabel;
  readonly state: "done" | "busy" | "waiting";
}

export interface RunningLine {
  /** The process, to key a row by; never a word. */
  readonly id: string;
  /** The service it works on, by hostname; none where the place lists no such service yet. */
  readonly service: string | undefined;
  /** What it is: `Building v0.1.60`, `Deploying v0.1.60`, `Creating`, `Restarting`, `Waiting`. */
  readonly words: string;
  /** The same after the service in a sentence: `is deploying v0.1.60`, `is being created`. */
  readonly doing: string;
  /** A build's three parts; none for work that is one step, or whose parts Zerops has not said. */
  readonly trail: ReadonlyArray<RunningTrailPart> | undefined;
  /** Not begun: it waits, `behind` what where the same service runs something else. */
  readonly waiting: boolean;
  readonly behind: string | undefined;
  /** When it began, ISO, on the platform's clock: what its elapsed time counts from. */
  readonly since: string;
  /** The version a build or a deploy makes, as a person names it; none for anything else. */
  readonly version: string | undefined;
  /** A build with its deploy, a service's creation, or anything else: what a surface joins by. */
  readonly kind: "build" | "create" | "other";
  /** The platform's handle of the version a build makes, to join it with who asked; never a word. */
  readonly versionId: string | undefined;
  /** How far along it is, for the one line a row has room for: the furthest first. */
  readonly rank: number;
}

interface Kind {
  readonly words: string;
  readonly doing: string;
  /** What another line waits for: `its restart`. */
  readonly noun: string;
}

const KINDS: Readonly<Record<string, Kind>> = {
  "stack.create": { words: "Creating", doing: "is being created", noun: "creation" },
  "stack.delete": { words: "Deleting", doing: "is being deleted", noun: "deletion" },
  "stack.restart": { words: "Restarting", doing: "is restarting", noun: "restart" },
  "stack.reload": { words: "Reloading", doing: "is reloading", noun: "reload" },
  "stack.start": { words: "Starting", doing: "is starting", noun: "start" },
  "stack.stop": { words: "Stopping", doing: "is stopping", noun: "stop" },
  "stack.scale": { words: "Scaling", doing: "is scaling", noun: "scaling" },
  "stack.updateUserData": {
    words: "Updating variables",
    doing: "is taking new variables",
    noun: "variables",
  },
  "stack.updateProjectEnvs": {
    words: "Updating variables",
    doing: "is taking new variables",
    noun: "variables",
  },
  "stack.enableSubdomainAccess": {
    words: "Turning its address on",
    doing: "is getting its address",
    noun: "address",
  },
  "stack.disableSubdomainAccess": {
    words: "Turning its address off",
    doing: "is losing its address",
    noun: "address",
  },
};

const BUILDS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);

const done = (status: PipelineStepStatus) => status === "finished" || status === "noop";
const busy = (status: PipelineStepStatus) => status === "running" || status === "activating";

const partOf = (statuses: ReadonlyArray<PipelineStepStatus>): RunningTrailPart["state"] =>
  statuses.every(done)
    ? "done"
    : statuses.some((status) => busy(status) || done(status))
      ? "busy"
      : "waiting";

/**
 * The platform's five steps as the three a person follows: its build container, the build, and
 * the deploy (the runtime's own preparation with it). None where the platform says no part of it
 * yet.
 */
function trailOf(state: PipelineState): ReadonlyArray<RunningTrailPart> | undefined {
  const all = Object.values(state);
  if (all.every((status) => status === "noop")) return undefined;
  const parts: ReadonlyArray<RunningTrailPart> = [
    { label: "Build container", state: partOf([state.INIT_BUILD_CONTAINER]) },
    { label: "Build", state: partOf([state.RUN_BUILD_COMMANDS]) },
    {
      label: "Deploy",
      state: partOf([state.INIT_PREPARE_CONTAINER, state.RUN_PREPARE_COMMANDS, state.DEPLOY]),
    },
  ];
  // One part is under way at a time: the first not done, where the platform names none running.
  const current = parts.findIndex((part) => part.state !== "done");
  return parts.map((part, index) => ({
    label: part.label,
    state: index < current || current === -1 ? "done" : index === current ? part.state : "waiting",
  }));
}

/** The version a build makes, as a person names it: the release's tag, else its short commit. */
function versionOf(process: ActivityProcess): string | undefined {
  return deployedVersion(process.appVersion?.name).label;
}

function lineOf(
  process: ActivityProcess,
  services: ReadonlyMap<string, string>,
): Omit<RunningLine, "behind"> & { readonly noun: string } {
  const service = process.serviceStackIds.flatMap((id) => services.get(id) ?? [])[0];
  const since = process.started ?? process.created;
  const pending = process.status === "PENDING";
  if (BUILDS.has(process.actionName)) {
    const version = versionOf(process);
    const named = version === undefined ? "" : ` ${version}`;
    const trail =
      process.appVersion === undefined ? undefined : trailOf(getPipelineState(process.appVersion));
    // The part it stands at: the first not done, the deploy once every part is.
    const first = trail?.findIndex((part) => part.state !== "done") ?? -1;
    const at = trail === undefined ? undefined : first === -1 ? trail.length - 1 : first;
    const deploying =
      at === undefined ? process.actionName === "stack.deploy" : at === (trail?.length ?? 0) - 1;
    // Begun by the platform's word for the process, and by its part's where it says parts.
    const waiting = pending || (first !== -1 && trail?.[first]?.state === "waiting");
    return {
      id: process.id,
      service,
      words: waiting ? "Waiting" : `${deploying ? "Deploying" : "Building"}${named}`,
      doing: waiting
        ? `waits to ${deploying ? "deploy" : "build"}${named}`
        : `is ${deploying ? "deploying" : "building"}${named}`,
      noun: `${deploying ? "deploy" : "build"}${version === undefined ? "" : ` of ${version}`}`,
      trail,
      waiting,
      since,
      version,
      kind: "build",
      versionId: process.appVersion?.id,
      rank: waiting ? 0 : at === undefined ? (deploying ? 3 : 2) : at + 1,
    };
  }
  const kind = KINDS[process.actionName];
  const action = processActionWord(process.actionName);
  return {
    id: process.id,
    service,
    words: pending ? "Waiting" : (kind?.words ?? action),
    doing: pending
      ? `waits${kind === undefined ? "" : ` for its ${kind.noun}`}`
      : (kind?.doing ?? `is busy (${action.toLowerCase()})`),
    noun: kind?.noun ?? action.toLowerCase(),
    trail: undefined,
    waiting: pending,
    since,
    version: undefined,
    kind: process.actionName === "stack.create" ? "create" : "other",
    versionId: undefined,
    rank: pending ? 0 : 2,
  };
}

/**
 * A place's running and waiting work, the furthest along first, then the longest running. A build
 * and the deploy that follows it are one version's one line, the further of the two.
 */
export function runningLines(input: {
  /** The place's project's processes that run now (`ProjectProcesses.running`). */
  readonly processes: ReadonlyArray<ActivityProcess>;
  /** The place's own services, by id: a process on none of them is said without a service. */
  readonly services: ReadonlyMap<string, string>;
}): ReadonlyArray<RunningLine> {
  const lines = input.processes.map((process) => ({
    process,
    line: lineOf(process, input.services),
  }));
  const kept = lines.filter(
    ({ process, line }) =>
      process.appVersion?.id === undefined ||
      !lines.some(
        (other) =>
          other.process !== process &&
          other.process.appVersion?.id === process.appVersion?.id &&
          (other.line.rank > line.rank ||
            (other.line.rank === line.rank && other.process.id > process.id)),
      ),
  );
  return kept
    .map(({ line: { noun: _noun, ...line } }) => {
      // The platform runs one thing on a service at a time: what waits there waits behind it.
      const ahead = line.waiting
        ? kept.find(
            (other) =>
              !other.line.waiting &&
              other.line.id !== line.id &&
              line.service !== undefined &&
              other.line.service === line.service,
          )
        : undefined;
      return { ...line, behind: ahead === undefined ? undefined : `its ${ahead.line.noun}` };
    })
    .sort(
      (left, right) =>
        right.rank - left.rank ||
        left.since.localeCompare(right.since) ||
        left.id.localeCompare(right.id),
    );
}

/** A line as a sentence's part: `shop is deploying v0.1.60`, `Something is restarting`. */
export function runningSentence(line: RunningLine): string {
  return `${line.service ?? "A service"} ${line.doing}`;
}

/** A line for a row with room for a few words: `shop building`, `cache creating`, `shop waiting`. */
export function runningShort(line: RunningLine): string {
  const words = (
    line.version === undefined ? line.words : line.words.replace(` ${line.version}`, "")
  ).toLowerCase();
  return line.service === undefined ? words : `${line.service} ${words}`;
}
