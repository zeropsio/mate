import { expect, it } from "vite-plus/test";

import type { FetchLike } from "./matePath.ts";
import {
  DESCRIPTOR_READ_DEADLINE_MS,
  DESCRIPTOR_SHARE_MS,
  makeDescriptorShare,
} from "./descriptorShare.ts";

const ORIGIN = "https://zcp-test-8080.prg1.zerops.app";
const BASE = `${ORIGIN}/mate`;

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

function rig(answerOf: FetchLike) {
  let mono = 0;
  const timers = new Map<() => void, number>();
  const share = makeDescriptorShare({
    clock: {
      now: () => ({ wall: 1_800_000_000_000 + mono, mono }),
      setTimer: (delayMs, fire) => {
        timers.set(fire, mono + delayMs);
        return () => {
          timers.delete(fire);
        };
      },
    },
    fetch: answerOf,
  });
  return {
    share,
    advance: (ms: number) => {
      mono += ms;
      for (const [fire, at] of timers) {
        if (at > mono) continue;
        timers.delete(fire);
        fire();
      }
    },
  };
}

const signal = new AbortController().signal;

// witness: packages/client-runtime/src/data/adapters/descriptorShare.ts | if (order > slot.settledOrder) → if (order > slot.settledOrder && reading.kind === "json")
it("AD46: A Mate's descriptor read is served to the readers after it only within its window, and no longer once the window passed or a read failed", async () => {
  let available = true;
  const { share, advance } = rig(async () => {
    if (!available) throw new TypeError("Failed to fetch");
    return json(DESCRIPTOR);
  });
  const first = await share.read(BASE, { fresh: false, signal });
  advance(1);
  expect((await share.read(`${BASE}/`, { fresh: false, signal })).sentAt).toEqual(first.sentAt);
  advance(DESCRIPTOR_SHARE_MS);
  const late = await share.read(BASE, { fresh: false, signal });
  expect(late.sentAt.mono).toBeGreaterThan(first.sentAt.mono);

  advance(1);
  available = false;
  const failed = await share.read(BASE, { fresh: true, signal });
  advance(1);
  const after = await share.read(BASE, { fresh: false, signal });
  expect(after.sentAt.mono).toBeGreaterThan(failed.sentAt.mono);
});

// witness: packages/client-runtime/src/data/adapters/descriptorShare.ts | Option.getOrNull(decodeDescriptor(reading.body)) → (reading.body as unknown as ExecutionEnvironmentDescriptor)
it("AD47: A door read the Mate answers with something that is not a descriptor is refused and never served to a reader after it", async () => {
  const { share, advance } = rig(async () => json({ hello: "world" }));
  const asked = share.descriptor(BASE, signal);
  const doorRead = await share.read(BASE, { fresh: false, signal });
  const [door] = await Promise.allSettled([asked]);
  expect(door).toMatchObject({ status: "rejected", reason: expect.any(Error) });
  advance(1);
  const after = await share.read(BASE, { fresh: false, signal });
  expect(after.sentAt.mono).toBeGreaterThan(doorRead.sentAt.mono);
});

// witness: packages/client-runtime/src/data/adapters/descriptorShare.ts | return until(start(key, slot), signal); → return start(key, slot);
it("AD48: A reader that gives up leaves the descriptor read to the others, who still get the descriptor", async () => {
  const answer = Promise.withResolvers<Response>();
  const { share } = rig((_url, init) => {
    init?.signal?.addEventListener("abort", () => answer.reject(new Error("aborted")), {
      once: true,
    });
    return answer.promise;
  });
  const leaving = new AbortController();
  const left = share.descriptor(BASE, leaving.signal);
  const staying = share.descriptor(BASE, signal);
  leaving.abort();
  answer.resolve(json(DESCRIPTOR));
  const [departed, remaining] = await Promise.allSettled([left, staying]);
  expect(departed).toMatchObject({ status: "rejected", reason: expect.any(Error) });
  expect(remaining).toMatchObject({ status: "fulfilled", value: { environmentId: "env-share" } });
});

// witness: packages/client-runtime/src/data/adapters/descriptorShare.ts | if (slot.inFlight === read) → if (slot.inFlight === read && reading.kind === "json")
it("AD49: A descriptor read nobody answers ends blocked at its deadline, and the next reader gets a fresh answer", async () => {
  let available = false;
  const { share, advance } = rig((_url, init) => {
    if (available) return Promise.resolve(json(DESCRIPTOR));
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  const hung = share.read(BASE, { fresh: false, signal });
  advance(DESCRIPTOR_READ_DEADLINE_MS);
  expect((await hung).reading).toEqual({ kind: "blocked" });

  available = true;
  const next = await share.read(BASE, { fresh: false, signal });
  expect(next.reading.kind).toBe("json");
});
