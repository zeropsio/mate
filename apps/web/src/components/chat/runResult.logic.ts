/**
 * What a finished run leaves in its card: what is still open or still running
 * because of it, in its state now, as rows in the card's grid, most important
 * first — anything still broken, then what waits for the person, then what
 * runs — and nothing it came back from on the way, nothing since fixed,
 * finished or taken over (the owner, 2026-09-29: "when something fails, the
 * agent tries again, it doesn't make sense to keep log of things that were
 * fixed later … only show like live things, tasks"). How it got there,
 * failures and retries included, is the work, one click away.
 *
 * Each row follows the real thing. A later run of the conversation that
 * deploys, starts or stops the same service, pushes to the same change,
 * works the same crew task or checks the same page takes the row over; the
 * person writing again answers what waited on them. From outside the run:
 * the change merged leaves its row and the worked line says "merged as #2";
 * a service the platform says stopped or failed comes back in red with its
 * fix; one removed, or deployed past by someone else since, leaves.
 *
 * Pure: the rows are read off the run's outcome (`deriveOutcome`) and the
 * facts from outside it, each undefined while unread — a row stays as the run
 * left it until its fact is known.
 */
import type { EnvironmentId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { zeropsStatusWord } from "@t3tools/client-runtime/zerops/serviceMap";

import type { FixProblem } from "../../zerops/fixRequest";
import type { ReviewTarget } from "../../zerops/review";
import {
  browserCheckCaption,
  browserCheckFailed,
  browserCheckFailure,
  browserCheckPage,
  browserCheckUrl,
  browserTakeState,
  type ActivityKind,
  type OutcomeModel,
  type OutcomeService,
} from "./conversation.logic";

// ---------------------------------------------------------------------------
// The facts from outside the run
// ---------------------------------------------------------------------------

/** A change on the project's forge, as the result names it. */
export interface ResultChange {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
}

/** A service of the Mate's project, as the platform has it now. */
export interface ResultServiceNow {
  /** The platform's status: ACTIVE, STOPPED, a *FAILED one. */
  readonly status: string;
  /** When its status last changed. */
  readonly since: string | null;
  /** When the version it runs was made: one made after the run is someone else's. */
  readonly versionAt: string | null;
}

/** A crew task now. */
export interface ResultTask {
  readonly id: string;
  readonly state: string;
}

/** What is true now outside the run; each undefined while unread. */
export interface ResultFacts {
  /** Whose run it is: its Mate's project, and the project (group) that is in. */
  readonly mate?: { readonly projectId: string; readonly groupId: string | undefined } | undefined;
  /** The project's changes on its forge. */
  readonly changes?:
    | {
        readonly groupId: string;
        readonly open: ReadonlyArray<ResultChange>;
        readonly merged: ReadonlyArray<ResultChange>;
        /** The forge has answered: a change in neither list was closed. */
        readonly known: boolean;
      }
    | undefined;
  /** The Mate's project's services, by hostname. */
  readonly services?: ReadonlyMap<string, ResultServiceNow> | undefined;
  /** The crew's tasks by number, and where they land. */
  readonly crew?:
    | {
        readonly environmentId: EnvironmentId;
        readonly tasks: ReadonlyMap<number, ResultTask>;
      }
    | undefined;
}

const NO_FACTS: ResultFacts = {};

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

/** Where a row stands: broken first, then what waits for the person, then what runs. */
export type ResultGroup = "broken" | "waiting" | "running";

const GROUP_ORDER: Readonly<Record<ResultGroup, number>> = { broken: 0, waiting: 1, running: 2 };

/** What stands in the mark column: a state's dot, or a glyph for what the thing is. */
export type ResultMark = "dot" | "alert" | "change" | "task";

/** The mark's colour: green runs, amber waits on the person, red is still broken. */
export type ResultTone = "ok" | "attention" | "failed" | "muted";

export type ResultSub =
  | { readonly kind: "text"; readonly text: string }
  /** Broken since then: "Since 23:10". */
  | { readonly kind: "since"; readonly at: string }
  | {
      readonly kind: "diff";
      readonly files: number | null;
      readonly additions: number;
      readonly deletions: number;
      /** The run whose diff the files open. */
      readonly turnId: TurnId | null;
    };

export type ResultAction =
  /** Review: the one door to merging and landing (R1). */
  | { readonly kind: "review"; readonly target: ReviewTarget }
  /** Ask the person's Mate to fix it, the problem written for it (S6). */
  | { readonly kind: "fix"; readonly problem: FixProblem };

export interface ResultRow {
  readonly key: string;
  readonly group: ResultGroup;
  readonly mark: ResultMark;
  readonly tone: ResultTone;
  /** What the row is about, in weight: "appdev", "#2 Add a /status page". */
  readonly title: string;
  /** Its state now, quieter: "Dev server running", "Build failing". */
  readonly words: string | null;
  /** The version it runs, short. */
  readonly version: string | null;
  /** The line under it: why it is broken, since when, the pages checked on it, what changed. */
  readonly sub: ResultSub | null;
  /** The checks' pictures: each page's last. */
  readonly pictures: ReadonlyArray<ZeropsOperation>;
  /** Where it runs, opened from the row's end. */
  readonly url: string | null;
  readonly action: ResultAction | null;
}

/** At most this many pictures stand at a row's end; the work holds every take. */
const PICTURES_PER_ROW = 3;

const NO_PICTURES: ReadonlyArray<ZeropsOperation> = [];

/** One page the run checked, with every take of it and how the last of them ended. */
interface CheckedPage {
  readonly page: string;
  readonly caption: string;
  readonly host: string | null;
  readonly url: string | null;
  readonly takes: ReadonlyArray<ZeropsOperation>;
  /** Why its check failed, while it stays failed; null once a take passed. */
  readonly failure: string | null;
  readonly failedAt: string | null;
}

function checkedPages(takes: ReadonlyArray<ZeropsOperation>): CheckedPage[] {
  const byPage = new Map<string, ZeropsOperation[]>();
  for (const take of takes) {
    if (take.phase === "running") continue;
    const page = browserCheckPage(take);
    const list = byPage.get(page);
    if (list) list.push(take);
    else byPage.set(page, [take]);
  }
  return [...byPage].map(([page, list]) => {
    const url = browserCheckUrl(list[0]!);
    const failed = list.findLast((take) => browserTakeState(take, takes) === "failed");
    return {
      page,
      caption: browserCheckCaption(list[0]!),
      host: url?.host ?? null,
      url: url?.href ?? null,
      takes: list,
      failure: failed === undefined ? null : (browserCheckFailure(failed) ?? "failed"),
      failedAt: failed === undefined ? null : (failed.settledAt ?? failed.anchorAt),
    };
  });
}

/**
 * The service a page belongs to: the one at its address, else the one its
 * subdomain is named after (`appdev-1f3c-3000.…` is appdev's) — the longest
 * name, so `api-gateway` is never `api`'s.
 */
function serviceOfPage(
  page: CheckedPage,
  services: ReadonlyArray<OutcomeService>,
): OutcomeService | undefined {
  if (page.host === null) return undefined;
  const atAddress = services.find(
    (candidate) =>
      candidate.url !== null &&
      URL.canParse(candidate.url) &&
      new URL(candidate.url).host === page.host,
  );
  if (atAddress !== undefined) return atAddress;
  const label = page.host.split(".")[0]!.toLowerCase();
  return services
    .filter((candidate) => {
      const name = candidate.hostname.toLowerCase();
      return label === name || label.startsWith(`${name}-`);
    })
    .toSorted((left, right) => right.hostname.length - left.hostname.length)[0];
}

function passed(take: ZeropsOperation): boolean {
  return take.phase === "done" && !browserCheckFailed(take);
}

function checksWord(count: number): string {
  return count === 2 ? "both checks passed" : `all ${count} checks passed`;
}

/** "/status checked ✓", or "2 pages checked, all 5 checks passed": only what passed. */
function checkedLine(pages: ReadonlyArray<CheckedPage>): string | null {
  const count = pages.reduce((sum, page) => sum + page.takes.filter(passed).length, 0);
  if (pages.length === 0 || count === 0) return null;
  if (pages.length === 1) {
    const caption = pages[0]!.caption;
    return count === 1 ? `${caption} checked ✓` : `${caption} checked, ${checksWord(count)}`;
  }
  return `${pages.length} pages checked, ${checksWord(count)}`;
}

/** Each page's last take that took a picture. */
function picturesOf(pages: ReadonlyArray<CheckedPage>): ReadonlyArray<ZeropsOperation> {
  return pages
    .flatMap((page) => {
      const last = page.takes.findLast((take) => take.screenshot !== undefined);
      return last === undefined ? [] : [last];
    })
    .slice(0, PICTURES_PER_ROW);
}

function textSub(text: string | null): ResultSub | null {
  return text === null ? null : { kind: "text", text };
}

const NOT_RUNNING_STATUSES: ReadonlySet<string> = new Set(["STOPPED", "READY_TO_DEPLOY"]);
const GONE_STATUSES: ReadonlySet<string> = new Set(["DELETED", "DELETING"]);

function platformStatus(now: ResultServiceNow): string {
  return now.status.startsWith("SERVICE_") ? now.status.slice("SERVICE_".length) : now.status;
}

/** Later than `than`, both read as times; false where either is unknown. */
function after(at: string | null, than: string): boolean {
  if (at === null) return false;
  const atMs = Date.parse(at);
  const thanMs = Date.parse(than);
  return Number.isFinite(atMs) && Number.isFinite(thanMs) && atMs > thanMs;
}

/**
 * What a broken service asks of its Mate: what failed and where, and what to
 * do about it — a build is fixed and deployed again, a dev server started.
 */
function serviceProblem(service: OutcomeService): FixProblem {
  const failure = service.failure!;
  const building = service.word === "Build failing";
  const what = building
    ? `The build of ${service.hostname} is failing`
    : service.word === "Not healthy"
      ? `${service.hostname} isn't healthy`
      : service.word.startsWith("Dev server")
        ? `The dev server on ${service.hostname} isn't running`
        : `The deploy to ${service.hostname} failed`;
  return {
    what,
    at: failure.at,
    error: failure.reason,
    ...(failure.logLines.length > 0
      ? {
          logLines: failure.logLines,
          logName: `${building ? "Build log" : "Log"} · ${service.hostname}`,
        }
      : {}),
    ask: service.word.startsWith("Dev server")
      ? "Find out why, fix it, and start it again."
      : service.word === "Not healthy"
        ? "Find out why, fix it, and check it again."
        : "Find out why, fix it, and deploy it again.",
  };
}

/** A service as the result shows it now, or null once it is no longer this run's to show. */
function serviceRow(
  service: OutcomeService,
  pages: ReadonlyArray<CheckedPage>,
  now: ResultServiceNow | undefined,
): ResultRow | null {
  const status = now === undefined ? null : platformStatus(now);
  if (status !== null && GONE_STATUSES.has(status)) return null;
  // Deployed past since, by someone else — fixed, or running because of them.
  if (now !== undefined && after(now.versionAt, service.at)) return null;
  const base = {
    key: `service:${service.hostname}`,
    title: service.hostname,
    version: service.version,
    url: service.url ?? pages[0]?.url ?? null,
  };
  if (status !== null && (/FAIL/u.test(status) || NOT_RUNNING_STATUSES.has(status))) {
    const word = zeropsStatusWord(status);
    const since = now?.since ?? null;
    return {
      ...base,
      group: "broken",
      mark: "alert",
      tone: "failed",
      // It leads with its fix: what it would open is down.
      url: null,
      words: word,
      sub: since === null ? null : { kind: "since", at: since },
      pictures: NO_PICTURES,
      action: {
        kind: "fix",
        problem: {
          what:
            status === "STOPPED"
              ? `${service.hostname} stopped`
              : `${service.hostname}: ${word.toLowerCase()}`,
          ...(since === null ? {} : { at: since }),
          ask: "Find out why it stopped, fix it, and start it again.",
        },
      },
    };
  }
  if (service.tone === "failed") {
    return {
      ...base,
      group: "broken",
      mark: "alert",
      tone: "failed",
      url: null,
      words: service.word,
      sub: textSub(service.failure?.reason ?? null),
      pictures: NO_PICTURES,
      action: service.failure === null ? null : { kind: "fix", problem: serviceProblem(service) },
    };
  }
  const ok = service.tone === "ok";
  return {
    ...base,
    group: ok ? "running" : "waiting",
    mark: "dot",
    tone: service.tone,
    words: service.word,
    sub: ok ? textSub(checkedLine(pages)) : null,
    pictures: ok ? picturesOf(pages) : NO_PICTURES,
    action: null,
  };
}

function failedPageRow(page: CheckedPage, owner: string): ResultRow {
  return {
    key: `page:${page.page}`,
    group: "broken",
    mark: "alert",
    tone: "failed",
    title: owner,
    words: `Check of ${page.caption} failed`,
    version: null,
    sub: textSub(page.failure),
    pictures: picturesOf([page]),
    url: page.url,
    action: {
      kind: "fix",
      problem: {
        what: `The check of ${page.caption} on ${owner} failed`,
        ...(page.failedAt === null ? {} : { at: page.failedAt }),
        ...(page.failure === null ? {} : { error: page.failure }),
        ask: "Find out why, fix it, and check the page again.",
      },
    },
  };
}

function pagesRow(host: string, pages: ReadonlyArray<CheckedPage>): ResultRow {
  return {
    key: `pages:${host}`,
    group: "running",
    mark: "dot",
    tone: "ok",
    title: host,
    words: null,
    version: null,
    sub: textSub(checkedLine(pages)),
    pictures: picturesOf(pages),
    url: pages.length === 1 ? pages[0]!.url : null,
    action: null,
  };
}

const changeKey = (change: { readonly repository: string; readonly number: number }) =>
  `${change.repository}#${change.number}`;

/** This run's change, while it is this run's: no later run pushed to it since. */
function ownChange(outcome: OutcomeModel): OutcomeModel["change"] {
  const { change } = outcome;
  return change !== null && !outcome.later.changes.includes(changeKey(change)) ? change : null;
}

/** The change a run pushed, while it waits for the person's review. */
function changeRow(outcome: OutcomeModel, facts: ResultFacts): ResultRow | null {
  const change = ownChange(outcome);
  const forge = facts.changes;
  if (change === null || forge === undefined) return null;
  const open = forge.open.find((candidate) => changeKey(candidate) === changeKey(change));
  if (open === undefined) return null;
  const { files } = outcome;
  return {
    key: `change:${changeKey(change)}`,
    group: "waiting",
    mark: "change",
    tone: "muted",
    title: `#${open.number} ${open.title}`,
    words: null,
    version: null,
    sub:
      files === null
        ? null
        : {
            kind: "diff",
            files: files.count,
            additions: files.additions,
            deletions: files.deletions,
            turnId: files.turnId,
          },
    pictures: NO_PICTURES,
    url: null,
    action: {
      kind: "review",
      target: {
        kind: "change",
        groupId: forge.groupId,
        repository: open.repository,
        number: open.number,
      },
    },
  };
}

/** Crew tasks that wait on the person's press, in the result's words. */
const TASK_WAITING: Readonly<Record<string, string>> = {
  ready: "Ready to land",
  "waiting-on-you": "Waits on your edits to land",
};

/** The crew task a run worked, while it waits to land and no later run took it up. */
function taskRow(outcome: OutcomeModel, facts: ResultFacts): ResultRow | null {
  const task = outcome.crewTask;
  const crew = facts.crew;
  if (task === null || crew === undefined || outcome.later.tasks.includes(task.number)) {
    return null;
  }
  const now = crew.tasks.get(task.number);
  const words = now === undefined ? undefined : TASK_WAITING[now.state];
  if (now === undefined || words === undefined) return null;
  return {
    key: `task:${task.number}`,
    group: "waiting",
    mark: "task",
    tone: "muted",
    title: `#${task.number} ${task.title}`,
    words,
    version: null,
    sub: null,
    pictures: NO_PICTURES,
    url: null,
    action: {
      kind: "review",
      target: { kind: "crew-task", environmentId: crew.environmentId, taskId: now.id },
    },
  };
}

/**
 * The rows a run's result shows now, most important first — broken, then
 * waiting for the person (the change, a crew task, what did not go through,
 * steps of its plan it left), then running; within each, in the order the
 * run left them.
 */
export function resultRows(outcome: OutcomeModel, facts: ResultFacts = NO_FACTS): ResultRow[] {
  const { later } = outcome;
  const rows: ResultRow[] = [];

  const change = changeRow(outcome, facts);
  if (change !== null) rows.push(change);
  const task = taskRow(outcome, facts);
  if (task !== null) rows.push(task);
  // What waited on the person is answered once they write again.
  if (!later.answered) {
    for (const item of outcome.notDone) {
      rows.push({
        key: `not-done:${item.key}`,
        group: "waiting",
        mark: "dot",
        tone: "attention",
        title: item.subject,
        words: item.word,
        version: null,
        sub: textSub(item.reason),
        pictures: NO_PICTURES,
        url: null,
        action: {
          kind: "fix",
          problem: {
            what: `${item.word}: ${item.subject}`,
            at: item.at,
            ...(item.reason === null ? {} : { error: item.reason }),
            ask: "Find out why it didn't go through, fix it, and try again.",
          },
        },
      });
    }
    outcome.planLeft.forEach((step, index) => {
      rows.push({
        key: `plan:${index}`,
        group: "waiting",
        mark: "dot",
        tone: "attention",
        title: step,
        words: "Not done",
        version: null,
        sub: null,
        pictures: NO_PICTURES,
        url: null,
        action: null,
      });
    });
  }

  const services = outcome.live.filter((service) => !later.services.includes(service.hostname));
  const gone = (hostname: string) => facts.services !== undefined && !facts.services.has(hostname);
  const pages = checkedPages(outcome.checks?.takes ?? []).filter(
    (page) => !later.pages.includes(page.page),
  );
  // Each page stands with the service it belongs to, and goes where it goes.
  const owners = new Map(
    pages.map((page) => [page, serviceOfPage(page, outcome.live)?.hostname] as const),
  );
  const shown = new Set<string>();
  for (const service of services) {
    if (gone(service.hostname)) continue;
    const own = pages.filter(
      (page) => page.failure === null && owners.get(page) === service.hostname,
    );
    const row = serviceRow(service, own, facts.services?.get(service.hostname));
    if (row === null) continue;
    shown.add(service.hostname);
    rows.push(row);
  }
  const standing = (page: CheckedPage) => {
    const owner = owners.get(page);
    return owner === undefined || shown.has(owner);
  };
  for (const page of pages) {
    if (page.failure !== null && standing(page)) {
      rows.push(failedPageRow(page, owners.get(page) ?? page.host ?? page.caption));
    }
  }
  const loose = new Map<string, CheckedPage[]>();
  for (const page of pages) {
    if (page.failure !== null || owners.get(page) !== undefined) continue;
    const host = page.host ?? page.caption;
    const list = loose.get(host);
    if (list) list.push(page);
    else loose.set(host, [page]);
  }
  for (const [host, list] of loose) rows.push(pagesRow(host, list));

  const running = new Set(outcome.live.map((service) => service.hostname));
  for (const name of outcome.created.flatMap((subject) => subject.split(/,\s*/u))) {
    if (name.length === 0 || name === "the services" || running.has(name)) continue;
    running.add(name);
    if (later.services.includes(name) || gone(name)) continue;
    rows.push({
      key: `created:${name}`,
      group: "running",
      mark: "dot",
      tone: "ok",
      title: name,
      words: "Created",
      version: null,
      sub: null,
      pictures: NO_PICTURES,
      url: null,
      action: null,
    });
  }

  return rows
    .map((row, index) => ({ row, index }))
    .toSorted(
      (left, right) =>
        GROUP_ORDER[left.row.group] - GROUP_ORDER[right.row.group] || left.index - right.index,
    )
    .map(({ row }) => row);
}

// ---------------------------------------------------------------------------
// The effort
// ---------------------------------------------------------------------------

/** Each kind of call, as the effort counts it: "2 commands", "the workflow checked". */
const EFFORT_WORDS: Readonly<Record<ActivityKind, (count: number) => string>> = {
  edit: (count) => (count === 1 ? "1 file edited" : `${count} files edited`),
  command: (count) => (count === 1 ? "1 command" : `${count} commands`),
  read: (count) => (count === 1 ? "1 file read" : `${count} files read`),
  "code-search": (count) => (count === 1 ? "1 code search" : `${count} code searches`),
  search: (count) => (count === 1 ? "1 web search" : `${count} web searches`),
  workflow: () => "the workflow checked",
  guides: () => "the Zerops guides read",
  tool: (count) => (count === 1 ? "1 tool used" : `${count} tools used`),
  helpers: (count) => (count === 1 ? "1 helper" : `${count} helpers`),
};

/** "#2", "#2 and #3", "#2, #3 and #5". */
function numbersWords(numbers: ReadonlyArray<number>): string {
  const said = numbers.map((number) => `#${number}`);
  return said.length <= 1 ? (said[0] ?? "") : `${said.slice(0, -1).join(", ")} and ${said.at(-1)!}`;
}

/**
 * The changes of a run that were merged: its own change once the forge says
 * so, and — for a run that pushed no change of its own — what landed while it
 * ran. Another run's change landing meanwhile is that run's to say.
 */
function mergedNumbers(outcome: OutcomeModel, facts: ResultFacts): ReadonlyArray<number> {
  const own = ownChange(outcome);
  if (outcome.change === null) return outcome.landed.map((change) => change.number);
  if (own === null) return [];
  const landed =
    outcome.landed.some((change) => changeKey(change) === changeKey(own)) ||
    (facts.changes?.merged.some((change) => changeKey(change) === changeKey(own)) ?? false);
  return landed ? [own.number] : [];
}

/**
 * What a finished run leaves in its card's foot, beside its time: the effort,
 * counting only what its result doesn't already show as a row — "2 commands ·
 * 1 file read" (K6). Checks and deploys are result rows and never calls; its
 * edits are its change's whenever it has one (a change it pushed, one that
 * landed), and are counted only when nothing else holds them. A change of its
 * that was merged is said once, first: "merged as #2 · 2 commands". Null
 * while there is nothing left to count.
 */
export function runEffortWords(
  outcome: OutcomeModel | null | undefined,
  facts: ResultFacts = NO_FACTS,
): string | null {
  if (outcome === null || outcome === undefined) return null;
  const merged = mergedNumbers(outcome, facts);
  const changed = outcome.change !== null || outcome.landed.length > 0;
  const parts = [
    ...(merged.length > 0 ? [`merged as ${numbersWords(merged)}`] : []),
    ...outcome.activity.flatMap((activity) =>
      activity.count <= 0 || (activity.kind === "edit" && changed)
        ? []
        : [EFFORT_WORDS[activity.kind](activity.count)],
    ),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}
