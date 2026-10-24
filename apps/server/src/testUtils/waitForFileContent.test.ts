import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { beforeEach, expect, vi } from "vite-plus/test";

const fileSystem = vi.hoisted(() => ({
  files: new Map<string, string>(),
  watchers: new Map<
    string,
    { notify: (event: string, filename: string) => void; close: () => void }
  >(),
}));

vi.mock("node:fs", () => ({
  watch: vi.fn((path: string, notify: (event: string, filename: string) => void) => {
    if (path !== "/fixture" && !fileSystem.files.has(path)) {
      throw Object.assign(new Error("Missing file"), { code: "ENOENT" });
    }
    const watcher = { notify, close: vi.fn(), on: vi.fn() };
    fileSystem.watchers.set(path, watcher);
    return watcher;
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (path: string) => {
    const content = fileSystem.files.get(path);
    if (content === undefined) throw Object.assign(new Error("Missing file"), { code: "ENOENT" });
    return content;
  }),
}));

import { waitForFileContent } from "./waitForFileContent.ts";

beforeEach(() => {
  fileSystem.files.clear();
  fileSystem.watchers.clear();
});

it.effect("an existing file's append completes its waiter without a directory notification", () =>
  Effect.gen(function* () {
    fileSystem.files.set("/fixture/requests", "initialize\n");
    const waiting = yield* waitForFileContent("/fixture/requests", (content) =>
      content.includes("session/prompt"),
    ).pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => Promise.resolve());

    fileSystem.files.set("/fixture/requests", "initialize\nsession/prompt\n");
    fileSystem.watchers.get("/fixture/requests")?.notify("change", "requests");
    yield* Effect.promise(() => Promise.resolve());
    yield* TestClock.adjust(0);

    expect(waiting.pollUnsafe()).toMatchObject({
      _tag: "Success",
      value: "initialize\nsession/prompt\n",
    });
  }),
);

it.effect(
  "a newly created file remains observed for appends after its directory notification",
  () =>
    Effect.gen(function* () {
      const waiting = yield* waitForFileContent("/fixture/requests", (content) =>
        content.includes("session/prompt"),
      ).pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.promise(() => Promise.resolve());

      fileSystem.files.set("/fixture/requests", "initialize\n");
      fileSystem.watchers.get("/fixture")?.notify("rename", "requests");
      yield* Effect.promise(() => Promise.resolve());

      fileSystem.files.set("/fixture/requests", "initialize\nsession/prompt\n");
      fileSystem.watchers.get("/fixture/requests")?.notify("change", "requests");
      yield* Effect.promise(() => Promise.resolve());
      yield* TestClock.adjust(0);

      expect(waiting.pollUnsafe()).toMatchObject({
        _tag: "Success",
        value: "initialize\nsession/prompt\n",
      });
    }),
);

it.effect("a replaced file's subsequent append completes the existing waiter", () =>
  Effect.gen(function* () {
    fileSystem.files.set("/fixture/requests", "first file\n");
    const waiting = yield* waitForFileContent("/fixture/requests", (content) =>
      content.includes("session/prompt"),
    ).pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => Promise.resolve());

    fileSystem.files.set("/fixture/requests", "replacement\n");
    fileSystem.watchers.get("/fixture")?.notify("rename", "requests");
    yield* Effect.promise(() => Promise.resolve());

    fileSystem.files.set("/fixture/requests", "replacement\nsession/prompt\n");
    fileSystem.watchers.get("/fixture/requests")?.notify("change", "requests");
    yield* Effect.promise(() => Promise.resolve());
    yield* TestClock.adjust(0);

    expect(waiting.pollUnsafe()).toMatchObject({
      _tag: "Success",
      value: "replacement\nsession/prompt\n",
    });
  }),
);
