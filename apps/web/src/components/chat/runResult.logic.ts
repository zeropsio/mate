/**
 * What a finished run leaves in its card: what is still open or still running
 * because of it, in its state now, as rows in the card's grid, most important
 * first — anything still broken, then what waits for the person, then what
 * runs — and nothing it came back from on the way, nothing since fixed,
 * finished or taken over (the owner, 2026-09-29: "when something fails, the
 * agent tries again, it doesn't make sense to keep log of things that were
 * fixed later … only show like live things, tasks"). How it got there,
 * failures and retries included, is the work, one click away. Under the
 * rows, the pictures the run took and looked at, in one strip.
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
  pageView,
  browserCheckUrl,
  browserTakeState,
  type ActivityKind,
  type OutcomeModel,
  type OutcomePicture,
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
  /** Whether it asks for review: its Mate described it at its head. Absent reads as ready. */
  readonly ready?: boolean;
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
  /** The crewmate whose task it is. */
  readonly owner: string;
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
      /** A run of several turns: the first, its diff the whole run's. */
      readonly fromTurnId: TurnId | null;
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
  /** The line under it: why it is broken, since when, what changed. */
  readonly sub: ResultSub | null;
  /**
   * What its checks found, on its one line after its state and version:
   * "Deployed 227b804 · both checks passed" — never a line of its own that
   * starts with a "/" (the owner, 2026-09-30).
   */
  readonly checked?: string;
  /** Where it runs, opened from the row's end. */
  readonly url: string | null;
  readonly action: ResultAction | null;
  /**
   * *Try it* beside *Review*: a crew task ready to land, its crewmate's work
   * tried before it lands (`useCrewTry`). Absent on every other row.
   */
  readonly tryIt?: { readonly environmentId: EnvironmentId; readonly handle: string };
}

/** One page the run checked, with every take of it and how the last of them ended. */
interface CheckedPage {
  readonly page: string;
  readonly caption: string;
  /** Null for a check of the page already open, which named no address. */
  readonly host: string | null;
  readonly url: string | null;
  readonly takes: ReadonlyArray<ZeropsOperation>;
  /** Why its check failed, while it stays failed; null once a take passed. */
  readonly failure: string | null;
  readonly failedAt: string | null;
  /** The device its failed take emulated, where it named one. */
  readonly failedOn: string | null;
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
      failedOn: failed?.deviceName ?? null,
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
  return page.host === null ? undefined : serviceAtHost(page.host, services);
}

/** The service at a page's host: at its address, else the one its subdomain is named after. */
function serviceAtHost(
  host: string,
  services: ReadonlyArray<OutcomeService>,
): OutcomeService | undefined {
  const atAddress = services.find(
    (candidate) =>
      candidate.url !== null && URL.canParse(candidate.url) && new URL(candidate.url).host === host,
  );
  if (atAddress !== undefined) return atAddress;
  const label = host.split(".")[0]!.toLowerCase();
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

/**
 * "/status checked ✓", "both checks passed", or "2 pages checked, all 5
 * checks passed": only what passed. The home page is the service itself, so
 * its checks need no page named.
 */
function checkedLine(pages: ReadonlyArray<CheckedPage>): string | null {
  const count = pages.reduce((sum, page) => sum + page.takes.filter(passed).length, 0);
  if (pages.length === 0 || count === 0) return null;
  if (pages.length === 1) {
    const caption = pages[0]!.caption;
    if (caption === "/") return count === 1 ? "checked ✓" : checksWord(count);
    return count === 1 ? `${caption} checked ✓` : `${caption} checked, ${checksWord(count)}`;
  }
  return `${pages.length} pages checked, ${checksWord(count)}`;
}

function checkedOf(line: string | null): { readonly checked?: string } {
  return line === null ? {} : { checked: line };
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

/** What a service the platform says is down asks of its Mate, by how it is down. */
const PLATFORM_PROBLEM: Readonly<
  Record<"stopped" | "empty" | "failed", (hostname: string, word: string) => FixProblem>
> = {
  stopped: (hostname) => ({
    what: `${hostname} stopped`,
    ask: "Find out why it stopped, fix it, and start it again.",
  }),
  empty: (hostname) => ({
    what: `${hostname} has nothing deployed`,
    ask: "Find out why, fix it, and deploy it again.",
  }),
  failed: (hostname, word) => ({
    what: `${hostname}: ${word.toLowerCase()}`,
    ask: "Find out why it failed, fix it, and get it running again.",
  }),
};

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
  // The platform's word follows only what the run left running. One the run
  // left broken stays its own failure — a first deploy that failed leaves the
  // service ready to deploy, and the run's words say why.
  if (
    service.tone === "ok" &&
    status !== null &&
    (/FAIL/u.test(status) || NOT_RUNNING_STATUSES.has(status))
  ) {
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
      action: {
        kind: "fix",
        problem: {
          ...PLATFORM_PROBLEM[
            status === "STOPPED" ? "stopped" : status === "READY_TO_DEPLOY" ? "empty" : "failed"
          ](service.hostname, word),
          ...(since === null ? {} : { at: since }),
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
    sub: null,
    ...checkedOf(ok ? checkedLine(pages) : null),
    action: null,
  };
}

/**
 * A page whose check stayed failed, under what it belongs to: its service,
 * else its host. A check of the page already open named no address, so it
 * stands by what it can name — the browser, and the device it was on —
 * never "the page … the page".
 */
function failedPageRow(page: CheckedPage, owner: string | null): ResultRow {
  const on = page.failedOn === null ? "" : ` on ${page.failedOn}`;
  return {
    key: `page:${page.page}`,
    group: "broken",
    mark: "alert",
    tone: "failed",
    title: owner ?? "Browser check",
    words: owner === null ? `Failed${on}` : `Check of ${page.caption} failed`,
    version: null,
    // A failure with no word of why is said once, by the row's own words.
    sub: textSub(page.failure === "failed" ? null : page.failure),
    url: page.url,
    action: {
      kind: "fix",
      problem: {
        what:
          owner === null
            ? `A check in the browser${on} failed`
            : `The check of ${page.caption} on ${owner} failed`,
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
    sub: null,
    ...checkedOf(checkedLine(pages)),
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

/**
 * The change a run pushed, while it waits for the person's review — or, a
 * draft its Mate has not described yet, while it asks nothing of them.
 */
function changeRow(outcome: OutcomeModel, facts: ResultFacts): ResultRow | null {
  const change = ownChange(outcome);
  const forge = facts.changes;
  if (change === null || forge === undefined) return null;
  const open = forge.open.find((candidate) => changeKey(candidate) === changeKey(change));
  if (open === undefined) return null;
  const { files } = outcome;
  const draft = open.ready === false;
  return {
    key: `change:${changeKey(change)}`,
    group: draft ? "running" : "waiting",
    mark: "change",
    tone: "muted",
    title: `#${open.number} ${open.title}`,
    words: draft ? "Draft" : null,
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
            fromTurnId: files.fromTurnId,
          },
    url: null,
    action: draft
      ? null
      : {
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
    url: null,
    action: {
      kind: "review",
      target: { kind: "crew-task", environmentId: crew.environmentId, taskId: now.id },
    },
    ...(now.state === "ready"
      ? { tryIt: { environmentId: crew.environmentId, handle: now.owner } }
      : {}),
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
      rows.push(failedPageRow(page, owners.get(page) ?? page.host));
    }
  }
  // A page no service of the run serves stands by its host; one with no
  // address has nothing a row can say — its picture is the strip's.
  const loose = new Map<string, CheckedPage[]>();
  for (const page of pages) {
    if (page.failure !== null || owners.get(page) !== undefined || page.host === null) continue;
    const list = loose.get(page.host);
    if (list) list.push(page);
    else loose.set(page.host, [page]);
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
// The pictures
// ---------------------------------------------------------------------------

/** The narrowest and the widest a tile stands: past them a picture shows its top. */
export const TILE_RATIO_MIN = 0.45;
export const TILE_RATIO_MAX = 2.4;
/** The room a picture takes while its shape is not known: a desktop's. */
const TILE_RATIO_UNKNOWN = 1.6;

/**
 * A tile's shape, width over height, at the strip's one height: the
 * picture's own (the owner, 2026-09-29, of a phone's screenshot cut into a
 * 16:10 tile: "why these has different ration than the result?") — a phone's
 * whole and narrow, a desktop's whole and wide — within what a tile can hold:
 * past it, a full-page capture or a panorama shows its top. A shape not
 * known yet takes a desktop's room.
 */
export function tileRatio(ratio: number | null): number {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return TILE_RATIO_UNKNOWN;
  return Math.min(TILE_RATIO_MAX, Math.max(TILE_RATIO_MIN, ratio));
}

/** A picture as the result shows it, with what it is in words: its tooltip's and the viewer's. */
export type ResultPicture = OutcomePicture & { readonly label: string };

/** "/status in the browser", "/ on iPhone 16", "/admin in the browser, failed", "home-mobile.png". */
function pictureLabel(picture: OutcomePicture): string {
  if (picture.kind === "file") return picture.name;
  const where = picture.device === null ? "in the browser" : `on ${picture.device}`;
  return `${picture.caption} ${where}${picture.failed ? ", failed" : ""}`;
}

/**
 * The pictures a run's result shows, in the order they were taken: what its
 * checks took and what the Mate looked at (the owner, 2026-09-29: "if
 * anything it should show the screenshots") — less what a later run took
 * again: a page checked since, or a file looked at since, is that run's
 * picture now.
 */
/** At most this many tiles stand in the strip; the last says how many more the viewer holds. */
export const STRIP_TILES = 6;

/**
 * The files a result's strip draws: those among its first tiles, of the pictures that stand and
 * are placed under no row (`placeResultPictures`). An opened card leaves those to the result and
 * draws the rest in their steps — never a picture twice, never one only behind "+N".
 */
export function stripShowsFiles(strip: ReadonlyArray<ResultPicture>): ReadonlySet<string> {
  return new Set(
    strip
      .slice(0, STRIP_TILES)
      .flatMap((picture) => (picture.kind === "file" ? [picture.path] : [])),
  );
}

export function resultPictures(outcome: OutcomeModel): ReadonlyArray<ResultPicture> {
  const { later } = outcome;
  return outcome.pictures.flatMap((picture) =>
    (
      picture.kind === "check"
        ? later.views.includes(pageView(picture.page, picture.device))
        : later.files.includes(picture.path)
    )
      ? []
      : [{ ...picture, label: pictureLabel(picture) }],
  );
}

/** All result pictures keep their place, including files that are now unavailable. */
export function placeResultPictures(
  outcome: OutcomeModel,
  rows: ReadonlyArray<ResultRow>,
  hasWorkspace: boolean,
): ReturnType<typeof rowPictures> {
  const all = resultPictures(outcome);
  return rowPictures(
    outcome,
    rows,
    hasWorkspace ? all : all.filter((picture) => picture.kind === "check"),
  );
}

/**
 * The run's pictures by the row they stand under (the owner, 2026-09-30:
 * "showing only one of the images", under another service's row): each
 * page's pictures under the row of the service the page is at, in the order
 * they were taken; the rest — a file the Mate looked at, a page of no service
 * the result shows — in the strip under the rows.
 */
export function rowPictures(
  outcome: OutcomeModel,
  rows: ReadonlyArray<ResultRow>,
  pictures: ReadonlyArray<ResultPicture>,
): {
  readonly byRow: ReadonlyMap<string, ReadonlyArray<ResultPicture>>;
  readonly rest: ReadonlyArray<ResultPicture>;
} {
  const shown = new Set(rows.map((row) => row.key));
  const byRow = new Map<string, ResultPicture[]>();
  const rest: ResultPicture[] = [];
  for (const picture of pictures) {
    const host = picture.kind === "check" ? pageHost(picture.page) : null;
    const service = host === null ? undefined : serviceAtHost(host, outcome.live);
    const key = service === undefined ? null : `service:${service.hostname}`;
    if (key === null || !shown.has(key)) {
      rest.push(picture);
      continue;
    }
    byRow.set(key, [...(byRow.get(key) ?? []), picture]);
  }
  return { byRow, rest };
}

/** A page's host, where its page names one: `host/path`; null for "the page". */
function pageHost(page: string): string | null {
  const host = page.split("/")[0] ?? "";
  return host.includes(".") ? host : null;
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
