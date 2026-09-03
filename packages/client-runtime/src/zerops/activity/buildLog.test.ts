import { describe, expect, it } from "vite-plus/test";

import {
  buildLogUrls,
  mergeBuildLogLines,
  readBuildLogItems,
  withStreamFrom,
  type BuildLogLine,
} from "./buildLog.ts";

describe("buildLogUrls", () => {
  const access = { url: "GET https://proxy.example.com/api/rest/log?signature=abc&expiry=123" };
  const query = { buildServiceStackId: "build-svc-1", appVersionId: "av-1" };

  it("strips a leading GET and adds serviceStackId/tags/limit to the existing query", () => {
    const { http } = buildLogUrls(access, query);
    const url = new URL(http);
    expect(url.protocol).toBe("https:");
    expect(url.searchParams.get("signature")).toBe("abc");
    expect(url.searchParams.get("expiry")).toBe("123");
    expect(url.searchParams.get("serviceStackId")).toBe("build-svc-1");
    expect(url.searchParams.get("tags")).toBe("zbuilder@av-1");
    expect(url.searchParams.get("limit")).toBe("500");
  });

  it("honours a custom limit", () => {
    const { http } = buildLogUrls(access, query, 100);
    expect(new URL(http).searchParams.get("limit")).toBe("100");
  });

  it("adds `from` only when fromIso is given", () => {
    const withFrom = buildLogUrls(access, { ...query, fromIso: "2026-09-02T09:59:50.000Z" });
    expect(new URL(withFrom.http).searchParams.get("from")).toBe("2026-09-02T09:59:50.000Z");

    const withoutFrom = buildLogUrls(access, query);
    expect(new URL(withoutFrom.http).searchParams.has("from")).toBe(false);
  });

  it("builds the ws url by swapping https for wss and inserting /stream before the query", () => {
    const { http, ws } = buildLogUrls(access, query);
    const httpUrl = new URL(http);
    const wsUrl = new URL(ws);
    expect(wsUrl.protocol).toBe("wss:");
    expect(wsUrl.host).toBe(httpUrl.host);
    expect(wsUrl.pathname).toBe(`${httpUrl.pathname}/stream`);
    expect(wsUrl.searchParams.get("serviceStackId")).toBe("build-svc-1");
    expect(wsUrl.searchParams.get("tags")).toBe("zbuilder@av-1");
    expect(wsUrl.searchParams.get("signature")).toBe("abc");
    expect(wsUrl.searchParams.get("expiry")).toBe("123");
  });

  /**
   * Live-verified against the log backend: the stream request always sends
   * `limit=100`, independent of whatever backfill page size was asked for
   * (the GUI's own `_openLogStream$` hardcodes the same value).
   */
  it("always sends limit=100 on the ws stream, regardless of the http limit", () => {
    const { ws } = buildLogUrls(access, query, 500);
    expect(new URL(ws).searchParams.get("limit")).toBe("100");
  });

  it("adds https:// when the access url has no protocol at all", () => {
    const { http } = buildLogUrls({ url: "proxy.example.com/api/rest/log?signature=abc" }, query);
    expect(http.startsWith("https://")).toBe(true);
  });

  /**
   * The GUI's default tail params always send `desc=1` (trlog.store.ts's
   * `_toStateApiParams`), and zcp's own log fetcher sets it unconditionally
   * (logfetcher.go) — without it a log over `limit` lines backfills the
   * OLDEST `limit` lines instead of the newest. `mergeBuildLogLines`
   * re-sorts ascending regardless of what order the backend answers in.
   *
   * The live stream never carries `desc` in the GUI's own request either,
   * so it stays off the ws url.
   */
  it("sends desc=1 on the HTTP backfill only, never on the ws stream", () => {
    const { http, ws } = buildLogUrls(access, query);
    expect(new URL(http).searchParams.get("desc")).toBe("1");
    expect(new URL(ws).searchParams.has("desc")).toBe(false);
  });
});

describe("withStreamFrom", () => {
  const access = { url: "GET https://proxy.example.com/api/rest/log?signature=abc&expiry=123" };
  const query = { buildServiceStackId: "build-svc-1", appVersionId: "av-1" };

  /**
   * Live-verified: reopening the stream must pass the newest already-loaded
   * line's id as `from`, not a timestamp — the GUI's own reconnect does the
   * same (trlog.store.ts's `_openLogStream$`: `from: data.items.at(-1).id`).
   */
  it("sets from to the given line id, replacing any existing from", () => {
    const { ws } = buildLogUrls(access, { ...query, fromIso: "2026-09-02T09:59:50.000Z" });
    const updated = withStreamFrom(ws, "line-42");
    expect(new URL(updated).searchParams.get("from")).toBe("line-42");
  });

  it("adds from when the ws url did not carry one yet", () => {
    const { ws } = buildLogUrls(access, query);
    expect(new URL(ws).searchParams.has("from")).toBe(false);
    const updated = withStreamFrom(ws, "line-1");
    expect(new URL(updated).searchParams.get("from")).toBe("line-1");
  });

  it("leaves every other param untouched", () => {
    const { ws } = buildLogUrls(access, query);
    const updated = new URL(withStreamFrom(ws, "line-1"));
    const original = new URL(ws);
    expect(updated.searchParams.get("serviceStackId")).toBe(
      original.searchParams.get("serviceStackId"),
    );
    expect(updated.searchParams.get("limit")).toBe(original.searchParams.get("limit"));
    expect(updated.pathname).toBe(original.pathname);
  });
});

describe("readBuildLogItems", () => {
  it("reads id/timestamp/content/severity into a BuildLogLine", () => {
    const lines = readBuildLogItems({
      items: [
        { id: "l1", timestamp: "2026-09-02T10:00:00.000Z", content: "Building…", severity: 6 },
      ],
    });
    expect(lines).toEqual([
      { id: "l1", at: "2026-09-02T10:00:00.000Z", text: "Building…", severity: 6 },
    ]);
  });

  it("reads `message` when `content` is absent (the stream item shape)", () => {
    const lines = readBuildLogItems({
      items: [
        { id: "l1", timestamp: "2026-09-02T10:00:00.000Z", message: "Building…", severity: 3 },
      ],
    });
    expect(lines[0]?.text).toBe("Building…");
  });

  it("defaults severity to informational (6) when missing or unreadable", () => {
    const lines = readBuildLogItems({
      items: [{ id: "l1", timestamp: "t", content: "x", severity: "not-a-number" }],
    });
    expect(lines[0]?.severity).toBe(6);
  });

  it("drops an item missing id or timestamp, keeping the rest — total reader", () => {
    const lines = readBuildLogItems({
      items: [
        { timestamp: "t", content: "no id" },
        { id: "l2", content: "no timestamp" },
        { id: "l3", timestamp: "t", content: "ok" },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.id).toBe("l3");
  });

  it("returns an empty array for an unreadable document", () => {
    expect(readBuildLogItems(undefined)).toEqual([]);
    expect(readBuildLogItems(null)).toEqual([]);
    expect(readBuildLogItems({})).toEqual([]);
    expect(readBuildLogItems({ items: "not-an-array" })).toEqual([]);
  });
});

describe("mergeBuildLogLines", () => {
  function line(overrides: Partial<BuildLogLine>): BuildLogLine {
    return { id: "l1", at: "2026-09-02T10:00:00.000Z", text: "x", severity: 6, ...overrides };
  }

  it("dedupes by id and orders by at, then id", () => {
    const a = line({ id: "l1", at: "2026-09-02T10:00:01.000Z" });
    const b = line({ id: "l2", at: "2026-09-02T10:00:00.000Z" });
    const aAgain = line({ id: "l1", at: "2026-09-02T10:00:01.000Z", text: "still x" });
    expect(mergeBuildLogLines([a], [b, aAgain])).toEqual([b, aAgain]);
  });

  it("breaks a same-timestamp tie by id", () => {
    const a = line({ id: "l2", at: "2026-09-02T10:00:00.000Z" });
    const b = line({ id: "l1", at: "2026-09-02T10:00:00.000Z" });
    expect(mergeBuildLogLines([], [a, b])).toEqual([b, a]);
  });

  it("caps the merged result to the newest `cap` lines", () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      line({ id: `l${i}`, at: `2026-09-02T10:00:0${i}.000Z` }),
    );
    const merged = mergeBuildLogLines([], lines, 2);
    expect(merged.map((l) => l.id)).toEqual(["l3", "l4"]);
  });
});
