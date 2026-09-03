/**
 * The build log tail for a live deploy — `GET /project/{id}/log`'s signed
 * URL turned into the HTTP backfill + WebSocket stream URLs, and the item
 * shape both endpoints answer with.
 *
 * Ports the GUI's `getTrLogEndpoint`/`addTrLogParamsToUrl`
 * (`frontend-legacy` `trlog.utils.ts`) and its build-log query
 * (`pipeline-detail.feature.ts` `buildLogParams$`: `serviceStackId` = the
 * build container's own service, `tags=zbuilder@<appVersionId>`,
 * `from` = `pipelineStart − 5s`), and zcp's own verified item field names
 * (`internal/platform/logfetcher.go` `logAPIItem`: `message`, not `content`
 * — read defensively for either).
 */

export interface BuildLogQuery {
  readonly buildServiceStackId: string;
  readonly appVersionId: string;
  readonly fromIso?: string;
}

const DEFAULT_LIMIT = 500;

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

  return { http: httpUrl.toString(), ws: wsUrl.toString() };
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

/** Reads `{items:[{id,timestamp,content|message,severity,…}]}` — total, degrades per item. */
export function readBuildLogItems(body: unknown): ReadonlyArray<BuildLogLine> {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return [];
  }
  return body.items.flatMap((entry) => {
    const line = readLine(entry);
    return line === undefined ? [] : [line];
  });
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
