import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { readZeropsContainer } from "./containerHealth.ts";
import {
  DESCRIPTOR_READ_DEADLINE_MS,
  DESCRIPTOR_SHARE_MS,
  makeDescriptorShare,
} from "./descriptorShare.ts";

const ORIGIN = "https://zcp-test-8080.prg1.zerops.app";
const BASE = `${ORIGIN}/mate`;
const DESCRIPTOR_URL = `${BASE}/.well-known/t3/environment`;
const HEALTHZ_URL = `${BASE}/healthz`;

const DESCRIPTOR = {
  environmentId: "env-share",
  label: "zcp",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.11.83",
  capabilities: { repositoryIdentity: true },
  basePath: "/mate",
  zerops: { projectId: "project-1", identity: "ok" },
};

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** Answers settle across a few promise hops; this lets every one of them land. */
const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
};

/**
 * A Mate behind a fetch the test answers by hand: every request waits in `pending` until
 * `answer` settles the oldest one for its URL.
 */
function rig() {
  let mono = 0;
  /** Wall time a sleep added: the monotonic clock stands still while the machine sleeps. */
  let slept = 0;
  const timers = new Map<number, { readonly at: number; readonly fire: () => void }>();
  let nextTimer = 0;
  const requests: Array<string> = [];
  const pending: Array<{
    readonly url: string;
    readonly resolve: (response: Response) => void;
    readonly reject: (cause: unknown) => void;
  }> = [];
  const fetch = (url: string, init?: RequestInit): Promise<Response> => {
    requests.push(url);
    return new Promise((resolve, reject) => {
      const request = { url, resolve, reject };
      pending.push(request);
      init?.signal?.addEventListener("abort", () => {
        pending.splice(pending.indexOf(request), 1);
        reject(new Error("aborted"));
      });
    });
  };
  const share = makeDescriptorShare({
    clock: {
      now: () => ({ wall: 1_800_000_000_000 + mono + slept, mono }),
      setTimer: (delayMs, fire) => {
        const id = nextTimer;
        nextTimer += 1;
        timers.set(id, { at: mono + delayMs, fire });
        return () => {
          timers.delete(id);
        };
      },
    },
    fetch,
  });
  return {
    share,
    fetch,
    requests,
    /** Settles the oldest request for the URL still waiting. */
    answer: async (url: string, response: () => Response) => {
      const index = pending.findIndex((request) => request.url === url);
      if (index < 0) throw new Error(`no request waits for ${url}`);
      const [request] = pending.splice(index, 1);
      try {
        request!.resolve(response());
      } catch (cause) {
        request!.reject(cause);
      }
      await flush();
    },
    /** The machine sleeps: wall time moves, the monotonic clock does not. */
    sleep: (ms: number) => {
      slept += ms;
    },
    advance: async (ms: number) => {
      mono += ms;
      for (const [id, timer] of timers) {
        if (timer.at > mono) continue;
        timers.delete(id);
        timer.fire();
      }
      await flush();
    },
  };
}

type Rig = ReturnType<typeof rig>;

const blocked = (): Response => {
  throw new TypeError("Failed to fetch");
};

/** The three readers of one connect, each as its port asks the share. */
const readers: Record<
  "probe" | "driver" | "door",
  (rig: Pick<Rig, "share" | "fetch">, signal: AbortSignal) => Promise<unknown>
> = {
  probe: ({ share, fetch }, signal) =>
    readZeropsContainer(ORIGIN, { descriptor: share.read, fetch }, signal, {
      fresh: false,
      initAt: false,
    }),
  driver: ({ share }, signal) => share.descriptor(BASE, signal),
  door: ({ share }, signal) => share.descriptor(BASE, signal),
};

describe("descriptor share: one read of a Mate's descriptor serves one connect", () => {
  const signal = new AbortController().signal;

  const rows: ReadonlyArray<{
    readonly name: string;
    readonly run: (setup: Rig) => Promise<void>;
    readonly reads: number;
    /** `/healthz` reads: only a probe whose descriptor did not answer asks it. */
    readonly health?: number;
  }> = [
    {
      name: "the probe, the driver and the door asking at once",
      run: async (setup) => {
        const all = Promise.all([
          readers.probe(setup, signal),
          readers.driver(setup, signal),
          readers.door(setup, signal),
        ]);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await all;
      },
      reads: 1,
    },
    {
      name: "the probe, the driver and the door asking one after another within the window",
      run: async (setup) => {
        for (const reader of [readers.probe, readers.driver, readers.door]) {
          const read = reader(setup, signal);
          await flush();
          if (reader === readers.probe) await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
          await read;
          await setup.advance(DESCRIPTOR_SHARE_MS / 4);
        }
      },
      reads: 1,
    },
    {
      name: "a reader asking once the window has passed",
      run: async (setup) => {
        const first = readers.door(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await first;
        await setup.advance(DESCRIPTOR_SHARE_MS + 1);
        const second = readers.driver(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await second;
      },
      reads: 2,
    },
    {
      name: "a reader once the machine slept past the window, by the wall clock alone",
      run: async (setup) => {
        const first = readers.door(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await first;
        setup.sleep(60 * 60_000);
        expect(setup.share.recent(BASE)).toBeNull();
        const second = readers.driver(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await second;
      },
      reads: 2,
    },
    {
      name: "a read asked fresh after one the window still holds",
      run: async (setup) => {
        const first = readers.door(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await first;
        const fresh = setup.share.read(BASE, { fresh: true, signal });
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await fresh;
      },
      reads: 2,
    },
    {
      name: "a reader after a probe whose read went unanswered",
      run: async (setup) => {
        const first = readers.probe(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, blocked);
        await first;
        const second = readers.door(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await second;
      },
      reads: 2,
    },
    {
      name: "a reader after a fresh read went unanswered where an earlier one answered",
      run: async (setup) => {
        const first = readers.door(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await first;
        const fresh = setup.share.read(BASE, { fresh: true, signal });
        await flush();
        await setup.answer(DESCRIPTOR_URL, blocked);
        await fresh;
        const third = readers.driver(setup, signal);
        await flush();
        await setup.answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
        await third;
      },
      reads: 3,
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const setup = rig();
    await row.run(setup);
    expect(setup.requests.filter((url) => url === DESCRIPTOR_URL)).toHaveLength(row.reads);
    // A ready Mate read on demand costs no `/healthz`.
    expect(setup.requests.filter((url) => url === HEALTHZ_URL)).toHaveLength(row.health ?? 0);
  });

  it("hands every reader the same descriptor, decoded for the door and as facts for the probe", async () => {
    const setup = rig();
    const { share, answer } = setup;
    const probe = readers.probe(setup, signal);
    const door = share.descriptor(BASE, signal);
    await flush();
    await answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
    expect(await door).toMatchObject({
      environmentId: EnvironmentId.make("env-share"),
      serverVersion: "0.11.83",
      zerops: { projectId: "project-1" },
    });
    expect(((await probe) as { reading: unknown }).reading).toMatchObject({
      kind: "ready",
      descriptor: { environmentId: "env-share", serverVersion: "0.11.83", identity: "ok" },
      projectId: "project-1",
      initAt: null,
    });
  });

  it("names the descriptor read within the window, and none once it passed or a read failed", async () => {
    const { share, answer, advance } = rig();
    expect(share.recent(BASE)).toBeNull();
    const first = share.descriptor(BASE, signal);
    await flush();
    await answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
    await first;
    expect(share.recent(`${BASE}/`)?.environmentId).toBe("env-share");
    await advance(DESCRIPTOR_SHARE_MS + 1);
    expect(share.recent(BASE)).toBeNull();

    const second = share.descriptor(BASE, signal);
    await flush();
    await answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
    await second;
    const failed = share.read(BASE, { fresh: true, signal });
    await flush();
    await answer(DESCRIPTOR_URL, blocked);
    await failed;
    expect(share.recent(BASE)).toBeNull();
  });

  it("rejects a door read the Mate answers with something that is not a descriptor", async () => {
    const { share, answer } = rig();
    const door = share.descriptor(BASE, signal);
    await flush();
    await answer(DESCRIPTOR_URL, () => json({ hello: "world" }));
    await expect(door).rejects.toThrow();
    expect(share.recent(BASE)).toBeNull();
  });

  it("a reader that gives up leaves the read to the others", async () => {
    const { share, answer, requests } = rig();
    const leaving = new AbortController();
    const left = share.descriptor(BASE, leaving.signal);
    const staying = share.descriptor(BASE, signal);
    await flush();
    leaving.abort();
    await expect(left).rejects.toThrow();
    await answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
    expect((await staying).environmentId).toBe("env-share");
    expect(requests).toEqual([DESCRIPTOR_URL]);
  });

  it("a read nobody answers ends at its deadline, and the next reader reads again", async () => {
    const { share, requests, advance, answer } = rig();
    const hung = share.read(BASE, { fresh: false, signal });
    await advance(DESCRIPTOR_READ_DEADLINE_MS);
    expect((await hung).reading).toEqual({ kind: "blocked" });
    const next = share.read(BASE, { fresh: false, signal });
    await flush();
    await answer(DESCRIPTOR_URL, () => json(DESCRIPTOR));
    expect((await next).reading.kind).toBe("json");
    expect(requests).toEqual([DESCRIPTOR_URL, DESCRIPTOR_URL]);
  });
});
