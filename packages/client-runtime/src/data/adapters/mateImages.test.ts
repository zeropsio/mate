import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vite-plus/test";

import { classifyImageHttp, makeMateImages } from "./mateImages.ts";
import { demandedImageSize, mateImageScope, type MateImageKey } from "../families/mateImage.ts";
import { mateImage } from "../projections/mateImage.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { streamOf } from "../reducer.ts";

const key: MateImageKey = {
  environmentId: EnvironmentId.make("mate"),
  resource: { _tag: "attachment", attachmentId: "image", mimeType: "image/png" },
  rendition: { width: 80, height: 40 },
};
function settled(store: ReturnType<typeof makeAccountStore>) {
  return new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      const read = mateImage.derive(readsOfState(store.state()), key);
      if (read.kind === "ready" || read.kind === "failed") {
        unsubscribe();
        resolve();
      }
    });
  });
}
it("shares one demanded image read between mounted surfaces and keeps evidence after release", async () => {
  const store = makeAccountStore(AtomRegistry.make());
  let reads = 0;
  const blob = new Blob(["image"]);
  const images = makeMateImages({
    store,
    wire: {
      read: () =>
        Effect.sync(() => {
          reads++;
          return { blob };
        }),
      repair: () => Effect.void,
    },
  });
  const done = settled(store);
  const a = images.demand(key);
  const b = images.demand(key);
  await done;
  expect(reads).toBe(1);
  expect(mateImage.derive(readsOfState(store.state()), key)).toMatchObject({ kind: "ready", blob });
  a();
  b();
  expect(mateImage.derive(readsOfState(store.state()), key).kind).toBe("ready");
  images.stop();
});
it.each([
  {
    status: 404,
    code: "object-missing",
    outcome: "definitive-refusal",
    reason: "Stored media is missing.",
  },
  {
    status: 403,
    code: "access-denied",
    outcome: "authoritative-denial",
    reason: "You no longer have access to this Mate.",
  },
  { status: 507, code: "storage-full", outcome: "definitive-refusal", reason: "Storage full" },
])(
  "retains a $status refusal across remount without automatic retry",
  async ({ status, code, outcome, reason }) => {
    const store = makeAccountStore(AtomRegistry.make());
    let reads = 0;
    const fault = classifyImageHttp(status, code);
    expect(fault.outcome).toBe(outcome);
    const images = makeMateImages({
      store,
      wire: {
        read: () =>
          Effect.sync(() => {
            reads++;
          }).pipe(Effect.andThen(Effect.fail(fault))),
        repair: () => Effect.void,
      },
    });
    const done = settled(store);
    const release = images.demand(key);
    await done;
    release();
    const again = images.demand(key);
    expect(streamOf(store.state(), mateImageScope(key)).phase).toBe("refused");
    expect(mateImage.derive(readsOfState(store.state()), key)).toMatchObject({
      kind: "failed",
      reason,
    });
    expect(reads).toBe(1);
    again();
    images.stop();
  },
);
it.each([
  [{ width: 800, height: 400 }, { width: 200, height: 200 }, 2, { width: 400, height: 200 }],
  [{ width: 80, height: 40 }, { width: 200, height: 200 }, 2, { width: 80, height: 40 }],
] as const)(
  "chooses contained slot pixels at DPR without upscaling",
  (source, slot, dpr, expected) => {
    expect(demandedImageSize(source, slot, dpr)).toEqual(expected);
  },
);
it.each([
  [401, "session-required", "recoverable-session"],
  [503, "access-unverified", "access-unverified"],
  [502, undefined, "transient"],
] as const)("classifies HTTP %s for the common stream supervisor", (status, code, outcome) => {
  expect(classifyImageHttp(status, code).outcome).toBe(outcome);
});

it("withholds cached previews on unverified access and purges them on authoritative denial", async () => {
  const store = makeAccountStore(AtomRegistry.make());
  let receive: ((fault: ReturnType<typeof classifyImageHttp>) => void) | undefined;
  let watching!: () => void;
  const watched = new Promise<void>((resolve) => {
    watching = resolve;
  });
  const images = makeMateImages({
    store,
    wire: {
      read: () => Effect.succeed({ blob: new Blob(["picture"]) }),
      repair: () => Effect.void,
      watch: (_, callback) =>
        Effect.sync(() => {
          receive = callback;
          watching();
        }).pipe(Effect.andThen(Effect.never)),
    },
  });
  const done = settled(store);
  const release = images.demand(key);
  await Promise.all([done, watched]);
  receive?.(classifyImageHttp(503, "access-unverified"));
  expect(mateImage.derive(readsOfState(store.state()), key).kind).toBe("failed");
  receive?.(classifyImageHttp(403));
  expect(mateImage.derive(readsOfState(store.state()), key)).toMatchObject({
    kind: "failed",
    originalAvailable: false,
  });
  release();
  images.stop();
});

it("revalidates withheld bytes after the connection positively verifies access again", async () => {
  const store = makeAccountStore(AtomRegistry.make());
  let receive!: (fault: ReturnType<typeof classifyImageHttp> | null) => void;
  let watching!: () => void;
  const watched = new Promise<void>((resolve) => {
    watching = resolve;
  });
  let reads = 0;
  const images = makeMateImages({
    store,
    wire: {
      read: () =>
        Effect.sync(() => {
          reads++;
          return { blob: new Blob(["picture"]) };
        }),
      repair: () => Effect.void,
      watch: (_, callback) =>
        Effect.sync(() => {
          receive = callback;
          watching();
        }).pipe(Effect.andThen(Effect.never)),
    },
  });
  const first = settled(store);
  const release = images.demand(key);
  await Promise.all([first, watched]);
  receive(classifyImageHttp(503, "access-unverified"));
  expect(mateImage.derive(readsOfState(store.state()), key).kind).toBe("failed");
  const recovered = new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (mateImage.derive(readsOfState(store.state()), key).kind === "ready") {
        unsubscribe();
        resolve();
      }
    });
  });
  receive(null);
  await recovered;
  expect(reads).toBe(2);
  release();
  images.stop();
});
