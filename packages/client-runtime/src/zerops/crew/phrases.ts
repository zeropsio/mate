/**
 * Crew mode's phrase producer (R5): the board's column titles, task-state
 * words, the section header's crew state, *Waiting on you* sentences and
 * presses, the section's copy, pending and footer words, a crewmate chat's
 * header, lane bar and notices, refusal sentences, and the drafts a crew
 * surface hands the Mate — PRD §4.3, §4.4, §4.5, §4.7, §5.3, §5.6, §5.7,
 * §6.3. A crew surface renders crew
 * and task words only from here; a thread's own status word still comes only
 * from `resolveThreadStatus` and is passed in where a task shows it.
 *
 * Pure: no clock, no I/O; every fact arrives from the crew snapshot.
 */
import type {
  CrewAttention,
  CrewCheck,
  CrewHost,
  CrewLaneSummary,
  CrewRefusalReason,
  CrewRun,
  CrewSnapshot,
  CrewTask,
  CrewTaskSource,
  CrewTaskState,
  Crewmate,
} from "@t3tools/contracts";

/** The board's columns, left to right (PRD §4.4). */
export const CREW_BOARD_COLUMNS = [
  { id: "waiting-on-you", title: "Waiting on you" },
  { id: "working", title: "Working" },
  { id: "in-review", title: "In review" },
  { id: "queued", title: "Queued" },
  { id: "landed", title: "Landed" },
] as const;
export type CrewBoardColumnId = (typeof CREW_BOARD_COLUMNS)[number]["id"];

/**
 * The column a task sits in (PRD §6.3); `null` for a discarded task, which the
 * board filters out. `personLands`: a `ready` task waits for your *Land*
 * rather than landing on its own.
 */
export function crewBoardColumn(
  state: CrewTaskState,
  personLands: boolean,
): CrewBoardColumnId | null {
  switch (state) {
    case "proposed":
    case "blocked":
    case "waiting-on-you":
    case "parked":
      return "waiting-on-you";
    case "working":
    case "rework":
    case "merging":
    case "checking":
    case "landing":
      return "working";
    case "review":
      return "in-review";
    case "ready":
      return personLands ? "waiting-on-you" : "in-review";
    case "queued":
      return "queued";
    case "landed":
      return "landed";
    case "discarded":
      return null;
  }
}

export interface CrewTaskWordContext {
  /** The board, to name a dependency a queued task still waits for. */
  readonly tasks: ReadonlyArray<CrewTask>;
  /** A crew with a lead reviews through it: "In review by lead". */
  readonly hasLead: boolean;
  /**
   * The owner's current thread status word from `resolveThreadStatus`: a
   * working task's word is its thread's, and only that resolver writes one (R5).
   */
  readonly threadStatusWord: string;
  /** The owner's open task (`Crewmate.openTaskId`), which a queued task of its waits behind. */
  readonly ownerOpenTaskId: string | null;
}

/**
 * Why a queued task has not started: `after #11`, a dependency that has not
 * landed, before `waits for #13`, the task its owner is on; `null` for neither.
 */
export function crewQueuedReason(
  task: CrewTask,
  context: Pick<CrewTaskWordContext, "tasks" | "ownerOpenTaskId">,
): string | null {
  const dependency = task.dependsOn
    .map((id) => context.tasks.find((candidate) => candidate.id === id))
    .find((candidate) => candidate !== undefined && candidate.state !== "landed");
  if (dependency !== undefined) return `after #${dependency.number}`;
  const current = context.tasks.find((candidate) => candidate.id === context.ownerOpenTaskId);
  return current === undefined || current.id === task.id ? null : `waits for #${current.number}`;
}

/** A task's state word (PRD §6.3). */
export function crewTaskWord(task: CrewTask, context: CrewTaskWordContext): string {
  switch (task.state) {
    case "proposed":
      return "Proposed";
    case "queued": {
      const reason = crewQueuedReason(task, context);
      return reason === null ? "Queued" : `Queued · ${reason}`;
    }
    case "working":
      return context.threadStatusWord;
    case "rework":
      return task.reason === null ? "Rework" : `Rework: ${task.reason}`;
    case "blocked":
      return "Asks a question";
    case "merging":
    case "checking":
      return "Checking";
    case "review":
      return context.hasLead ? "In review by lead" : "In review";
    case "ready":
      return "Ready to land";
    case "landing":
      return "Landing";
    case "waiting-on-you": {
      const [first, ...rest] = task.waitingOn;
      if (first === undefined) return "Waits on your tree";
      return rest.length === 0
        ? `Waits on your tree: ${first}`
        : `Waits on your tree: ${first} +${rest.length}`;
    }
    case "landed":
      return task.delivered ? "Delivered" : "Landed · not delivered";
    case "parked":
      return task.reason === null ? "Stopped" : `Stopped: ${task.reason}`;
    case "discarded":
      return "Discarded";
  }
}

/** A check's outcome (PRD §4.5, §5.2): the board's cards and sheet and the lane bar say it alike. */
export function crewCheckWord(check: CrewCheck): string {
  switch (check.state) {
    case "running":
      return "Checking";
    case "passed":
      return "Check passed";
    case "failed":
      return "Check failed";
  }
}

/** A run is on while it is running or paused; its options govern only then. */
const isRunOn = (run: CrewRun | null): run is CrewRun =>
  run !== null && (run.state === "running" || run.state === "paused");

/** Whether a `ready` task waits for your *Land*: always without a run on, else per its landing option. */
export function crewPersonLands(run: CrewRun | null): boolean {
  return !isRunOn(run) || run.options.landing === "person";
}

/** `1 h 12 m`, `45 m`, `8 h`. */
function formatCrewDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

function pausedWord(run: CrewRun): string {
  switch (run.reason) {
    case "budget":
      return "Paused · budget reached";
    case "time":
      return "Paused · time limit reached";
    case "usage":
      return run.options.stopAtUsagePercent === null
        ? "Paused · usage limit reached"
        : `Paused · usage at ${run.options.stopAtUsagePercent} %`;
    case "refused":
      return run.reasonDetail === null ? "Paused" : `Paused · ${run.reasonDetail}`;
    case "person":
    case null:
      return "Paused";
  }
}

/** A crewmate doing nothing, and a crew nobody on which is working. */
export const CREW_IDLE_WORD = "Idle";

/**
 * The crew state beside the section's header (PRD §4.3 item 1). `run` is the
 * crew's latest run; `workingCount` is how many crewmates' current threads
 * `resolveThreadStatus` reads as working.
 */
export function crewStateWord(input: {
  readonly run: CrewRun | null;
  readonly workingCount: number;
}): string {
  const { run, workingCount } = input;
  if (run?.state === "running") return `Running · ${formatCrewDuration(run.elapsedMs)}`;
  if (run?.state === "paused") return pausedWord(run);
  if (run?.state === "finishing") return "Finishing";
  return workingCount === 0 ? CREW_IDLE_WORD : `${workingCount} working`;
}

export interface CrewRunMeters {
  readonly spend: string;
  readonly time: string;
  /** `null` when the login reports no usage. */
  readonly usage: string | null;
}

const dollars = (amount: number, cents: boolean) =>
  cents || !Number.isInteger(amount) ? `$${amount.toFixed(2)}` : `$${amount}`;

/** The run meters under the header while a run is on (PRD §4.3 item 2). */
export function crewRunMeters(run: CrewRun): CrewRunMeters {
  const { budgetUsd, timeLimitHours, stopAtUsagePercent } = run.options;
  const spent = dollars(run.spentUsd, true);
  const elapsed = formatCrewDuration(run.elapsedMs);
  return {
    spend:
      budgetUsd === "unlimited"
        ? `Spend ${spent} · no limit`
        : `Spend ${spent} of ${dollars(budgetUsd, false)}`,
    time:
      timeLimitHours === "unlimited"
        ? `Time ${elapsed} · no limit`
        : `Time ${elapsed} of ${timeLimitHours} h`,
    usage:
      run.usagePercent === null
        ? null
        : stopAtUsagePercent === null
          ? `Usage ${Math.round(run.usagePercent)} %`
          : `Usage ${Math.round(run.usagePercent)} %, stops at ${stopAtUsagePercent}`,
  };
}

/** `a.ts`, or `a.ts and 2 more`. */
function pathSummary(paths: ReadonlyArray<string>): string {
  const [first, ...rest] = paths;
  if (first === undefined) return "a file";
  return rest.length === 0 ? first : `${first} and ${rest.length} more`;
}

/**
 * One *Waiting on you* row as a sentence (PRD §4.3 item 4, §5.2, §5.2a). A
 * crewmate is named by its display name; a handle no longer on the crew reads
 * as `@handle`.
 */
export function crewAttentionSentence(
  row: CrewAttention,
  crew: Pick<CrewSnapshot, "crewmates" | "board">,
): string {
  const mate = crew.crewmates.find((candidate) => candidate.handle === row.handle);
  const name = mate?.displayName ?? (row.handle === null ? "The crew" : `@${row.handle}`);
  const task = crew.board.tasks.find((candidate) => candidate.id === row.taskId);
  switch (row.kind) {
    case "question":
      return row.text === null ? `${name} asks a question` : `${name} asks: ${row.text}`;
    case "landing-wait":
      return `${name}'s landing waits: ${pathSummary(row.paths)} ${row.paths.length > 1 ? "are" : "is"} edited in your tree`;
    case "ready-to-land":
      return task === undefined
        ? `${name}'s work is ready to land`
        : `${name}'s #${task.number} is ready to land`;
    case "plan": {
      const count = crew.board.tasks.filter((candidate) => candidate.state === "proposed").length;
      return `${name} proposes ${count} ${count === 1 ? "task" : "tasks"}`;
    }
    case "show-on-dev":
      return `${name} asks to show its work on ${row.host ?? "dev"}`;
    case "parked":
      return row.text === null ? `${name} stopped` : `${name} stopped: ${row.text}`;
    case "cant-start":
      return row.text === null ? `Can't start ${name}` : `Can't start ${name}: ${row.text}`;
    case "conflict":
      return `${name}'s copy conflicts with what landed: ${pathSummary(row.paths)}`;
    case "check-failed":
      return `${name}'s check failed`;
  }
}

const REFUSALS: Readonly<Record<CrewRefusalReason, string>> = {
  unavailable: "Crew mode is off in this Mate",
  "no-crew": "No crew is set up yet",
  "invalid-definition": "The crew files need a fix",
  "handle-taken": "That handle is already taken",
  "no-free-disk": "The service has no free disk for another copy of the code",
  "database-undeclared":
    "A crewmate on a service with a database needs `env:` or `database: shared`",
  "no-mention": "Name a crewmate with @, or add a lead to split the work",
  "unknown-crewmate": "There is no such crewmate on the crew",
  "unknown-task": "That task is no longer on the board",
  "wrong-state": "That can't be done in its current state",
  "not-allowed": "You can't start this crewmate's turn",
  "unlanded-commits": "Its copy of the code has commits that never landed",
  "login-needs-fresh": "A different login needs a fresh conversation",
  io: "The crew files could not be read or saved",
};

/** A refused command or files request as one sentence, with the engine's detail after a colon. */
export function crewRefusalSentence(reason: CrewRefusalReason, detail: string | null): string {
  const base = REFUSALS[reason];
  return detail === null ? `${base}.` : `${base}: ${detail.replace(/\.$/u, "")}.`;
}

/** A crewmate's copy of the code in a few words (PRD §4.3 item 5); `null` when there is nothing to say. */
export function crewLaneWord(lane: CrewLaneSummary): string | null {
  switch (lane.state) {
    case "creating":
      return "Creating its copy of the code";
    case "setting-up":
      return lane.detail === null ? "Setting up its copy" : `Running ${lane.detail}`;
    case "conflicts":
      return "Conflicts";
    case "frozen":
      return "Its service is redeploying";
    case "missing":
      return "Its copy is missing";
    case "failed":
      return lane.detail === null ? "Its copy failed" : `Its copy failed: ${lane.detail}`;
    case "ready":
      return lane.ahead === 0 ? null : `${lane.ahead} ahead`;
  }
}

/**
 * "v5 at next turn" (PRD §5.6): the job's version when it changed, else the
 * brief's; `null` for a crewmate whose prompt is current.
 */
export function crewPendingWord(pending: {
  readonly brief: number | null;
  readonly job: number | null;
}): string | null {
  if (pending.job !== null) return `v${pending.job} at next turn`;
  return pending.brief === null ? null : `Brief v${pending.brief} at next turn`;
}

/** Apply's word for one crewmate (PRD §4.7): its copy being created, set up, failed, or ready. */
export function crewApplyWord(mate: Pick<Crewmate, "displayName" | "lane">): string {
  const lane = mate.lane;
  if (lane === null) return "Ready";
  switch (lane.state) {
    case "creating":
      return `Creating ${mate.displayName}'s copy of the code`;
    case "setting-up":
      return lane.detail === null ? "Setting up its copy" : `Running ${lane.detail}`;
    case "missing":
    case "failed":
      return lane.detail ?? "Its copy failed";
    case "ready":
    case "conflicts":
    case "frozen":
      return "Ready";
  }
}

/** The section footer's way to the board (PRD §4.3 item 8). */
export const crewBoardLinkWord = (count: number): string =>
  `Board · ${count} ${count === 1 ? "task" : "tasks"}`;

export const crewLandedWord = (count: number): string => `Landed, not delivered · ${count}`;

/**
 * Why a crewmate that changes files has no service to pick: the Mate has not
 * mounted a dev service yet, which its develop flow does first.
 */
export const crewNoDevHostWord = (mateName: string): string =>
  `No dev service is mounted yet — ask ${mateName} to start development first.`;

/** The Brief row while the brief is still the template's placeholder, or empty. */
export const CREW_BRIEF_EMPTY_WORD = "Describe what the crew builds";

/**
 * The brief's excerpt as the Brief row shows it (PRD §4.3 item 3): markdown
 * read as plain text — heading lines dropped, list, quote and emphasis markers
 * stripped — at most two lines.
 */
export function crewBriefPlainText(excerpt: string): string {
  return excerpt
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/u, "")
        .replace(/\*\*|__|`/gu, "")
        .trim(),
    )
    .filter((line) => line !== "")
    .slice(0, 2)
    .join("\n");
}

/** The run dialog resuming a run its budget or time limit stopped. */
export const CREW_RESUME_TITLE = "Resume the run";

/** Under a budget that would stop the run again at once. */
export const crewResumeBudgetHint = (spentUsd: number): string =>
  `Raise it above the ${dollars(spentUsd, true)} already spent, or pick No limit.`;

/** Under a time limit the run has already used up. */
export const crewResumeTimeHint = (elapsedMs: number): string =>
  `Raise it past the ${formatCrewDuration(elapsedMs)} already run, or pick No limit.`;

/** The section's second group of rows, after the lead's (`CREW_LEAD_WORD`). */
export const CREW_CREWMATES_WORD = "Crewmates";

/** Which crewmates run on a login, the lead named as the lead. */
export function crewLoginRunsWord(crewmates: ReadonlyArray<string>, lead: string | null): string {
  return `Runs: ${crewmates.map((handle) => (handle === lead ? `${handle} (lead)` : handle)).join(", ")}`;
}

/** A dev service without crew ports (PRD §5.7). */
export const crewPortsOffWord = (host: string): string => `${host} · Crew ports: off`;

/** What a dev service serves; `null` while nobody can say. */
export function crewServedWord(
  host: CrewHost,
  crewmates: ReadonlyArray<Pick<Crewmate, "handle" | "displayName">>,
): string | null {
  switch (host.served.by) {
    case "tree":
      return `${host.host} serves: your tree`;
    case "crewmate": {
      const handle = host.served.handle;
      const name = crewmates.find((mate) => mate.handle === handle)?.displayName ?? `@${handle}`;
      return `${host.host} serves: ${name}'s copy`;
    }
    case "unknown":
      return null;
  }
}

/** *Waiting on you*'s presses (PRD §4.3 item 4, §5.2). */
export const CREW_ATTENTION_VERBS = {
  answer: "Answer",
  commitEdit: "Commit my edit",
  land: "Land",
  reviewPlan: "Review plan",
  allow: "Allow",
  notNow: "Not now",
  tryAgain: "Try again",
} as const;

export const crewAskToResolveWord = (name: string): string => `Ask ${name} to resolve`;

export const crewAskToFixWord = (name: string): string => `Ask ${name} to fix`;

/** `a.ts`, `a.ts and b.ts`, `a.ts, b.ts and c.ts`. */
function pathList(paths: ReadonlyArray<string>): string {
  if (paths.length <= 1) return paths[0] ?? "";
  return `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;
}

/** *Commit my edit* (CONCEPT §3.2): a local commit that pushes nothing, so a waiting landing can go. */
export function crewCommitEditAsk(paths: ReadonlyArray<string>): string {
  return paths.length > 1
    ? `Commit my edits to ${pathList(paths)} locally, without pushing: a crew landing waits on them.`
    : `Commit my edit to ${pathList(paths)} locally, without pushing: a crew landing waits on it.`;
}

/**
 * *Deliver* (CONCEPT §3.2): the landed tasks not yet delivered, and the paths
 * dirty in your tree that no landing produced, which ship too.
 */
export function crewDeliverAsk(
  crew: Pick<CrewSnapshot, "board" | "hosts">,
  dirtyPaths: ReadonlyArray<string>,
): string {
  const hosts = crew.hosts.map((host) => host.host).join(" and ");
  const titles = crew.board.tasks
    .filter((task) => task.state === "landed" && !task.delivered)
    .map((task) => `#${task.number} ${task.title}`)
    .join(", ");
  const ship = `Ship the crew's landed work${hosts === "" ? "" : ` on ${hosts}`}: ${titles}.`;
  return dirtyPaths.length === 0
    ? ship
    : `${ship} My own edits in ${pathList(dirtyPaths)} ship too.`;
}

/** *Add crew ports* (PRD §5.7), for the ports the engine reserved. */
export function crewPortsAsk(host: string, ports: ReadonlyArray<number>): string {
  const first = ports[0];
  if (ports.length === 1 && first !== undefined) {
    return `Add crew port ${first} (httpSupport) to ${host}'s dev setup in zerops.yaml, self-deploy ${host}, then make sure the new port is routed on the subdomain.`;
  }
  return `Add crew ports ${first}–${ports.at(-1)} (httpSupport) to ${host}'s dev setup in zerops.yaml, self-deploy ${host}, then make sure each new port is routed on the subdomain.`;
}

/** *Describe it to Fen* (PRD §4.7). */
export const crewDescribeAsk = (description: string): string =>
  `Set up a crew for this project: ${description.trim()}`;

/** A copy of the code against your tree (PRD §4.5); `null` while level with it. */
export const crewAheadWord = (ahead: number): string | null =>
  ahead === 0 ? null : `${ahead} ${ahead === 1 ? "change" : "changes"} ahead of your tree`;

/** `+214 −12`, with a true minus. */
export const crewDiffStatWord = (stat: {
  readonly insertions: number;
  readonly deletions: number;
}): string => `+${stat.insertions} \u2212${stat.deletions}`;

/** A merge-in stopped on unmerged paths (PRD §5.2). */
export const crewConflictWord = (paths: ReadonlyArray<string>): string =>
  paths.length === 0
    ? "Conflicts with what landed"
    : `Conflicts with what landed: ${pathSummary(paths)}`;

/** A task's landing in your tree, by its commit's short sha (PRD §4.5). */
export const crewLandedAsWord = (task: {
  readonly number: number;
  readonly landedCommit: string;
}): string => `Task #${task.number} landed as ${task.landedCommit.slice(0, 7)}`;

/** A crewmate's own app on its crew port (PRD §5.7). */
export function crewAppWord(
  app:
    | { readonly kind: "running"; readonly port: number }
    | { readonly kind: "stopped" }
    | { readonly kind: "no-crew-ports"; readonly host: string }
    | { readonly kind: "no-free-port" },
): string {
  switch (app.kind) {
    case "running":
      return `App on :${app.port}`;
    case "stopped":
      return "App stopped";
    case "no-crew-ports":
      return `No crew ports on ${app.host}`;
    case "no-free-port":
      return "No free crew port";
  }
}

/** The lane bar's presses beside *Land* (`CREW_ATTENTION_VERBS.land`) and the asks. */
export const CREW_LANE_VERBS = {
  showOnDev: "Show on dev",
  backToTree: "Back to my tree",
  landNow: "Land now",
  addCrewPorts: "Add crew ports",
} as const;

const TASK_SOURCES: Readonly<Record<CrewTaskSource, string>> = {
  you: "from you",
  lead: "from lead",
  message: "from a message",
  issue: "from an issue",
};

/** Where a task came from (PRD §4.4, §4.5). */
export const crewTaskSourceWord = (source: CrewTaskSource): string => TASK_SOURCES[source];

/** The header's version chip while the crewmate runs on its current job (PRD §4.5). */
export const crewJobVersionWord = (version: number): string => `Job v${version}`;

/** One of a crewmate's conversations, for *Previous conversations*. */
export const crewStintWord = (stint: number, current: boolean): string =>
  current ? `Conversation ${stint} · current` : `Conversation ${stint}`;

/** A crewmate chat's composer. */
export const crewMessagePlaceholder = (name: string): string => `Message ${name}…`;

const NEXT_TURN_FRESH = "the next turn starts a fresh conversation";

/**
 * What a pending prompt does (PRD §5.6 with the probe-22 fallback: a resumed
 * session keeps the prompt it began with); `null` while nothing is pending.
 */
export function crewPendingNotice(pending: {
  readonly brief: number | null;
  readonly job: number | null;
}): string | null {
  const { brief, job } = pending;
  if (job !== null && brief !== null) {
    return `Job updated to v${job} and brief to v${brief} — ${NEXT_TURN_FRESH}`;
  }
  if (job !== null) return `Job updated to v${job} — ${NEXT_TURN_FRESH}`;
  return brief === null ? null : `Brief updated to v${brief} — ${NEXT_TURN_FRESH}`;
}

/** An earlier conversation with a crewmate: where it goes on, and why nothing is sent from it. */
export const crewEarlierStintNotice = (
  handle: string,
): { readonly text: string; readonly sendBlock: string } => ({
  text: `An earlier conversation with @${handle} — it goes on in a newer one.`,
  sendBlock: `Write to @${handle} in its current conversation`,
});

/** A stint that began without a reason of its own, and the link to the one before it. */
export const CREW_NEW_STINT_WORD = "New conversation";
export const CREW_PREVIOUS_STINT_LINK = "previous conversation";

/** Whether a dev service reaches a database (the crewmate editor's *Service*); `null` is unknown, never "no". */
export function crewDevHostDatabaseWord(database: boolean | null): string {
  if (database === null) return "Database unknown";
  return database ? "Has a database" : "No database";
}

/** The lead's mark beside its name (PRD §2.3, §4.6), and its accessible name in the strip. */
export const CREW_LEAD_WORD = "Lead";

/** What the lead does, where a writer's chat shows its copy of the code (PRD §4.6). */
export const CREW_LEAD_ROLE_LINE = "Plans and reviews · no copy of the code";

/** What a crewmate runs on (PRD §2.3 *Runs on*), its login's defaults left out. */
export function crewRunsOnWord(runsOn: {
  readonly login: string;
  readonly model: string | null;
  readonly effort: string | null;
}): string {
  return ["Runs on " + runsOn.login, runsOn.model, runsOn.effort]
    .filter((part) => part !== null)
    .join(" · ");
}
