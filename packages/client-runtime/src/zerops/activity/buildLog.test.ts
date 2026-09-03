import { describe, expect, it } from "vite-plus/test";

import {
  buildLogUrls,
  mergeBuildLogLines,
  readBuildLogItems,
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
    expect(wsUrl.search).toBe(httpUrl.search);
  });

  it("adds https:// when the access url has no protocol at all", () => {
    const { http } = buildLogUrls({ url: "proxy.example.com/api/rest/log?signature=abc" }, query);
    expect(http.startsWith("https://")).toBe(true);
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
