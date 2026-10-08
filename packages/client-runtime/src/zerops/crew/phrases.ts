/**
 * Crew mode's phrase producer (R5): every word a crew surface shows — the
 * Crew tab's head, rows, plan, "In Fen's code", its views (setup, the goal, a
 * crewmate's job) and dialogs; a crewmate's face and menu on the
 * conversation's line; its chat's notices; refusal sentences; and the drafts
 * a crew surface hands the Mate. A crew surface renders crew words only from
 * here; a thread's own status still comes only from `resolveThreadStatus`.
 *
 * The words are the person's, never the engine's (the owner, 2026-09-29: the
 * crew's version chips, @handles, task states and board columns "absolute
 * shit"): no version, handle, task number, branch or state word, and the
 * Mate's code is its code — "Fen's code" — wherever the engine says "your
 * tree". Every line names the Mate it was handed.
 *
 * Pure: no clock, no I/O; every fact arrives from the crew snapshot.
 */
import type {
  CrewAttention,
  CrewHost,
  CrewLaneSummary,
  CrewRefusalReason,
  CrewRun,
  CrewRunOptions,
  CrewSnapshot,
  CrewTask,
  Crewmate,
} from "@t3tools/contracts";
import { GITHUB_ALERT_WORDS, quoteWords } from "@t3tools/shared/messagePreview";

/* ------------------------------------------------------------ helpers */

/** "Game systems'" and "Lead's": whose, in plain English. */
export const crewPossessive = (name: string): string =>
  name.endsWith("s") ? `${name}'` : `${name}'s`;

/** `1 h 12 m`, `45 m`, `8 h`. */
function formatCrewDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

/** `$20`, `$6.40`: whole dollars bare, anything else — and a spend — to the cent. */
const dollars = (amount: number, cents = false): string =>
  cents || !Number.isInteger(amount) ? `$${amount.toFixed(2)}` : `$${amount}`;

/** `8 hours`, `an hour`, `1.5 hours`. */
const hoursWord = (hours: number): string => (hours === 1 ? "an hour" : `${hours} hours`);

/** A sentence of the engine's words, or the person's: capitalised, ended. */
function sentence(words: string): string {
  const said = words.trim();
  if (said === "") return said;
  const capital = `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
  return /[.!?…]$/u.test(capital) ? capital : `${capital}.`;
}

/** Someone's words after a colon — the engine's, a crewmate's — as written, ended. */
function clause(words: string): string {
  const said = words.trim();
  return said === "" || /[.!?…]$/u.test(said) ? said : `${said}.`;
}

/** A path as the person reads it: its file's name. */
const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** `hud.ts`, or `hud.ts and 2 more` — by name, or by path where which file matters. */
function filesWord(paths: ReadonlyArray<string>, whole = false): string {
  const [first, ...rest] = paths;
  if (first === undefined) return "a file";
  const said = whole ? first : fileName(first);
  return rest.length === 0 ? said : `${said} and ${rest.length} more`;
}

/* ------------------------------------------------------------ the run */

/** A run is on while it is running or paused; its options govern only then. */
const isRunOn = (run: CrewRun | null): run is CrewRun =>
  run !== null && (run.state === "running" || run.state === "paused");

/** Whether a finished task waits for your review: always without a run on, else per its option. */
export function crewPersonLands(run: CrewRun | null): boolean {
  return !isRunOn(run) || run.options.landing === "person";
}

/** The mode line while no run is on and nobody works. */
export const CREW_WORKS_WHEN_ASKED = "Works when you give it something to do";

/** The mode line while no run is on and someone works. */
export const CREW_WORKING_WITH_YOU = "Working with you · finished work waits for your review";

/** The mode line while a run ends. */
export const CREW_WRAPPING_UP = "Wrapping up";

/** "Working on its own · $6.40 of $20 · 1 h 12 m of 8 h": the run as it goes. */
export function crewOnItsOwnWords(
  run: Pick<CrewRun, "spentUsd" | "elapsedMs" | "options">,
): string {
  const { budgetUsd, timeLimitHours } = run.options;
  const spent = dollars(run.spentUsd, true);
  const time = formatCrewDuration(run.elapsedMs);
  return [
    "Working on its own",
    budgetUsd === "unlimited" ? `${spent} spent` : `${spent} of ${dollars(budgetUsd)}`,
    timeLimitHours === "unlimited" ? time : `${time} of ${timeLimitHours} h`,
  ].join(" · ");
}

const STOPPED = "Stopped working on its own";

/**
 * Why a run stopped working on its own, as its mode line says it. Its time
 * running out says what it spent — and nothing about money when that comes
 * to less than a cent.
 */
export function crewStoppedWords(
  run: Pick<CrewRun, "reason" | "reasonDetail" | "spentUsd" | "usagePercent" | "options">,
): string {
  const { budgetUsd, timeLimitHours, stopAtUsagePercent } = run.options;
  switch (run.reason) {
    case "budget":
      return budgetUsd === "unlimited"
        ? `${STOPPED}: it spent ${dollars(run.spentUsd, true)}`
        : `${STOPPED}: it spent its ${dollars(budgetUsd)}`;
    case "time": {
      const why =
        timeLimitHours === "unlimited"
          ? STOPPED
          : timeLimitHours === 1
            ? `${STOPPED}: its hour is up`
            : `${STOPPED}: its ${timeLimitHours} hours are up`;
      return Math.round(run.spentUsd * 100) === 0
        ? why
        : `${why}. It spent ${dollars(run.spentUsd, true)}.`;
    }
    case "usage": {
      const percent = stopAtUsagePercent ?? Math.round(run.usagePercent ?? 0);
      return `${STOPPED}: your Claude plan is at ${percent} %`;
    }
    case "refused":
      return run.reasonDetail === null || run.reasonDetail.trim() === ""
        ? STOPPED
        : `${STOPPED}: ${run.reasonDetail.trim()}`;
    case "person":
    case null:
      return STOPPED;
  }
}

/** The mode line's one press, and the line saying what each does. */
export const CREW_MODE_PRESS = {
  letItWork: "Let it work on its own…",
  stop: "Stop",
  keepGoing: "Keep going…",
  tryAgain: "Try again",
} as const;

export const CREW_MODE_PRESS_LINES = {
  letItWork: "It carries on without asking, within your limits.",
  stop: "Everyone stops where they are. Their work is kept.",
  keepGoing: "More money or time, and it carries on.",
  tryAgain: "It carries on where it stopped.",
} as const;

/* ------------------------------------------------------------ the run dialog */

export const CREW_RUN_TITLE = "Let the crew work on its own";

export const CREW_RUN_LINE =
  "It keeps going without asking you at each step, and stops by itself at whichever limit it reaches first.";

/** The run dialog resuming a run that stopped. */
export const CREW_RESUME_TITLE = "Keep going";

export const CREW_RUN_WORDS = {
  spent: "Stop when it has spent",
  after: "Stop after",
  hours: "hours",
  noLimit: "No limit",
  moreMoney: "Give it more money",
  moreTime: "Give it more time",
  more: "more",
  hoursMore: "hours more",
  usageFurther: "Stop before it uses more than",
  usageOf: "% of your Claude plan's limit",
  whenDone: "When a piece of work is done",
  waitForMe: "Wait for my review",
  leadMayStart: "The lead may start its own tasks without asking",
  start: "Start",
  keepGoing: "Keep going",
  cancel: "Cancel",
} as const;

/** The usage stop, at its percent. */
export const crewUsageStopWord = (percent: number): string =>
  `Stop before it uses more than ${percent} % of your Claude plan's limit`;

/** "When a piece of work is done": each choice, and the line under it. */
export function crewLandingWords(
  mode: CrewRunOptions["landing"],
  mateName: string,
): { readonly label: string; readonly line: string } {
  switch (mode) {
    case "person":
      return {
        label: CREW_RUN_WORDS.waitForMe,
        line: `It waits in the Crew tab: Review it, try it, add it to ${crewPossessive(mateName)} code.`,
      };
    case "lead":
      return {
        label: `Add it to ${crewPossessive(mateName)} code once the lead approves it`,
        line: "The lead checks each piece and sends back what isn't right.",
      };
    case "check":
      return {
        label: `Add it to ${crewPossessive(mateName)} code once its checks pass`,
        line: "Nothing goes in while its checks fail.",
      };
  }
}

/** The dev grant, in the Mate's name. */
export const crewDevGrantWord = (mateName: string): string =>
  `Crewmates may show their work at ${crewPossessive(mateName)} dev address without asking`;

/** Resuming a run its budget stopped. */
export const crewResumeBudgetHint = (spentUsd: number, budgetUsd: number): string =>
  `It spent ${dollars(spentUsd, true)} of ${dollars(budgetUsd)}. Give it more, or no limit.`;

/** Resuming a run its time limit stopped. */
export const crewResumeTimeHint = (hours: number): string =>
  hours === 1
    ? "Its hour is up. Give it more time, or no limit."
    : `Its ${hours} hours are up. Give it more time, or no limit.`;

/** Keeping going after the usage stop: raise it, or turn it off. */
export const crewResumeUsageHint = (percent: number): string =>
  `Your Claude plan is at ${percent} %. Let it go further, or turn the stop off.`;

/** Keeping going after any other stop: within the limits it had. */
export function crewKeepGoingLine(
  options: Pick<CrewRunOptions, "budgetUsd" | "timeLimitHours">,
): string {
  const { budgetUsd, timeLimitHours } = options;
  if (budgetUsd === "unlimited" && timeLimitHours === "unlimited") {
    return "It carries on, with no limits.";
  }
  const money = budgetUsd === "unlimited" ? "no spending limit" : `up to ${dollars(budgetUsd)}`;
  const time =
    timeLimitHours === "unlimited"
      ? "with no time limit"
      : `for up to ${hoursWord(timeLimitHours)}`;
  return `It carries on within its limits: ${money}, ${time}.`;
}

/* ------------------------------------------------------------ the head */

/** The goal's title while the crew has none of its own yet. */
export const CREW_BRIEF_EMPTY_WORD = "What's the crew for?";

/** A callout's word as `quoteWords` leaves it, alone on the line its marker stood on. */
const CALLOUT_WORD_LINES = new Set(Array.from(GITHUB_ALERT_WORDS.values(), (word) => `${word}:`));

/**
 * The goal's text as its title's tooltip reads it: markdown read as plain
 * text — heading lines dropped, list, quote and emphasis markers stripped, a
 * callout's word run into its first line as a Mate's message reads it
 * (`quoteWords`) — at most two lines.
 */
export function crewBriefPlainText(excerpt: string): string {
  const lines = quoteWords(excerpt)
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "")
        .replace(/\*\*|__|`/gu, "")
        .trim(),
    )
    .filter((line) => line !== "");
  const read: Array<string> = [];
  for (const line of lines) {
    const word = read.at(-1);
    if (word !== undefined && CALLOUT_WORD_LINES.has(word))
      read[read.length - 1] = `${word} ${line}`;
    else read.push(line);
  }
  return read.slice(0, 2).join("\n");
}

/** The tab's ···, a crewmate's ··· and its ⌄ on the conversation's line: each press. */
export const CREW_MENU = {
  tryWork: "Try its work",
  stopApp: "Stop its app",
  changeJob: "Change its job",
  changeGoal: "Change the goal",
  clearConversation: "Clear its conversation",
  removeFromCrew: "Remove from the crew",
  addCrewmate: "Add a crewmate",
  letItWork: CREW_MODE_PRESS.letItWork,
} as const;

/** The line under a press in a crew menu, saying what it does. */
export const CREW_MENU_LINES = {
  changeJob: "What it's responsible for.",
  changeGoal: "What the whole crew works toward.",
  clearConversation: "It keeps its job and its work.",
  addCrewmate: "Someone new, with a job of its own.",
  letItWork: CREW_MODE_PRESS_LINES.letItWork,
} as const;

/** *Remove from the crew*'s line. */
export const crewRemoveLine = (mateName: string): string =>
  `It leaves the crew. You decide about work not in ${crewPossessive(mateName)} code yet.`;

/** The tab's ··· as a button names it. */
export const CREW_MENU_LABEL = "The crew's menu";

/* ------------------------------------------------------------ the composer */

export const CREW_COMPOSER_PLACEHOLDER = "Give the crew something to do…";

/** While a plan waits for Start, a message changes it. */
export const CREW_COMPOSER_PLAN_PLACEHOLDER = "Tell the lead what to change…";

/** Who a message to the crew goes to: "To Lead", or "To" and faces without a lead. */
export const crewToWord = (name: string): string => `To ${name}`;
export const CREW_TO_WORD = "To";

export const CREW_TO_LEAD_LINE =
  "The lead splits it into tasks and shows you the plan before anyone starts.";

/** Without a lead, the faces a message goes to. */
export const CREW_TO_PICK_LINE = "Each one you pick gets it as a task of its own.";

/** The send button, named for whom it sends to. */
export const crewSendToWord = (name: string | null): string =>
  name === null ? "Send to the crew" : `Send to ${name}`;

/* ------------------------------------------------------------ a crew closed to you (D6) */

/**
 * What stands in the composer's place for a viewer who may not run the crew:
 * the conversation's own words (`agentOwnershipComposerNotice`, pinned to
 * these by the phrases' test), the crew named where the conversation names
 * its agent — in the Crew tab the crew is what they may not run — its dash
 * held to the word before it, so no line starts with it. Why nobody runs it
 * reads as the conversation says it.
 */
export function crewLockWords(ownership: "someone-else" | "unrecorded"): string {
  switch (ownership) {
    case "someone-else":
      return "Signed in by another project member\u00a0— only they can run this crew.";
    case "unrecorded":
      return "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it.";
  }
}

/** The notice's one way out, the conversation's (`AGENT_OWNERSHIP_RECOVERY_LABEL`): the viewer's own sign-in. */
export const CREW_LOCK_ACTION = "Sign in with your own account";

/* ------------------------------------------------------------ the rows */

/** A row opens its crewmate's conversation. */
export const crewOpenConversationWord = (name: string): string =>
  `Open ${crewPossessive(name)} conversation`;

/** A crewmate's menu, named for it. */
export const crewMenuOfWord = (name: string): string => `${crewPossessive(name)} menu`;

/** What a crewmate will do after what it is on now. */
export const CREW_NEXT_WORD = "Next";

/** Finished work, still in the crewmate's own copy. */
export const crewReadyWords = (mateName: string): string =>
  `Done, in its own copy · not in ${crewPossessive(mateName)} code yet`;

/** Its work is being checked on the tree it would go into. */
export const CREW_CHECKING_ITS_WORK = "Checking its work";

/** Reported done, and someone checks it. */
export const crewDoneCheckedWord = (hasLead: boolean): string =>
  hasLead ? "Done · the lead is checking it" : "Done · waiting for its review";

/** Finished, and a run puts it in by itself. */
export const crewDoneGoingInWord = (mateName: string): string =>
  `Done · going into ${crewPossessive(mateName)} code`;

/** Its work goes into the Mate's code right now. */
export const crewGoingInWord = (mateName: string): string =>
  `Going into ${crewPossessive(mateName)} code`;

/** A question the lead takes first. */
export const crewAskedLeadWord = (question: string | null): string =>
  question === null || question.trim() === ""
    ? "Asked the lead a question"
    : `Asked the lead: ${question.trim()}`;

/** Sent back, while a run sends it on at once. */
export const crewSentBackWord = (reason: string | null): string =>
  reason === null || reason.trim() === "" ? "Sent back" : `Sent back: ${reason.trim()}`;

/** The lead's second line while it works: what it is on. */
export const crewLeadCheckingWord = (title: string): string => `Checking ${title}`;
export const crewLeadAnsweringWord = (name: string): string =>
  `Answering ${crewPossessive(name)} question`;

/** Apply's word for a crewmate while its copy is made. */
export const CREW_COPY_READYING = "Getting its copy ready…";

/** A broken copy, in red; `null` for a copy that is fine or on its way. */
export function crewBrokenCopyWord(
  lane: Pick<CrewLaneSummary, "state" | "detail">,
  mateName: string,
): string | null {
  const copy = `Its copy of ${crewPossessive(mateName)} code`;
  switch (lane.state) {
    case "missing":
      return `${copy} is missing`;
    case "failed":
      return lane.detail === null || lane.detail.trim() === ""
        ? `${copy} failed`
        : `${copy} failed: ${lane.detail.trim()}`;
    case "creating":
    case "setting-up":
    case "ready":
    case "conflicts":
    case "frozen":
      return null;
  }
}

/** The first task `task` depends on that will not land: dropped or stopped. */
export const crewGoneDependency = (
  task: Pick<CrewTask, "dependsOn">,
  tasks: ReadonlyArray<CrewTask>,
): CrewTask | undefined =>
  task.dependsOn
    .map((id) => tasks.find((entry) => entry.id === id))
    .find((entry) => entry?.state === "discarded" || entry?.state === "parked");

/**
 * What a crewmate needs from you, as its row's line says it — the row names
 * the crewmate and the task, so the line says only what happened. Every line
 * is a sentence; a ready task's is the finished work's line
 * (`crewReadyWords`), and a plan is the lead's plan block, so neither is here.
 */
export function crewNeedSentence(
  row: CrewAttention,
  crew: Pick<CrewSnapshot, "crewmates" | "board" | "hosts">,
  mateName: string,
): string {
  const mate = crewPossessive(mateName);
  const task = crew.board.tasks.find((candidate) => candidate.id === row.taskId);
  switch (row.kind) {
    case "interrupted":
      return (
        (row.operation?.status === "failed" ? "Stopped · " : "Interrupted · ") +
        (row.text ?? "Its work stays in its copy.")
      );
    case "copy-missing":
      return "Its crew copy is missing";
    case "conversation-copy":
      return "Conversation points elsewhere";
    case "deploy-unreadable":
      return `The redeploy of ${row.host ?? "its service"} can't be read. Thaw it if it ended.`;
    case "question":
      return row.text === null || row.text.trim() === ""
        ? "It asks you something."
        : sentence(row.text);
    case "landing-wait":
      return `Can't go into ${mate} code yet: ${mateName} has uncommitted edits to ${filesWord(row.paths)}.`;
    case "ready-to-land":
      return crewReadyWords(mateName);
    case "plan":
      return "The lead has a plan.";
    case "show-on-dev":
      return crew.hosts.find((host) => host.host === row.host)?.claim.grantWaiting === true
        ? `Shows its work at ${mate} dev address once its current step ends.`
        : `Wants to show its work at ${mate} dev address.`;
    case "parked":
      return row.text === null ? "Stopped." : `Stopped: ${clause(row.text)}`;
    case "cant-start":
      return row.text === null ? "Couldn't start." : `Couldn't start: ${clause(row.text)}`;
    case "conflict":
      return row.paths.length === 0
        ? `Clashes with what's now in ${mate} code.`
        : `Clashes with what's now in ${mate} code, in ${filesWord(row.paths, true)}.`;
    case "check-failed":
      return row.text === null ? "Its checks fail." : `Its checks fail: ${clause(row.text)}`;
    case "stalled":
      // The crew stopping says when ("when the $20 ran out"); anything else says why.
      if (row.text === null) return "Stopped mid-way.";
      return row.text.startsWith("when ")
        ? `Stopped mid-way ${clause(row.text)}`
        : `Stopped mid-way: ${clause(row.text)}`;
    case "review-wait":
      return crew.crewmates.some((candidate) => candidate.kind === "lead")
        ? "Waits for the lead's review."
        : "Waits for its review.";
    case "dependency-gone": {
      const gone = task === undefined ? undefined : crewGoneDependency(task, crew.board.tasks);
      if (gone === undefined) return "Waits for work that won't go in.";
      return gone.state === "discarded"
        ? `Waits for ${gone.title}, which was dropped.`
        : `Waits for ${gone.title}, which stopped.`;
    }
    case "sent-back": {
      const by = task?.review?.by;
      const reviewer =
        by === null
          ? "You"
          : by === undefined ||
              crew.crewmates.find((candidate) => candidate.handle === by)?.kind === "lead"
            ? "The lead"
            : (crew.crewmates.find((candidate) => candidate.handle === by)?.displayName ??
              "Its reviewer");
      return row.text === null || row.text.trim() === ""
        ? `${reviewer} sent it back.`
        : `${reviewer} sent it back: ${clause(row.text)}`;
    }
  }
}

/** What a row lets you press about what it needs. */
export const CREW_ROW_VERBS = {
  rebuildCopy: "Rebuild crew copy",
  useCrewCopy: "Use crew copy",
  thawHost: "Thaw it",
  answer: "Answer",
  review: "Review",
  reviewWhatItHas: "Review what it has",
  reviewItYourself: "Review it yourself",
  tryIt: "Try it",
  letIt: "Let it",
  notNow: "Not now",
  tryAgain: "Try again",
  carryOn: "Continue",
  dropIt: "Drop it",
  startAnyway: "Start it anyway",
  askTheLead: "Ask the lead",
  askToRework: "Ask it to rework",
  askToFix: "Ask it to fix them",
  askToSortOut: "Ask it to sort it out",
  send: "Send",
} as const;

/** The press that asks the Mate to commit its own edits, so the crew's work can go in. */
export const crewAskToCommitWord = (mateName: string): string => `Ask ${mateName} to commit them`;

/** *Back to Fen's*: the Mate's dev address shows its own code again. */
export const crewBackToMateWord = (mateName: string): string =>
  `Back to ${crewPossessive(mateName)}`;

/** The line under — the tooltip of — each of a row's presses. */
export function crewRowVerbLine(
  verb: keyof typeof CREW_ROW_VERBS | "askToCommit" | "backToMate",
  mateName: string,
): string {
  const mate = crewPossessive(mateName);
  switch (verb) {
    case "rebuildCopy":
      return "Rebuilds this copy from its saved work. It leaves other copies alone.";
    case "useCrewCopy":
      return "This conversation uses its crew copy.";
    case "thawHost":
      return "Its crew copies thaw and carry on. Only if the redeploy ended.";
    case "answer":
      return "Write your answer right here.";
    case "review":
      return `See what changed, then add it to ${mate} code.`;
    case "reviewWhatItHas":
      return `See what it has so far, and add it to ${mate} code as it is.`;
    case "reviewItYourself":
      return `See what changed, and add it to ${mate} code yourself.`;
    case "tryIt":
      return `Opens its copy of the app. Nothing is in ${mate} code yet.`;
    case "letIt":
      return `It shows its work at ${mate} dev address.`;
    case "notNow":
      return `${mate} dev address keeps showing ${mate} code.`;
    case "tryAgain":
      return "It starts again.";
    case "carryOn":
      return "Carries on where it stopped.";
    case "dropIt":
      return `This task never goes into ${mate} code.`;
    case "startAnyway":
      return "It stops waiting for work that was dropped.";
    case "askTheLead":
      return "A message from you asking the lead to check it.";
    case "askToRework":
      return "Sends it the lead's note, and it works on it again.";
    case "askToFix":
      return "One message from you, carrying what failed. It fixes it in its own copy.";
    case "askToSortOut":
      return "One message from you, carrying the clash. It sorts it out in its own copy.";
    case "send":
      return "Sends your answer.";
    case "askToCommit":
      return `${mateName} commits its own edits, so the crew's work can go in.`;
    case "backToMate":
      return `${mate} dev address shows ${mate} code again.`;
  }
}

/** What the Mate's dev address shows, while a crewmate's work is shown there; `null` otherwise. */
export function crewServedWord(
  host: CrewHost,
  crewmates: ReadonlyArray<Pick<Crewmate, "handle" | "displayName">>,
  mateName: string,
): string | null {
  if (host.served.by !== "crewmate") return null;
  const handle = host.served.handle;
  const name = crewmates.find((mate) => mate.handle === handle)?.displayName;
  return name === undefined
    ? `${crewPossessive(mateName)} dev address shows a crewmate's work`
    : `${crewPossessive(mateName)} dev address shows ${crewPossessive(name)} work`;
}

/* ------------------------------------------------------------ the lead's plan */

export const CREW_PLAN_VERBS = {
  start: "Start",
  change: "Change",
  drop: "Drop the plan",
  leaveOut: "Leave this one out",
} as const;

export const CREW_PLAN_LINES = {
  drop: "Nobody starts on it.",
  change: "How much it may spend, and for how long.",
} as const;

/** A planned task that waits for another: "after Season clock on the server". */
export const crewAfterWord = (title: string): string => `after ${title}`;

/**
 * What Start lets the crew do, said before the button: the limits it runs
 * under — the run's, or the last run's — or, with no run yet, that Start asks.
 */
export function crewPlanStartLine(
  options: Pick<CrewRunOptions, "budgetUsd" | "timeLimitHours"> | null,
): string {
  if (options === null) return "Start asks how much it may spend and for how long.";
  const { budgetUsd, timeLimitHours } = options;
  if (budgetUsd === "unlimited" && timeLimitHours === "unlimited") {
    return "Start lets the crew work on its own, with no limits.";
  }
  const money = budgetUsd === "unlimited" ? "no spending limit" : `up to ${dollars(budgetUsd)}`;
  const time =
    timeLimitHours === "unlimited"
      ? "with no time limit"
      : `for up to ${hoursWord(timeLimitHours)}`;
  return `Start lets the crew work on its own: ${money}, ${time}.`;
}

/* ------------------------------------------------------------ in the Mate's code */

export const crewInCodeHeading = (mateName: string): string =>
  `In ${crewPossessive(mateName)} code`;

export const crewNotShippedWords = (mateName: string): string =>
  `${mateName} hasn't shipped these yet`;

/** The same at a phone's width, where the section's heading has said whose code. */
export const CREW_NOT_SHIPPED_SHORT = "Not shipped yet";

/** *Ask Fen to ship them*, and what it does. */
export const crewShipWord = (mateName: string): string => `Ask ${mateName} to ship them`;
export const crewShipLine = (mateName: string): string =>
  `${mateName} ships what the crew added, like its own work.`;

/** A fold that opens: every piece of work that went in. */
export const crewShowAllWord = (count: number): string => `Show all ${count}`;

export const CREW_WHAT_CHANGED = "What changed";

/** What became of a piece of work that went in, after its title. */
export const crewWentInOutcome = (mateName: string): string =>
  `went into ${crewPossessive(mateName)} code`;

/** What became of a piece of work that closed with nothing of its own to add, after its title. */
export const crewClosedOutcome = (mateName: string): string =>
  `closed with nothing to add to ${crewPossessive(mateName)} code`;

/** A piece of work that went in, as a crewmate's chat marks it. */
export const crewWentInWord = (title: string | null, mateName: string): string =>
  `${title ?? "Its work"} ${crewWentInOutcome(mateName)}`;

/** A piece of work that closed with nothing of its own to add, as a crewmate's chat marks it. */
export const crewClosedWord = (title: string | null, mateName: string): string =>
  `${title ?? "Its work"} ${crewClosedOutcome(mateName)}`;

/* ------------------------------------------------------------ no crew yet, setup */

/**
 * *Set up a crew*, one press wherever it stands: the Crew tab's for a Mate
 * without a crew, and the Mate's own menu in the left menu.
 */
export const CREW_SET_UP_WORD = "Set up a crew";
export const CREW_SET_UP_LINE = "Pick who's on it and what each is responsible for.";

export const crewGiveCrewTitle = (mateName: string): string => `Give ${mateName} a crew`;

export const crewGiveCrewLine = (mateName: string): string =>
  `For a job too big for one conversation. A lead plans it, and crewmates build its parts side by side, each in its own copy of ${crewPossessive(mateName)} code. Nothing goes into ${crewPossessive(mateName)} code until you review it.`;

export const crewSetUpTitle = (mateName: string): string =>
  `Set up ${crewPossessive(mateName)} crew`;

export const crewSetUpLine = (mateName: string): string =>
  `A lead plans the work, and crewmates build its parts side by side, each in its own copy of ${crewPossessive(mateName)} code.`;

export const CREW_SETUP_WORDS = {
  cancel: "Cancel the setup",
  goal: "The goal",
  goalLine: "What the whole crew works toward. Every crewmate reads it.",
  goalPlaceholder: "What should the crew build, and why?",
  whosOnIt: "Who's on it",
  leadAndTwo: "Start with a lead and two builders",
  leadAndTwoLine: "You name them and write what each is responsible for.",
  addYourself: "Add someone yourself",
  start: "Start the crew",
  pickFirst: "Pick who's on it first.",
} as const;

export const crewSuggestWord = (mateName: string): string => `Let ${mateName} suggest a crew`;

/** Over the drafted rows: whether the Mate suggested them, and that each opens its job. */
export const crewSuggestedLine = (mateName: string, suggested: boolean): string =>
  `${suggested ? `${mateName} suggested these from the goal. ` : ""}Click anyone to change them.`;

export const crewSuggestLine = (mateName: string): string =>
  `${mateName} reads the goal and proposes who does what. You can change anyone.`;

/** The setup's footer: where the builders' copies go. */
export function crewSetUpFooter(mateName: string, hosts: ReadonlyArray<string>): string {
  const where = hosts.length === 0 ? "" : ` on ${hosts.join(" and ")}`;
  return `Each builder gets its own copy of ${crewPossessive(mateName)} code${where}. Getting them ready takes a minute or two; each row shows how it's going.`;
}

/** What each kind of crewmate does, at a setup row's right edge and in its job. */
export const CREW_KIND_WORDS = {
  lead: "Plans",
  writer: "Builds",
  reader: "Reviews",
} as const;

/** A dev service without crew ports: the setup's offer, and its press. */
export const crewPortsOfferWords = (mateName: string): string =>
  `To try each builder's work at its own address, ${mateName} can give each one`;
export const crewAskMateWord = (mateName: string): string => `Ask ${mateName}`;

/**
 * Why a crewmate that builds has no service to pick: the Mate has not
 * mounted a dev service yet, which its develop flow does first.
 */
export const crewNoDevHostWord = (mateName: string): string =>
  `No dev service is mounted yet — ask ${mateName} to start development first.`;

/* ------------------------------------------------------------ the goal, a job */

export const CREW_VIEW_WORDS = {
  back: "Crew",
  save: "Save",
  cancel: "Cancel",
  optional: "optional",
} as const;

export const CREW_GOAL_WORDS = {
  title: "The crew's goal",
  line: "What the whole crew works toward. Every crewmate reads it before each task.",
  titleField: "Title",
  body: "What it's for",
  rules: "Rules every crewmate follows",
  doneWhen: "Done when",
  saveLine:
    "Each crewmate picks up the new goal with its next message, in a fresh conversation. Nobody loses any work.",
} as const;

export const CREW_JOB_WORDS = {
  job: "Its job",
  jobLine: "What it's responsible for. It reads this before every task.",
  does: "What it does",
  builds: CREW_KIND_WORDS.writer,
  reviews: CREW_KIND_WORDS.reader,
  reviewsLine: "Reads and checks the others' work. Changes nothing.",
  more: "More",
  name: "Its name",
  face: "Its face",
  runsOn: "Runs on",
  login: "Login",
  model: "Model",
  effort: "Effort",
  loginDefault: "The login's default",
  modelDefault: "The model's default",
  service: "Service",
  setup: "Sets up its copy with",
  check: "Checks its work with",
  run: "Starts its app with",
  saveLine:
    "It picks up its new job with its next message, in a fresh conversation. Its work stays.",
  freshLine: "It starts a fresh conversation now.",
  newTitle: "A new crewmate",
  newLeadTitle: "A lead",
  add: "Add to the crew",
  nameTaken: "That name is taken.",
} as const;

/** Who a crewmate is, under its name in its job. */
export const crewOneOfWord = (mateName: string, lead: boolean): string =>
  lead ? `${crewPossessive(mateName)} lead` : `One of ${crewPossessive(mateName)} crew`;

/** *Builds*' line. */
export const crewBuildsLine = (mateName: string): string =>
  `Changes code, in its own copy of ${crewPossessive(mateName)} code.`;

/** More's summary line while it is folded. */
export function crewMoreSummary(input: {
  readonly runsOn: string;
  readonly check: string | null;
  readonly run: string | null;
}): string {
  return [
    "Its name and face",
    `runs on ${input.runsOn}`,
    input.check === null ? null : `checks its work with ${input.check}`,
    input.run === null ? null : `starts its app with ${input.run}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/* ------------------------------------------------------------ confirms, asks */

export const crewClearConfirm = (name: string): string =>
  `Clear ${crewPossessive(name)} conversation? It keeps its job and its work.`;

export const crewRemoveConfirm = (name: string): string => `Remove ${name} from the crew?`;

export const crewRemoveUnlandedConfirm = (name: string, mateName: string): string =>
  `Some of ${crewPossessive(name)} work isn't in ${crewPossessive(mateName)} code. Drop it and remove ${name}?`;

/** The ask dialog's "what" line for shipping the crew's work. */
export const crewShipWhat = (count: number): string =>
  count === 1
    ? "One piece of the crew's work isn't shipped yet."
    : `${count} pieces of the crew's work aren't shipped yet.`;

/* ------------------------------------------------------------ refusals */

const REFUSALS: Readonly<Record<CrewRefusalReason, string>> = {
  unavailable: "Crew mode is off in this Mate",
  "no-crew": "No crew is set up yet",
  "invalid-definition": "The crew's setup has a mistake",
  "handle-taken": "That name is taken",
  "no-free-disk": "The service has no free disk for another copy of the code",
  "database-undeclared":
    "A crewmate on a service with a database needs `env:` or `database: shared`",
  "no-mention": "Pick who it's for, or add a lead to split the work",
  "unknown-crewmate": "There is no such crewmate on the crew",
  "unknown-task": "That piece of work is gone",
  "wrong-state": "That can't be done right now",
  "not-allowed": "You can't start this crewmate's turn",
  "unlanded-commits": "Some of its work isn't in your Mate's code yet",
  "login-needs-fresh": "A different login needs a fresh conversation",
  io: "The crew's setup could not be read or saved",
};

/** The engine's words name "your Mate" and "your tree"; a surface that knows the Mate says its name. */
export const crewNamingTheMate = (words: string, mateName: string): string =>
  words
    .replace(/\byour tree\b/gu, `${crewPossessive(mateName)} code`)
    .replace(/\byour Mate\b/gu, mateName);

/**
 * A refused command or files request as one sentence: the engine's detail,
 * which names the specifics ("no dev server runs on appdev; start it first"),
 * said as a sentence of its own — capitalised, ended — and the reason's own
 * sentence when there is none. A mistake in the crew's setup says so first.
 * Never the reason's code.
 */
export function crewRefusalSentence(reason: CrewRefusalReason, detail: string | null): string {
  const said = detail?.trim() ?? "";
  if (said === "") return `${REFUSALS[reason]}.`;
  if (reason === "invalid-definition") return `${REFUSALS[reason]}: ${sentence(said)}`;
  return sentence(said);
}

/* ------------------------------------------------------------ drafts for the Mate */

/** *Continue* on a task that stopped mid-way: one turn as you, in its crewmate's chat. */
export const CREW_CARRY_ON_MESSAGE = "Carry on with your task.";

/** *Ask the lead*: one turn of the lead's, as you. */
export const crewAskLeadToReviewMessage = (taskNumber: number): string =>
  `Review #${taskNumber} and answer with crew_review.`;

/** *Ask it to rework*: one turn as you, carrying the review's note. */
export const crewReworkMessage = (taskNumber: number, note: string | null): string =>
  note === null || note.trim() === ""
    ? `Rework #${taskNumber} after its review.`
    : `Rework #${taskNumber} after its review: ${note}`;

/** `a.ts`, `a.ts and b.ts`, `a.ts, b.ts and c.ts`. */
function pathList(paths: ReadonlyArray<string>): string {
  if (paths.length <= 1) return paths[0] ?? "";
  return `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;
}

/** *Ask Fen to commit them*: a local commit that pushes nothing, so the crew's work can go in. */
export function crewCommitEditAsk(paths: ReadonlyArray<string>): string {
  return paths.length > 1
    ? `Commit my edits to ${pathList(paths)} locally, without pushing: the crew's work waits to go into your code.`
    : `Commit my edit to ${pathList(paths)} locally, without pushing: the crew's work waits to go into your code.`;
}

/**
 * *Ask Fen to ship them*: the crew's work in the Mate's code that has not
 * shipped, and the paths dirty in its tree that no crew work produced, which
 * ship too.
 */
export function crewDeliverAsk(
  crew: Pick<CrewSnapshot, "board" | "hosts">,
  dirtyPaths: ReadonlyArray<string>,
): string {
  const hosts = crew.hosts.map((host) => host.host).join(" and ");
  const titles = crew.board.tasks
    .filter((task) => task.state === "landed" && task.landedCommit !== null && !task.delivered)
    .map((task) => task.title)
    .join("; ");
  const ship = `Ship the work the crew added${hosts === "" ? "" : ` on ${hosts}`}: ${titles}.`;
  return dirtyPaths.length === 0
    ? ship
    : `${ship} My own edits in ${pathList(dirtyPaths)} ship too.`;
}

/** Crew ports (PRD §5.7), for the ports the engine reserved. */
export function crewPortsAsk(host: string, ports: ReadonlyArray<number>): string {
  const first = ports[0];
  if (ports.length === 1 && first !== undefined) {
    return `Add crew port ${first} (httpSupport) to ${host}'s dev setup in zerops.yaml, self-deploy ${host}, then make sure the new port is routed on the subdomain.`;
  }
  return `Add crew ports ${first}–${ports.at(-1)} (httpSupport) to ${host}'s dev setup in zerops.yaml, self-deploy ${host}, then make sure each new port is routed on the subdomain.`;
}

/** *Let Fen suggest a crew*: the goal as the person wrote it. */
export const crewDescribeAsk = (goal: string): string =>
  `Set up a crew for this project, from its goal: ${goal.trim()}`;

/** `+214 −12`, with a true minus. */
export const crewDiffStatWord = (stat: {
  readonly insertions: number;
  readonly deletions: number;
}): string => `+${stat.insertions} −${stat.deletions}`;

/* ------------------------------------------------------------ a crewmate's chat */

/** A crewmate chat's composer. */
export const crewMessagePlaceholder = (name: string): string => `Message ${name}…`;

/**
 * A crewmate's empty conversation: its job, headed as the job view heads it,
 * and the work it finished — each piece by its title and what became of it,
 * as its chat's seam says it (`crewWentInOutcome`, `crewClosedOutcome`).
 */
export const CREWMATE_EMPTY_WORDS = {
  job: CREW_JOB_WORDS.job,
  work: "Its work",
} as const;

const FRESH_NEXT = "Its next message starts a fresh conversation.";

/**
 * What a changed job or goal does to a crewmate's conversation (the probe-22
 * fallback: a resumed session keeps the prompt it began with); `null` while
 * nothing changed.
 */
export function crewPendingNotice(pending: {
  readonly brief: number | null;
  readonly job: number | null;
}): string | null {
  const { brief, job } = pending;
  if (job !== null && brief !== null) return `Its job and the crew's goal changed. ${FRESH_NEXT}`;
  if (job !== null) return `Its job changed. ${FRESH_NEXT}`;
  return brief === null ? null : `The crew's goal changed. ${FRESH_NEXT}`;
}

/** An earlier conversation with a crewmate: where it goes on, and why nothing is sent from it. */
export const crewEarlierStintNotice = (
  name: string,
): { readonly text: string; readonly sendBlock: string } => ({
  text: `An earlier conversation with ${name} — it goes on in a newer one.`,
  sendBlock: `Write to ${name} in its current conversation`,
});

/**
 * A crew seam's line on the engine, where the record gives the seam but no words of its own: work
 * that went in, work that closed, a save by when it applies (`CrewApplyChoice`).
 */
export function crewSeamWords(
  seam:
    | { readonly seam: "landed"; readonly number: number; readonly commit: string }
    | { readonly seam: "closed"; readonly number: number }
    | { readonly seam: "saved"; readonly apply: "nextTurn" | "now" | "fresh" }
    | { readonly seam: "stint" | "swept" },
): string {
  switch (seam.seam) {
    case "landed":
      return `Task #${seam.number} landed as ${seam.commit.slice(0, 7)}`;
    case "closed":
      return `Task #${seam.number} closed — nothing to land`;
    case "saved":
      return seam.apply === "nextTurn"
        ? "Its setup changed — from its next message"
        : seam.apply === "now"
          ? "Its setup changed — from now on"
          : "Its setup changed — its next message starts afresh";
    case "stint":
      return CREW_NEW_STINT_WORD;
    case "swept":
      return "Its unsaved work was kept";
  }
}

/**
 * Why a crewmate's one conversation started a new session, as the line in it says (engine
 * `session-rotated`, `CREW_SESSION_REASONS`): the conversation goes on, so the line says what
 * changed and what it keeps — never a link to another.
 */
export function crewSessionWord(reason: string | undefined): string {
  switch (reason) {
    case "cleared":
      return "You cleared its conversation — it keeps its job and its work";
    case "context":
      return "It started afresh: its conversation grew too long — it carries on from memory";
    case "job":
      return "Its job changed — it started afresh";
    case "login":
      return "It runs on a different login now";
    case "budget":
      return "Its budget changed — it carries on";
    case "task":
      return "It started afresh for unrelated work";
    default:
      return "It started afresh";
  }
}

/** A conversation that began without a reason of its own, and the link to the one before it. */
export const CREW_NEW_STINT_WORD = "New conversation";
export const CREW_PREVIOUS_STINT_LINK = "previous conversation";

/** Whether a dev service reaches a database (a job's *Service*); `null` is unknown, never "no". */
export function crewDevHostDatabaseWord(database: boolean | null): string {
  if (database === null) return "Database unknown";
  return database ? "Has a database" : "No database";
}

/* ------------------------------------------------------------ the left menu's line */

/**
 * The crew's one line under its Mate in the left menu says its most urgent
 * fact: who needs you, the lead first — "Bo needs you", "Bo and Cy need
 * you", "Bo and 2 others need you".
 */
export function crewLineNeedsWord(names: ReadonlyArray<string>): string {
  const [first, second, ...rest] = names;
  if (second === undefined) return `${first ?? "The crew"} needs you`;
  if (rest.length === 0) return `${first} and ${second} need you`;
  return `${first} and ${String(names.length - 1)} others need you`;
}

/** A crewmate's face on that line, as its tooltip and accessible name say it. */
export function crewFaceWord(name: string, lead: boolean): string {
  return lead ? `${name}, the lead` : name;
}

/**
 * …or whose finished work waits for your review: "Game systems' work is
 * ready", "2 pieces of work are ready".
 */
export function crewLineReadyWord(names: ReadonlyArray<string>): string {
  const [only, second] = names;
  if (only !== undefined && second === undefined) return `${crewPossessive(only)} work is ready`;
  return `${String(names.length)} pieces of work are ready`;
}

/** Which crewmates run on a login, by name, the lead said as the lead. */
export function crewLoginRunsWord(names: ReadonlyArray<string>, lead: string | null): string {
  return `Runs: ${names
    .map((name) => (name === lead && name.toLowerCase() !== "lead" ? `${name} (lead)` : name))
    .join(", ")}`;
}

/* ------------------------------------------------------------ the conversation's line */

/**
 * What each kind of crewmate does, as a clause: the lead plans and reviews,
 * a builder works in its own copy of the Mate's code (the job view's
 * _Builds_), a reviewer changes nothing (its _Reviews_).
 */
export function crewmateDoesWords(kind: Crewmate["kind"], mateName: string): string {
  switch (kind) {
    case "lead":
      return "plans and reviews the crew's work";
    case "writer":
      return `builds its part in its own copy of ${crewPossessive(mateName)} code`;
    case "reader":
      return "checks the others' work and changes nothing";
  }
}

/**
 * Who a crewmate is on the conversation's line, after its name: one of its
 * Mate's crew, or the Mate's lead and what the lead does. A face's tooltip
 * and its accessible name say it; the name stands before it.
 */
export function crewmateRoleWords(mateName: string, lead: boolean): string {
  return lead
    ? `, ${mateName}'s lead — ${crewmateDoesWords("lead", mateName)}`
    : `, one of ${mateName}'s crew`;
}

/**
 * Whose a crewmate is and what it does, the one line under its name in its
 * empty conversation, after its Mate's small face: "Fen's lead · plans and
 * reviews the crew's work", "One of Fen's crew · builds its part in its own
 * copy of Fen's code".
 */
export function crewmateWhoseLine(kind: Crewmate["kind"], mateName: string): string {
  return `${crewOneOfWord(mateName, kind === "lead")} · ${crewmateDoesWords(kind, mateName)}`;
}

/** The Mate's own chat, as its face on the line says it while another chat is open. */
export const mateOwnChatWord = (mateName: string): string => `${mateName}'s own chat`;

/** A line's markdown lead-in: a heading's hashes, a list's bullet or number. */
const MARKDOWN_LEAD = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u;

/** How a job is written to its crewmate: "You own Game Rules: …". */
const YOU_OWN = "You own ";

/**
 * A job's other second-person openings, as the person's line says them: the
 * crewmate is the one the line is about, so "you" becomes its verb.
 */
const SECOND_PERSON_OPENINGS: ReadonlyArray<readonly [string, string]> = [
  ["You lead ", "Leads "],
  ["You build ", "Builds "],
  ["You review ", "Reviews "],
];

/**
 * A job's words to its crewmate, as the person's line: "You own Game Rules:
 * turns and scoring" or "You own Game Rules — turns and scoring" is "Turns and
 * scoring"; "You own the rules engine: …" is "The rules engine: …"; "You lead
 * the Letopis crew: …" is "Leads the Letopis crew: …", and so "You build" and
 * "You review"; anything else, as it is. Its name is matched as written,
 * never as a pattern, and in any case; a line that would be left empty stays
 * whole.
 */
function personsLine(plain: string, name: string): string {
  const opening = SECOND_PERSON_OPENINGS.find(([you]) => plain.startsWith(you));
  if (opening !== undefined) {
    const rest = plain.slice(opening[0].length).trimStart();
    return rest.length === 0 ? plain : `${opening[1]}${rest}`;
  }
  if (!plain.startsWith(YOU_OWN)) return plain;
  const owned = plain.slice(YOU_OWN.length);
  const lead = [`${name}:`, `${name} —`].find((prefix) =>
    owned.toLowerCase().startsWith(prefix.toLowerCase()),
  );
  const rest = (lead === undefined ? owned : owned.slice(lead.length)).trimStart();
  return rest.length === 0 ? plain : `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}

/**
 * A job's first line in plain words and the person's: what its crewmate's
 * empty conversation says under _Its job_. Markdown's marks go — a heading's
 * hashes, a list's bullet, a quote's marker, emphasis, code ticks, a link's
 * address — and the words the job says to its crewmate become the person's
 * line (`personsLine`). Its first sentence always stays; a later one stays
 * only while it speaks about the crewmate, never to it: "You read, plan and
 * review; you never change files." is the crewmate's instruction, not the
 * person's line.
 */
export function crewJobLine(jobFirstLine: string, name: string): string {
  const [first = "", ...rest] = jobSentences(personsLine(plainJobLine(jobFirstLine), name));
  return [first, ...rest.filter((sentence) => !SPEAKS_TO_IT.test(sentence))].join(" ");
}

/** A later sentence that addresses the crewmate rather than describing it. */
const SPEAKS_TO_IT = /\byou(?:r|rs|rself)?\b/iu;

/** A line's sentences: each ends at a full stop, question or exclamation mark a space or the end follows. */
function jobSentences(line: string): ReadonlyArray<string> {
  return line.split(/(?<=[.!?])\s+/u).filter((sentence) => sentence.length > 0);
}

/** A job line without markdown's marks, its quote read as a Mate's message reads one (`quoteWords`). */
function plainJobLine(jobFirstLine: string): string {
  return quoteWords(jobFirstLine)
    .replace(MARKDOWN_LEAD, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/gu, "$1$2")
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/gu, "$1$2")
    .trim();
}

/**
 * The first sentence of a job, in plain words and the person's
 * (`crewJobLine`): what a crewmate's row says while it is on nothing, its
 * face says on hover and its menu says at the top. The sentence ends at its
 * first full stop, question or exclamation mark that a space or the line's
 * end follows, so `index.ts` or `v1.2` never ends it; a line with none is
 * whole.
 */
export function crewJobSentence(jobFirstLine: string, name: string): string {
  const line = crewJobLine(jobFirstLine, name);
  const end = /[.!?](?=\s|$)/u.exec(line);
  return end === null ? line : line.slice(0, end.index + 1);
}

/**
 * What *Try its work* opens: the crewmate's own copy of the app on its crew
 * port, or — for a writer whose app cannot run on its own — its work shown
 * at the Mate's dev address. Either way nothing of it is in the Mate's code.
 */
export function crewTryWorkLine(mateName: string, where: "own" | "dev"): string {
  return where === "own"
    ? `Opens its copy of the app. Nothing is in ${mateName}'s code yet.`
    : `Opens it at ${mateName}'s dev address. Nothing is in ${mateName}'s code yet.`;
}

/** A finished crew task's result row, beside *Review*: its work tried before it goes in. */
export const CREW_TRY_IT_WORD = "Try it";

/** A refused press of a crewmate's menu, as its toast is titled. */
export function crewMenuFailureWord(press: "try" | "stop" | "clear", name: string): string {
  switch (press) {
    case "try":
      return `Couldn't open ${name}'s work`;
    case "stop":
      return `Couldn't stop ${name}'s app`;
    case "clear":
      return `Couldn't clear ${name}'s conversation`;
  }
}

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

/** Durable stages, in the same words on every client. */
export function crewOperationStageWord(stage: string): string {
  switch (stage) {
    case "prepared":
      return "ready to start";
    case "legacy-state-recorded":
      return "its last task state recorded; the outcome is unknown";
    case "copy-rebuilt":
      return "its copy rebuilt";
    case "snapshotting-refs":
      return "its saved work recorded";
    case "inspecting-refs":
      return "its saved work checked";
    case "opening-conversation":
      return "its conversation opened";
    case "preparing-copy":
      return "its copy preparation ended";
    case "attempt-recorded":
      return "its work recorded";
    case "admitting":
    case "admitted":
      return "allowed to start";
    case "dispatching":
      return "starting its turn";
    case "dispatched":
    case "working":
      return "its turn started";
    case "committing":
      return "its preservation step ended";
    case "merging":
      return "its merge ended";
    case "setting-up":
      return "its setup ended";
    case "checking":
      return "its check ended";
    case "landing":
      return "its landing ended";
    default:
      return "its last recorded step";
  }
}

export const crewCopyAssignmentDetail = (
  copy: NonNullable<CrewAttention["copyAssignment"]>,
): string =>
  `Current copy: ${copy.currentPath ?? "none"} · Crew copy: ${copy.crewPath} · Crew copy set when the conversation opened`;
export const crewOperationDetail = (stage: string): string =>
  `Last confirmed: ${crewOperationStageWord(stage)} · Its work stays in its copy`;

/** Work the server still owns after the agent's live step ended. */
export function crewPendingOperationWord(
  operation: NonNullable<CrewAttention["operation"]>,
  mateName: string,
): string | null {
  switch (operation.stage) {
    case "dispatched":
      return null;
    case "committing":
      return "Preserving its work";
    case "inspecting-refs":
      return "Checking its saved work";
    case "checking":
      return CREW_CHECKING_ITS_WORK;
    case "merging":
      return "Preparing its work for checking";
    case "setting-up":
      return "Setting up its copy";
    case "rebuilding-copy":
      return "Rebuilding its crew copy";
    case "landing":
      return `Adding its work to ${crewPossessive(mateName)} code`;
    case "reading-landing":
      return "Checking whether its work is in the code";
    case "opening-conversation":
      return "Opening its conversation";
    case "preparing-copy":
      return CREW_COPY_READYING;
    default:
      return "Getting ready to start";
  }
}
