// @effect-diagnostics globalDate:off -- the mocked system time owns `Date.now()`; the client under test reads it.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { ARCHIVE_DEADLINE_MS, ARCHIVE_MAX_BYTES } from "@t3tools/shared/hqGitBrowse/archive";
import { makeAccountStore } from "../../data/store.ts";
import { makeGitBrowseReads } from "../../data/adapters/hqGitBrowse.ts";
import { gitBrowse } from "../../data/projections/gitBrowse.ts";
import { makeHqApi } from "../hq/client.ts";

const sha = "a".repeat(40);
const MiB = 1024 * 1024;

/**
 * HQ streaming an archive of `size` bytes, a MiB at a time, and how much of it was asked for; `cut`
 * ends the stream broken after its first MiB, `after` milliseconds into the read.
 */
const hqStreaming = (size: number, cut?: { readonly after: number }) => {
  const sent = { bytes: 0, cancelled: false, reads: 0 };
  const chunk = new Uint8Array(MiB);
  const api = makeHqApi({
    address: "https://hq.example",
    throughDoor: async (use) => use("door"),
    openSocket: () => {
      throw new Error("unused");
    },
    fetch: async (url) => {
      if (url.endsWith("/api/door"))
        return new Response(JSON.stringify({ session: "own", expiresAt: "later" }), {
          status: 200,
        });
      expect(url).toBe(
        `https://hq.example/api/apps/app/repos/shop/browse/archive?format=zip&sha=${sha}`,
      );
      sent.reads++;
      const asked = Date.now();
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (cut !== undefined && sent.bytes > 0) {
              vi.setSystemTime(asked + cut.after);
              return controller.error(new TypeError("network error"));
            }
            if (sent.bytes >= size) return controller.close();
            sent.bytes += chunk.byteLength;
            controller.enqueue(chunk);
          },
          cancel() {
            sent.cancelled = true;
          },
        }),
        { status: 200, headers: { "content-type": "application/zip" } },
      );
    },
  });
  return { api, sent };
};

/** The page's archive read through the account store, settled once it is no longer unread. */
const readArchive = async (api: ReturnType<typeof hqStreaming>["api"]) => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const reader = makeGitBrowseReads(store, api);
  const target = {
    orgId: "org",
    appId: "app",
    repo: "shop",
    read: "archive" as const,
    params: { sha, format: "zip" as const },
  };
  const projected = store.data.project(gitBrowse, { ...target, allowed: true });
  const settled = new Promise<void>((resolve) => {
    const stop = store.subscribe(() => {
      if (registry.get(projected).state === "unread") return;
      stop();
      resolve();
    });
  });
  const release = reader.demand(target);
  await settled;
  return {
    view: registry.get(projected),
    close: () => {
      release();
      reader.close();
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("Git browser archive", () => {
  it.each([
    {
      sentence: "An archive cut past its deadline says it took too long and is never read again",
      cut: ARCHIVE_DEADLINE_MS + 1000,
      view: {
        state: "refused",
        reason: "too_slow",
        words: "It took more than 2 minutes. Clone the repository instead.",
      },
    },
    {
      sentence: "An archive cut before its deadline reads as HQ out of reach",
      cut: 5000,
      view: { state: "failed", words: "HQ could not be reached." },
    },
  ])("$sentence", async ({ cut, view }) => {
    const { api, sent } = hqStreaming(10 * MiB, { after: cut });
    const read = await readArchive(api);
    expect(read.view).toMatchObject(view);
    expect(sent.reads).toBe(1);
    read.close();
  });

  it("An archive past the size cap stops and offers the clone", async () => {
    const { api, sent } = hqStreaming(10 * ARCHIVE_MAX_BYTES);
    const { view, close } = await readArchive(api);
    expect(view).toEqual({
      state: "refused",
      reason: "too_large",
      words: "It is larger than 100 MiB. Clone the repository instead.",
    });
    // Read no further than the cap: the rest of the stream was let go, never asked for.
    expect(sent.cancelled).toBe(true);
    expect(sent.bytes).toBeLessThanOrEqual(ARCHIVE_MAX_BYTES + 2 * MiB);
    close();
  });

  it("An archive within the size cap is held whole", async () => {
    const { api, sent } = hqStreaming(3 * MiB);
    const blob = await api.gitBrowseBytes("archive", "app", "shop", { sha, format: "zip" });
    expect(blob.size).toBe(3 * MiB);
    expect(blob.type).toBe("application/octet-stream");
    expect(sent.cancelled).toBe(false);
  });
});
