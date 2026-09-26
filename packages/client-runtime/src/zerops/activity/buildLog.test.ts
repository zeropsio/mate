import { describe, expect, it } from "vite-plus/test";

import {
  buildLogLineBytes,
  buildOlderLogUrl,
  buildLogUrls,
  decodeBuildLogItems,
  foldBuildLogLines,
  mergeBoundedBuildLogLines,
  mergeBuildLogLines,
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

describe("buildOlderLogUrl", () => {
  it("uses the oldest retained line id as `till` without losing the signed query", () => {
    const url = new URL(
      buildOlderLogUrl(
        { url: "https://proxy.example.com/api/rest/log?signature=secret" },
        { buildServiceStackId: "build-1", appVersionId: "version-1" },
        "line-10",
        25,
      ),
    );
    expect(url.searchParams.get("signature")).toBe("secret");
    expect(url.searchParams.get("till")).toBe("line-10");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("desc")).toBe("1");
  });
});

describe("decodeBuildLogItems", () => {
  it("reads id/timestamp/content/severity into a BuildLogLine", () => {
    const lines = decodeBuildLogItems({
      items: [
        { id: "l1", timestamp: "2026-09-02T10:00:00.000Z", content: "Building…", severity: 6 },
      ],
    }).lines;
    expect(lines).toEqual([
      { id: "l1", at: "2026-09-02T10:00:00.000Z", text: "Building…", severity: 6 },
    ]);
  });

  it("reads `message` when `content` is absent (the stream item shape)", () => {
    const lines = decodeBuildLogItems({
      items: [
        { id: "l1", timestamp: "2026-09-02T10:00:00.000Z", message: "Building…", severity: 3 },
      ],
    }).lines;
    expect(lines[0]?.text).toBe("Building…");
  });

  it("defaults severity to informational (6) when missing or unreadable", () => {
    const lines = decodeBuildLogItems({
      items: [{ id: "l1", timestamp: "t", content: "x", severity: "not-a-number" }],
    }).lines;
    expect(lines[0]?.severity).toBe(6);
  });

  it("drops an item missing id or timestamp, keeping the rest — total reader", () => {
    const lines = decodeBuildLogItems({
      items: [
        { timestamp: "t", content: "no id" },
        { id: "l2", content: "no timestamp" },
        { id: "l3", timestamp: "t", content: "ok" },
      ],
    }).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.id).toBe("l3");
  });

  it("returns an empty array for an unreadable document", () => {
    expect(decodeBuildLogItems(undefined).lines).toEqual([]);
    expect(decodeBuildLogItems(null).lines).toEqual([]);
    expect(decodeBuildLogItems({}).lines).toEqual([]);
    expect(decodeBuildLogItems({ items: "not-an-array" }).lines).toEqual([]);
  });

  it("reports malformed envelopes and rejected rows separately from valid empty pages", () => {
    expect(decodeBuildLogItems(undefined)).toEqual({
      lines: [],
      rejectedItems: 0,
      malformedEnvelope: true,
    });
    expect(
      decodeBuildLogItems({ items: [{ id: "valid", timestamp: "t" }, { timestamp: "bad" }] }),
    ).toEqual({
      lines: [{ id: "valid", at: "t", text: "", severity: 6 }],
      rejectedItems: 1,
      malformedEnvelope: false,
    });
    expect(decodeBuildLogItems({ items: [] }).malformedEnvelope).toBe(false);
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

  it("applies line and UTF-8 byte bounds with explicit discarded sides", () => {
    const one = line({ id: "l1", at: "2026-09-02T10:00:01.000Z", text: "one" });
    const two = line({ id: "l2", at: "2026-09-02T10:00:02.000Z", text: "two" });
    const three = line({ id: "l3", at: "2026-09-02T10:00:03.000Z", text: "three" });
    const newest = mergeBoundedBuildLogLines(
      [],
      [one, two, three],
      { maxLines: 2, maxBytes: buildLogLineBytes(two) + buildLogLineBytes(three) },
      "newest",
    );
    expect(newest.lines).toEqual([two, three]);
    expect(newest.droppedOlder).toBe(true);
    expect(newest.droppedNewer).toBe(false);

    const oldest = mergeBoundedBuildLogLines(
      [two, three],
      [one, two],
      { maxLines: 2, maxBytes: Number.MAX_SAFE_INTEGER },
      "oldest",
    );
    expect(oldest.lines).toEqual([one, two]);
    expect(oldest.droppedOlder).toBe(false);
    expect(oldest.droppedNewer).toBe(true);
  });
});

describe("foldBuildLogLines — consecutive lines that differ only in a package collapse", () => {
  const lines = (texts: ReadonlyArray<string>, severity = 6): ReadonlyArray<BuildLogLine> =>
    texts.map((text, index) => ({
      id: `l${index + 1}`,
      at: `2026-09-26T10:00:${String(index).padStart(2, "0")}.000Z`,
      text,
      severity,
    }));
  /** Each row as `text ×count`, the way the tail reads it. */
  const rowsOf = (texts: ReadonlyArray<string>, severity?: number) =>
    foldBuildLogLines(lines(texts, severity)).map(({ text, count }) =>
      count === 1 ? text : `${text} ×${count}`,
    );

  it.each([
    {
      name: "yarn berry: a fetch step's packages",
      texts: [
        "➤ YN0000: ┌ Fetch step",
        "➤ YN0013: │ cssesc@npm:3.0.0 can't be found in the cache and will be fetched from the remote registry",
        "➤ YN0013: │ csstype@npm:3.1.3 can't be found in the cache and will be fetched from the remote registry",
        "➤ YN0013: │ @types/node@npm:20.8.10 can't be found in the cache and will be fetched from the remote registry",
        "➤ YN0000: └ Completed in 12s 345ms",
      ],
      rows: [
        "➤ YN0000: ┌ Fetch step",
        "➤ YN0013: │ @types/node@npm:20.8.10 can't be found in the cache and will be fetched from the remote registry ×3",
        "➤ YN0000: └ Completed in 12s 345ms",
      ],
    },
    {
      name: "yarn berry: archives removed from the cache",
      texts: [
        "➤ YN0019: │ cssesc-npm-3.0.0-9a3ae3a5a4-f8c4ababff.zip appears to be unused - removing",
        "➤ YN0019: │ lodash-npm-4.17.21-6382451519-eb835a2e51.zip appears to be unused - removing",
      ],
      rows: [
        "➤ YN0019: │ lodash-npm-4.17.21-6382451519-eb835a2e51.zip appears to be unused - removing ×2",
      ],
    },
    {
      name: "yarn classic: its four phases stay four lines",
      texts: [
        "[1/4] Resolving packages...",
        "[2/4] Fetching packages...",
        "[3/4] Linking dependencies...",
        "[4/4] Building fresh packages...",
      ],
      rows: [
        "[1/4] Resolving packages...",
        "[2/4] Fetching packages...",
        "[3/4] Linking dependencies...",
        "[4/4] Building fresh packages...",
      ],
    },
    {
      name: "npm: deprecation warnings each say something of their own",
      texts: [
        "npm WARN deprecated inflight@1.0.6: This module is not supported, and leaks memory.",
        "npm WARN deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported",
        "added 312 packages, and audited 313 packages in 9s",
      ],
      rows: [
        "npm WARN deprecated inflight@1.0.6: This module is not supported, and leaks memory.",
        "npm WARN deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported",
        "added 312 packages, and audited 313 packages in 9s",
      ],
    },
    {
      name: "pnpm: a dependency list, name and version",
      texts: ["dependencies:", "+ next 14.0.4", "+ react 18.2.0", "+ react-dom 18.2.0"],
      rows: ["dependencies:", "+ react-dom 18.2.0 ×3"],
    },
    {
      name: "pnpm: progress counts are not packages",
      texts: [
        "Progress: resolved 120, reused 0, downloaded 118, added 0",
        "Progress: resolved 240, reused 0, downloaded 236, added 0",
      ],
      rows: [
        "Progress: resolved 120, reused 0, downloaded 118, added 0",
        "Progress: resolved 240, reused 0, downloaded 236, added 0",
      ],
    },
    {
      name: "go: modules downloading, path and version",
      texts: [
        "go: downloading github.com/gin-gonic/gin v1.9.1",
        "go: downloading golang.org/x/net v0.17.0",
        "go: downloading github.com/bytedance/sonic v1.10.2",
        "go: found github.com/gin-gonic/gin in github.com/gin-gonic/gin v1.9.1",
      ],
      rows: [
        "go: downloading github.com/bytedance/sonic v1.10.2 ×3",
        "go: found github.com/gin-gonic/gin in github.com/gin-gonic/gin v1.9.1",
      ],
    },
    {
      name: "composer: downloads, then installs",
      texts: [
        "  - Downloading symfony/console (v6.3.4)",
        "  - Downloading psr/log (3.0.0)",
        "  - Installing symfony/console (v6.3.4): Extracting archive",
        "  - Installing psr/log (3.0.0): Extracting archive",
        "Generating optimized autoload files",
      ],
      rows: [
        "  - Downloading psr/log (3.0.0) ×2",
        "  - Installing psr/log (3.0.0): Extracting archive ×2",
        "Generating optimized autoload files",
      ],
    },
    {
      name: "pip: requirements collected; wheel sizes differ, so downloads stay apart",
      texts: [
        "Collecting fastapi==0.104.1",
        "Collecting uvicorn==0.24.0",
        "  Downloading fastapi-0.104.1-py3-none-any.whl (92 kB)",
        "  Downloading uvicorn-0.24.0-py3-none-any.whl (59 kB)",
      ],
      rows: [
        "Collecting uvicorn==0.24.0 ×2",
        "  Downloading fastapi-0.104.1-py3-none-any.whl (92 kB)",
        "  Downloading uvicorn-0.24.0-py3-none-any.whl (59 kB)",
      ],
    },
    {
      name: "cargo: crates compiling, name and version",
      texts: ["   Compiling serde v1.0.193", "   Compiling tokio v1.35.0", "    Finished release"],
      rows: ["   Compiling tokio v1.35.0 ×2", "    Finished release"],
    },
    {
      name: "a line repeated verbatim",
      texts: ["waiting for the database", "waiting for the database", "ready"],
      rows: ["waiting for the database ×2", "ready"],
    },
    {
      name: "two tokens apart are two changes, not one package",
      texts: ["fetch a@1.0.0 took 3ms", "fetch b@2.0.0 took 9ms"],
      rows: ["fetch a@1.0.0 took 3ms", "fetch b@2.0.0 took 9ms"],
    },
    {
      name: "a word that changes is not a package",
      texts: ["Step build done", "Step deploy done"],
      rows: ["Step build done", "Step deploy done"],
    },
    {
      name: "a run keeps the one place it varies",
      texts: ["get a@1.0.0 from x/y", "get b@1.0.0 from x/y", "get b@1.0.0 from x/z"],
      rows: ["get b@1.0.0 from x/y ×2", "get b@1.0.0 from x/z"],
    },
  ])("$name", ({ texts, rows }) => {
    expect(rowsOf(texts)).toEqual(rows);
  });

  it("never folds an error line, however alike", () => {
    expect(
      rowsOf(["npm ERR! 404 Not Found - GET a@1.0.0", "npm ERR! 404 Not Found - GET b@1.0.0"], 3),
    ).toEqual(["npm ERR! 404 Not Found - GET a@1.0.0", "npm ERR! 404 Not Found - GET b@1.0.0"]);
  });

  it("never folds lines of a different severity", () => {
    const folded = foldBuildLogLines([
      { id: "a", at: "2026-09-26T10:00:00.000Z", text: "get a@1.0.0", severity: 6 },
      { id: "b", at: "2026-09-26T10:00:01.000Z", text: "get b@1.0.0", severity: 4 },
    ]);
    expect(folded.map(({ count }) => count)).toEqual([1, 1]);
  });

  it("a row keeps its first line's id and the newest line's words while the run grows", () => {
    const folded = foldBuildLogLines(
      lines(["get a@1.0.0 now", "get b@1.0.0 now", "get c@1.0.0 now"]),
    );
    expect(folded).toEqual([{ id: "l1", text: "get c@1.0.0 now", severity: 6, count: 3 }]);
  });
});
