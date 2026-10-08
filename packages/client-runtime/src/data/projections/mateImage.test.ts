import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vite-plus/test";

import {
  mateImageId,
  mateImageScope,
  mateImageReferenceId,
  type MateImageKey,
} from "../families/mateImage.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { mateImage, mateImagePreview } from "./mateImage.ts";

const key: MateImageKey = {
  environmentId: EnvironmentId.make("mate"),
  resource: { _tag: "attachment", attachmentId: "image" },
  rendition: { width: 80, height: 40 },
};
it("a failed preview still offers the retained original, including when preview storage is full", () => {
  const store = makeAccountStore(AtomRegistry.make());
  const scope = mateImageScope(key);
  for (const event of [{ kind: "attempt" }, { kind: "handshake" }] as const)
    store.dispatch({ kind: "stream", key: scope, event, now: 0 });
  const generation = streamOf(store.state(), scope).generation;
  store.dispatch({ kind: "baseline-begin", scope, generation });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation,
    via: "mate-direct",
    members: [mateImageId(key)],
    rows: [
      {
        family: "mateImage",
        id: mateImageId(key),
        revision: { kind: "mate-link", sequence: 1 },
        value: {
          blob: null,
          failure: "Storage full",
          occurrence: {
            id: "occurrence",
            threadId: ThreadId.make("thread"),
            ownerId: "message",
            name: "shot.png",
            provenance: "capture",
            original: {
              status: "ready",
              digest: "a".repeat(64),
              mimeType: "image/png",
              sizeBytes: 32,
              width: 80,
              height: 40,
            },
          },
        },
      },
    ],
  });
  expect(mateImage.derive(readsOfState(store.state()), key)).toEqual({
    kind: "failed",
    reason: "Storage full",
    originalAvailable: true,
  });
});

it.each([
  { case: "transport outage", change: "outage", expected: "ready" },
  { case: "partial coverage", change: "partial", expected: "ready" },
  { case: "unverified access", change: "unverified", expected: "failed" },
  { case: "authoritative refusal", change: "denied", expected: "failed" },
])("projects retained bytes through $case without inventing deletion", ({ change, expected }) => {
  const store = makeAccountStore(AtomRegistry.make());
  const scope = mateImageScope(key);
  const blob = new Blob(["picture"]);
  store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 0,
    via: "mate-direct",
    members: [mateImageId(key)],
    rows: [
      {
        family: "mateImage",
        id: mateImageId(key),
        revision: { kind: "mate-link", sequence: 0 },
        value: { blob },
      },
    ],
  });
  if (change === "denied")
    store.dispatch({ kind: "access", family: "mateImage", id: mateImageId(key), access: "denied" });
  else if (change === "partial") store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
  else
    store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: {
          outcome: change === "outage" ? "transient" : "access-unverified",
          message: change,
        },
      },
    });
  const read = mateImage.derive(readsOfState(store.state()), key);
  expect(read.kind).toBe(expected);
  expect(readsOfState(store.state()).fact("mateImage", mateImageId(key)).kind).not.toBe("deleted");
});

it("a deployment screenshot exposes its original dimensions with its retained preview", () => {
  const store = makeAccountStore(AtomRegistry.make());
  const reference = {
    environmentId: EnvironmentId.make("mate"),
    resource: {
      _tag: "workspace-file" as const,
      threadId: ThreadId.make("thread"),
      path: "mate-asset:shot",
    },
  };
  const key: MateImageKey = { ...reference, rendition: { width: 200, height: 120 } };
  const scope = mateImageScope(key);
  const blob = new Blob(["preview"]);
  store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 0,
    via: "mate-direct",
    members: [mateImageId(key)],
    rows: [
      {
        family: "mateImage",
        id: mateImageId(key),
        revision: { kind: "mate-link", sequence: 0 },
        value: {
          blob,
          reference: mateImageReferenceId(reference),
          dimensions: { width: 1600, height: 900 },
        },
      },
    ],
  });
  expect(mateImagePreview.derive(readsOfState(store.state()), reference)).toEqual({
    kind: "ready",
    blob,
    dimensions: { width: 1600, height: 900 },
  });
});
