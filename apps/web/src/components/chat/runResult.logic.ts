/**
 * What a finished run leaves in its card: what is still open or still running
 * because of it, as rows in the card's grid, most important first — anything
 * still broken, then what waits for the person, then what runs — and nothing
 * it came back from on the way (the owner, 2026-09-29: "when something fails,
 * the agent tries again, it doesn't make sense to keep log of things that
 * were fixed later"). How it got there, failures and retries included, is the
 * work, one click away.
 *
 * Pure: the rows are read off the run's outcome (`deriveOutcome`).
 */
import type { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

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

/** Where a row stands: broken first, then what waits for the person, then what runs. */
export type ResultGroup = "broken" | "waiting" | "running";

const GROUP_ORDER: Readonly<Record<ResultGroup, number>> = { broken: 0, waiting: 1, running: 2 };

/** What stands in the mark column: a state's dot, or a glyph for what the thing is. */
export type ResultMark = "dot" | "alert" | "files";

/** The mark's colour: green runs, amber waits on the person, red is still broken. */
export type ResultTone = "ok" | "attention" | "failed" | "muted";

export type ResultSub =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "diff";
      /** Null where the row's own words count the files. */
      readonly files: number | null;
      readonly additions: number;
      readonly deletions: number;
    };

export type ResultAction = { readonly kind: "diff"; readonly turnId: TurnId };

export interface ResultRow {
  readonly key: string;
  readonly group: ResultGroup;
  readonly mark: ResultMark;
  readonly tone: ResultTone;
  /** What the row is about, in weight: "appdev", "3 files changed". */
  readonly title: string;
  /** Its state now, quieter: "Dev server running", "Build failing". */
  readonly words: string | null;
  /** The version it runs, short. */
  readonly version: string | null;
  /** The line under it: why it is broken, the pages checked on it, what changed. */
  readonly sub: ResultSub | null;
  /** The checks' pictures: each page's last. */
  readonly pictures: ReadonlyArray<ZeropsOperation>;
  /** Where it runs, opened from the row's end. */
  readonly url: string | null;
  readonly action: ResultAction | null;
}

/** At most this many pictures stand at a row's end; the work holds every take. */
const PICTURES_PER_ROW = 3;

/** One page the run checked, with every take of it and how the last of them ended. */
interface CheckedPage {
  readonly page: string;
  readonly caption: string;
  readonly host: string | null;
  readonly url: string | null;
  readonly takes: ReadonlyArray<ZeropsOperation>;
  /** Why its check failed, while it stays failed; null once a take passed. */
  readonly failure: string | null;
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

function checksWord(count: number): string {
  return count === 2 ? "both checks passed" : `all ${count} checks passed`;
}

/** "/status checked ✓", or "2 pages checked, all 5 checks passed": only what passed. */
function checkedLine(pages: ReadonlyArray<CheckedPage>): string | null {
  const count = pages.reduce((sum, page) => sum + page.takes.filter(passed).length, 0);
  if (pages.length === 0 || count === 0) return null;
  if (pages.length === 1) {
    const [page] = pages;
    return count === 1
      ? `${page!.caption} checked ✓`
      : `${page!.caption} checked, ${checksWord(count)}`;
  }
  return `${pages.length} pages checked, ${checksWord(count)}`;
}

function passed(take: ZeropsOperation): boolean {
  return take.phase === "done" && !browserCheckFailed(take);
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

const NO_PICTURES: ReadonlyArray<ZeropsOperation> = [];

function serviceRow(service: OutcomeService, pages: ReadonlyArray<CheckedPage>): ResultRow {
  const group: ResultGroup =
    service.tone === "failed" ? "broken" : service.tone === "attention" ? "waiting" : "running";
  const checked = service.tone === "ok" ? checkedLine(pages) : null;
  const sub = service.failure !== null ? service.failure.reason : checked;
  return {
    key: `service:${service.hostname}`,
    group,
    mark: service.tone === "failed" ? "alert" : "dot",
    tone: service.tone,
    title: service.hostname,
    words: service.word,
    version: service.version,
    sub: sub === null ? null : { kind: "text", text: sub },
    pictures: service.tone === "ok" ? picturesOf(pages) : NO_PICTURES,
    url: service.url ?? pages[0]?.url ?? null,
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
    sub: { kind: "text", text: page.failure ?? "failed" },
    pictures: picturesOf([page]),
    url: page.url,
    action: null,
  };
}

function pagesRow(host: string, pages: ReadonlyArray<CheckedPage>): ResultRow {
  const line = checkedLine(pages);
  return {
    key: `pages:${host}`,
    group: "running",
    mark: "dot",
    tone: "ok",
    title: host,
    words: null,
    version: null,
    sub: line === null ? null : { kind: "text", text: line },
    pictures: picturesOf(pages),
    url: pages.length === 1 ? pages[0]!.url : null,
    action: null,
  };
}

/**
 * The rows a run's result shows, most important first — broken, then waiting
 * for the person, then running; within each, in the order the run left them.
 */
export function resultRows(outcome: OutcomeModel): ResultRow[] {
  const pages = checkedPages(outcome.checks?.takes ?? []);
  const owners = new Map(
    pages.map((page) => [page, serviceOfPage(page, outcome.live)?.hostname] as const),
  );
  const rows: ResultRow[] = [];

  for (const service of outcome.live) {
    const own = pages.filter(
      (page) => page.failure === null && owners.get(page) === service.hostname,
    );
    rows.push(serviceRow(service, own));
  }
  for (const page of pages) {
    if (page.failure !== null)
      rows.push(failedPageRow(page, owners.get(page) ?? page.host ?? page.caption));
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

  if (outcome.files !== null) {
    const { count, additions, deletions, turnId } = outcome.files;
    rows.push({
      key: "files",
      group: "waiting",
      mark: "files",
      tone: "muted",
      title: count === 1 ? "1 file changed" : `${count} files changed`,
      words: null,
      version: null,
      sub: { kind: "diff", files: null, additions, deletions },
      pictures: NO_PICTURES,
      url: null,
      action: { kind: "diff", turnId },
    });
  }
  for (const item of outcome.notDone) {
    rows.push({
      key: `not-done:${item.key}`,
      group: "waiting",
      mark: "dot",
      tone: "attention",
      title: item.subject,
      words: item.word,
      version: null,
      sub: item.reason === null ? null : { kind: "text", text: item.reason },
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
 * What a finished run leaves in its card's foot, beside its time: the effort,
 * counting only what its result doesn't already show as a row — "2 commands ·
 * 1 file read" (K6). Checks and deploys are result rows and never calls; its
 * edits are its change's whenever it has one (the files it changed, a change
 * that landed), and are counted only when nothing else holds them. A change
 * of its that was merged is said once, first: "merged as #2 · 2 commands".
 * Null while there is nothing left to count.
 */
export function runEffortWords(outcome: OutcomeModel | null | undefined): string | null {
  if (outcome === null || outcome === undefined) return null;
  const merged = outcome.landed.map((change) => change.number);
  const changed = outcome.files !== null || merged.length > 0;
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
