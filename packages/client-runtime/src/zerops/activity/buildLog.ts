/**
 * The build log tail for a live deploy — `GET /project/{id}/log`'s signed
 * URL turned into the HTTP backfill + WebSocket stream URLs, and the item
 * shape both endpoints answer with.
 *
 * Ports the GUI's `getTrLogEndpoint`/`addTrLogParamsToUrl`
 * (`frontend-legacy` `trlog.utils.ts`) and its build-log query
 * (`pipeline-detail.feature.ts` `buildLogParams$`: `serviceStackId` = the
 * build container's own service, `tags=zbuilder@<appVersionId>`,
 * `from` = `pipelineStart − 5s`).
 *
 * Live-verified against the log backend (2026-09-03, from a container, a
 * real project's access URL): the access URL's own query already carries
 * the signed `accessToken` — every param here is *added* via
 * `URL.searchParams.set`, the existing query is never rebuilt or discarded.
 * `GET <access>&serviceStackId=<id>&limit=<n>&desc=1` → 200,
 * `{items:[…]}` newest first. The stream —
 * `wss://<same host>/api/rest/log/stream?<same query>&serviceStackId=<id>&limit=100&from=<newest loaded id>`
 * — handshakes and then answers with the SAME `{items:[…]}` batch shape per
 * frame (not one item per frame); with `from=<id>` the first frames replay
 * a backlog of older items, so the stream's initial burst can overlap the
 * HTTP backfill — `mergeBuildLogLines`'s dedupe-by-id absorbs it, `from` is
 * not a guarantee of "strictly after". A frame batch and the HTTP page
 * share ids, so ordering by `at` then `id` after merge (`mergeBuildLogLines`)
 * is correct for both. zcp's own field-name reading confirms `message`,
 * not only `content` (`internal/platform/logfetcher.go` `logAPIItem`) —
 * `decodeBuildLogItems` reads either, for both the HTTP body and a stream
 * frame (identical top-level `{items:[…]}` shape).
 */

export interface BuildLogQuery {
  readonly buildServiceStackId: string;
  readonly appVersionId: string;
  readonly fromIso?: string;
}

const DEFAULT_LIMIT = 500;
/** Live-verified: the GUI's stream request always sends this, independent of the backfill's own limit. */
const STREAM_LIMIT = 100;

/** The access URL may arrive as `GET https://…` (a legacy method-prefixed form) or bare. */
function rawAccessUrl(url: string): string {
  const stripped = url.replace(/^GET\s+/, "");
  return stripped.startsWith("http://") || stripped.startsWith("https://")
    ? stripped
    : `https://${stripped}`;
}

/**
 * `http` = the access URL with the build's query params added to whatever it
 * already carries (the signed `signature`/`expiry` pair); `ws` = the same
 * host/path, `https` swapped for `wss`, `/stream` inserted into the path
 * before the query.
 */
export function buildLogUrls(
  access: { readonly url: string },
  query: BuildLogQuery,
  limit: number = DEFAULT_LIMIT,
): { readonly http: string; readonly ws: string } {
  const httpUrl = new URL(rawAccessUrl(access.url));
  httpUrl.searchParams.set("serviceStackId", query.buildServiceStackId);
  httpUrl.searchParams.set("tags", `zbuilder@${query.appVersionId}`);
  httpUrl.searchParams.set("limit", String(limit));
  if (query.fromIso !== undefined) {
    httpUrl.searchParams.set("from", query.fromIso);
  }

  const wsUrl = new URL(httpUrl.toString());
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `${wsUrl.pathname}/stream`;
  // The live stream is not paginated the same way as the backfill — always
  // `limit=100`, independent of whatever backfill page size was asked for.
  wsUrl.searchParams.set("limit", String(STREAM_LIMIT));

  // The HTTP backfill wants the newest `limit` lines: the GUI's default
  // tail params always send `desc=1` (trlog.store.ts's `_toStateApiParams`)
  // and zcp's own log fetcher sets it unconditionally (logfetcher.go) —
  // without it, a log over `limit` lines backfills the OLDEST `limit`
  // lines instead. `mergeBuildLogLines` re-sorts ascending regardless of
  // what order the backend answers in. Set after cloning `wsUrl` — the
  // GUI's live-stream request never carries `desc`, so it stays off `ws`.
  httpUrl.searchParams.set("desc", "1");

  return { http: httpUrl.toString(), ws: wsUrl.toString() };
}

/**
 * Re-derives a stream url's `from` — used on reconnect, once the newest
 * already-loaded line's id is known (live-verified: the GUI's own reconnect
 * does the same, `trlog.store.ts`'s `_openLogStream$`: `from: data.items.at(-1).id`,
 * not a timestamp). Every other param is left exactly as it was.
 */
export function withStreamFrom(wsUrl: string, lineId: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("from", lineId);
  return url.toString();
}

/**
 * Builds the bounded page immediately before an already retained line. The
 * backend accepts line ids as cursors; `till` may overlap the retained edge,
 * so callers must still deduplicate by id.
 */
export function buildOlderLogUrl(
  access: { readonly url: string },
  query: BuildLogQuery,
  beforeLineId: string,
  limit: number = DEFAULT_LIMIT,
): string {
  const { http } = buildLogUrls(access, query, limit);
  const url = new URL(http);
  url.searchParams.set("till", beforeLineId);
  return url.toString();
}

export interface BuildLogLine {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  readonly severity: number;
}

const DEFAULT_SEVERITY = 6; // informational — matches zcp's own `mapSeverityToNumeric` fallback.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

function readSeverity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return DEFAULT_SEVERITY;
}

function readLine(entry: unknown): BuildLogLine | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const id = readString(entry.id);
  const at = readString(entry.timestamp);
  if (id === undefined || at === undefined) {
    return undefined;
  }
  const text = readString(entry.content) ?? readString(entry.message) ?? "";
  return { id, at, text, severity: readSeverity(entry.severity) };
}

export interface BuildLogDecodeResult {
  readonly lines: ReadonlyArray<BuildLogLine>;
  /** Rows rejected because their required id or timestamp was absent. */
  readonly rejectedItems: number;
  /** The response was not the documented `{ items: [...] }` envelope. */
  readonly malformedEnvelope: boolean;
}

/** Decodes a page/frame while retaining enough evidence to expose a gap. */
export function decodeBuildLogItems(body: unknown): BuildLogDecodeResult {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return { lines: [], rejectedItems: 0, malformedEnvelope: true };
  }
  const lines: BuildLogLine[] = [];
  let rejectedItems = 0;
  for (const entry of body.items) {
    const line = readLine(entry);
    if (line === undefined) {
      rejectedItems += 1;
    } else {
      lines.push(line);
    }
  }
  return { lines, rejectedItems, malformedEnvelope: false };
}

const DEFAULT_CAP = 2_000;

function compareLines(a: BuildLogLine, b: BuildLogLine): number {
  const byTime = Date.parse(a.at) - Date.parse(b.at);
  if (byTime !== 0) {
    return byTime;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Dedupes by id, orders by `at` then `id`, and tail-trims to the newest `cap` lines. */
export function mergeBuildLogLines(
  existing: ReadonlyArray<BuildLogLine>,
  incoming: ReadonlyArray<BuildLogLine>,
  cap: number = DEFAULT_CAP,
): ReadonlyArray<BuildLogLine> {
  const byId = new Map<string, BuildLogLine>();
  for (const line of existing) {
    byId.set(line.id, line);
  }
  for (const line of incoming) {
    byId.set(line.id, line);
  }
  const merged = [...byId.values()].sort(compareLines);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

export interface BuildLogRetentionBounds {
  readonly maxLines: number;
  readonly maxBytes: number;
}

export interface BuildLogWindow {
  readonly lines: ReadonlyArray<BuildLogLine>;
  readonly bytes: number;
  readonly droppedLines: number;
  readonly droppedBytes: number;
  readonly droppedOlder: boolean;
  readonly droppedNewer: boolean;
}

/** Approximate retained payload bytes using the exact UTF-8 size of public fields. */
export function buildLogLineBytes(line: BuildLogLine): number {
  return new TextEncoder().encode(`${line.id}\0${line.at}\0${line.text}`).byteLength + 8;
}

/**
 * Deduplicates and applies both line and byte bounds. Tail/follow ingestion
 * retains newest lines; loading an older page retains the oldest available
 * side. Any discarded payload is returned so the session can expose the gap.
 */
export function mergeBoundedBuildLogLines(
  existing: ReadonlyArray<BuildLogLine>,
  incoming: ReadonlyArray<BuildLogLine>,
  bounds: BuildLogRetentionBounds,
  retain: "newest" | "oldest",
): BuildLogWindow {
  const merged = mergeBuildLogLines(existing, incoming, Number.MAX_SAFE_INTEGER);
  const retained: BuildLogLine[] = [];
  let retainedBytes = 0;
  let droppedLines = 0;
  let droppedBytes = 0;
  const ordered = retain === "newest" ? [...merged].reverse() : merged;

  for (const line of ordered) {
    const bytes = buildLogLineBytes(line);
    if (retained.length >= bounds.maxLines || retainedBytes + bytes > bounds.maxBytes) {
      droppedLines += 1;
      droppedBytes += bytes;
      continue;
    }
    retained.push(line);
    retainedBytes += bytes;
  }

  const resultLines = retain === "newest" ? [...retained].reverse() : retained;
  const retainedIds = new Set(resultLines.map(({ id }) => id));
  const retainedIndexes = merged.flatMap((line, index) =>
    retainedIds.has(line.id) ? [index] : [],
  );
  const firstRetained = retainedIndexes.at(0);
  const lastRetained = retainedIndexes.at(-1);
  let droppedOlder = false;
  let droppedNewer = false;
  if (droppedLines > 0 && (firstRetained === undefined || lastRetained === undefined)) {
    droppedOlder = true;
    droppedNewer = true;
  } else {
    for (let index = 0; index < merged.length; index += 1) {
      if (retainedIds.has(merged[index]!.id)) continue;
      if (index < firstRetained!) droppedOlder = true;
      else if (index > lastRetained!) droppedNewer = true;
      else {
        droppedOlder = true;
        droppedNewer = true;
      }
    }
  }
  return {
    lines: resultLines,
    bytes: retainedBytes,
    droppedLines,
    droppedBytes,
    droppedOlder,
    droppedNewer,
  };
}

/** One row of a build log's tail: a line, or a run of lines alike but for one package. */
export interface FoldedBuildLogLine {
  /** The run's first line's id — the row keeps it while the run grows. */
  readonly id: string;
  /** The run's newest line. */
  readonly text: string;
  readonly severity: number;
  /** How many consecutive lines the row stands for. */
  readonly count: number;
}

/** zcp's `mapSeverityToNumeric`: 0 (emergency) through 3 (error) — a line never folded away. */
const ERROR_SEVERITY_MAX = 3;

/** The punctuation a log line wraps a token in: `(v6.3.4):` names the version `v6.3.4`. */
const WRAPPING = /^[("'`[{<]+|[)"'`\]}>:;,.]+$/gu;
const VERSION = /^v?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/u;
const LETTER = /[A-Za-z]/u;

const core = (token: string): string => token.replace(WRAPPING, "");

const isVersionToken = (token: string): boolean => VERSION.test(core(token));

/** A package or a version: `name@1.2.3`, `vendor/name`, `name==1.2`, `name-1.2.3-….zip`, `v1.2.3`. */
function isPackageToken(token: string): boolean {
  const text = core(token);
  return (
    VERSION.test(text) ||
    /[0-9A-Za-z]@[0-9A-Za-z^~<>=*]/u.test(text) ||
    (LETTER.test(text) && /[0-9A-Za-z]\/[0-9A-Za-z@]/u.test(text)) ||
    /[A-Za-z][\w.]*(?:[-_]|==|>=|<=|~=)v?\d+\.\d+/u.test(text)
  );
}

/** A package's name as a line spells it before its version: `serde`, `react-dom`, `symfony/console`. */
const isPackageName = (token: string): boolean => {
  const text = core(token);
  return LETTER.test(text) && /^[\w@./+=~-]+$/u.test(text);
};

interface LineShape {
  readonly indent: string;
  readonly tokens: ReadonlyArray<string>;
}

function shapeOf(text: string): LineShape {
  const indent = /^\s*/u.exec(text)?.[0] ?? "";
  const body = text.slice(indent.length).trimEnd();
  return { indent, tokens: body.length === 0 ? [] : body.split(/\s+/u) };
}

/** Where a run varies: one token that is a package, or a name and the version after it. */
interface Span {
  readonly start: number;
  readonly width: 1 | 2;
}

function spanFits(span: Span, tokens: ReadonlyArray<string>): boolean {
  const first = tokens[span.start];
  const second = tokens[span.start + 1];
  if (first === undefined) {
    return false;
  }
  return span.width === 1
    ? isPackageToken(first)
    : second !== undefined && isPackageName(first) && isVersionToken(second);
}

interface Run {
  readonly id: string;
  readonly severity: number;
  text: string;
  count: number;
  shape: LineShape;
  span: Span | undefined;
}

/** The span a line of `severity` and `shape` folds into `run` with — `undefined` for a verbatim repeat — or `null`. */
function foldSpan(run: Run, severity: number, shape: LineShape): Span | undefined | null {
  if (severity !== run.severity || severity <= ERROR_SEVERITY_MAX) {
    return null;
  }
  const previous = run.shape;
  if (shape.indent !== previous.indent || shape.tokens.length !== previous.tokens.length) {
    return null;
  }
  const diff = shape.tokens.flatMap((token, index) =>
    token === previous.tokens[index] ? [] : [index],
  );
  if (diff.length === 0) {
    return run.span;
  }
  const first = diff[0]!;
  const span: Span | null =
    run.span ??
    (diff.length === 1
      ? { start: first, width: 1 }
      : diff.length === 2 && diff[1] === first + 1
        ? { start: first, width: 2 }
        : null);
  if (
    span === null ||
    diff.some((index) => index < span.start || index >= span.start + span.width)
  ) {
    return null;
  }
  return spanFits(span, previous.tokens) && spanFits(span, shape.tokens) ? span : null;
}

/**
 * The tail's rows: a run of consecutive lines that differ only in one
 * package — a token like `cssesc@npm:3.0.0`, `symfony/console` or `v1.9.1`,
 * or a name and the version after it (`serde v1.0.193`) — is one row, read
 * as its newest line and counted. The rule is conservative: every other token
 * must match, as must the indent and the severity; a line repeated verbatim
 * folds too; an error line never does.
 */
export function foldBuildLogLines(
  lines: ReadonlyArray<BuildLogLine>,
): ReadonlyArray<FoldedBuildLogLine> {
  const runs: Array<Run> = [];
  for (const line of lines) {
    const shape = shapeOf(line.text);
    const run = runs.at(-1);
    const span = run === undefined ? null : foldSpan(run, line.severity, shape);
    if (run !== undefined && span !== null) {
      run.text = line.text;
      run.count += 1;
      run.shape = shape;
      run.span = span;
      continue;
    }
    runs.push({
      id: line.id,
      severity: line.severity,
      text: line.text,
      count: 1,
      shape,
      span: undefined,
    });
  }
  return runs.map(({ id, text, severity, count }) => ({ id, text, severity, count }));
}
