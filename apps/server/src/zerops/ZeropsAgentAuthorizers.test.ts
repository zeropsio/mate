import { it as effectIt } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  parseAuthorizers,
  readAuthorizers,
  recordAuthorizer,
  serializeAuthorizers,
} from "./ZeropsAgentAuthorizers.ts";

const AT_MILLIS = 1_788_600_000_000;
const AT = Option.getOrThrow(DateTime.make(AT_MILLIS));

/** The two methods this module uses, over an in-memory file. */
function fakeFileSystem(initial?: string) {
  let content = initial;
  return {
    fs: {
      readFileString: (_path: string) =>
        content === undefined ? Effect.fail(new Error("ENOENT") as never) : Effect.succeed(content),
      writeFileString: (_path: string, next: string) =>
        Effect.sync(() => {
          content = next;
        }),
    } as never,
    read: () => content,
  };
}

describe("parseAuthorizers", () => {
  it("reads a well-formed document", () => {
    const parsed = parseAuthorizers(
      JSON.stringify({ "claude-code": { subject: "user-a", atMillis: AT_MILLIS } }),
    );
    expect(parsed["claude-code"]?.subject).toBe("user-a");
    expect(DateTime.toEpochMillis(parsed["claude-code"]!.at)).toBe(AT_MILLIS);
  });

  it.each([
    { name: "empty text", text: "" },
    { name: "not JSON", text: "{oh no" },
    { name: "a JSON scalar", text: '"nope"' },
    { name: "a JSON array", text: "[1,2,3]" },
    { name: "null", text: "null" },
  ])("answers {} for $name rather than throwing", ({ text }) => {
    expect(parseAuthorizers(text)).toEqual({});
  });

  it.each([
    { name: "a missing subject", entry: { atMillis: AT_MILLIS } },
    { name: "a blank subject", entry: { subject: "", atMillis: AT_MILLIS } },
    { name: "a missing timestamp", entry: { subject: "user-a" } },
    { name: "a non-numeric timestamp", entry: { subject: "user-a", atMillis: "yesterday" } },
    { name: "an infinite timestamp", entry: { subject: "user-a", atMillis: Infinity } },
  ])("drops an entry with $name and keeps the rest", ({ entry }) => {
    const parsed = parseAuthorizers(
      JSON.stringify({ codex: entry, "claude-code": { subject: "ok", atMillis: AT_MILLIS } }),
    );
    expect(parsed.codex).toBeUndefined();
    expect(parsed["claude-code"]?.subject).toBe("ok");
  });
});

describe("serializeAuthorizers", () => {
  it("round-trips through parse", () => {
    const authorizers = { "claude-code": { subject: "user-a", at: AT } } as const;
    expect(parseAuthorizers(serializeAuthorizers(authorizers))).toEqual(authorizers);
  });

  it("writes epoch millis, so the file needs no date parsing to be valid", () => {
    const text = serializeAuthorizers({ codex: { subject: "user-b", at: AT } });
    expect(JSON.parse(text)).toEqual({ codex: { subject: "user-b", atMillis: AT_MILLIS } });
  });
});

describe("readAuthorizers", () => {
  effectIt.effect(
    "answers {} when the file does not exist — the normal state of a fresh container",
    () =>
      Effect.gen(function* () {
        const { fs } = fakeFileSystem(undefined);
        expect(yield* readAuthorizers(fs, "/state/authorizers.json")).toEqual({});
      }),
  );

  effectIt.effect("reads what was written", () =>
    Effect.gen(function* () {
      const { fs } = fakeFileSystem(
        serializeAuthorizers({ "claude-code": { subject: "user-a", at: AT } }),
      );
      const authorizers = yield* readAuthorizers(fs, "/state/authorizers.json");
      expect(authorizers["claude-code"]?.subject).toBe("user-a");
    }),
  );
});

describe("recordAuthorizer", () => {
  effectIt.effect("records an agent's authorizer", () =>
    Effect.gen(function* () {
      const { fs, read } = fakeFileSystem(undefined);
      yield* recordAuthorizer(fs, "/state/a.json", "claude-code", "user-a");

      const stored = parseAuthorizers(read() ?? "");
      expect(stored["claude-code"]?.subject).toBe("user-a");
    }),
  );

  effectIt.effect("preserves the other agent's record", () =>
    Effect.gen(function* () {
      const { fs, read } = fakeFileSystem(
        serializeAuthorizers({ codex: { subject: "user-b", at: AT } }),
      );
      yield* recordAuthorizer(fs, "/state/a.json", "claude-code", "user-a");

      const stored = parseAuthorizers(read() ?? "");
      expect(stored.codex?.subject).toBe("user-b");
      expect(stored["claude-code"]?.subject).toBe("user-a");
    }),
  );

  effectIt.effect("overwrites the same agent — last writer wins", () =>
    Effect.gen(function* () {
      const { fs, read } = fakeFileSystem(
        serializeAuthorizers({ "claude-code": { subject: "user-a", at: AT } }),
      );
      yield* recordAuthorizer(fs, "/state/a.json", "claude-code", "user-b");

      expect(parseAuthorizers(read() ?? "")["claude-code"]?.subject).toBe("user-b");
    }),
  );

  effectIt.effect("writes nothing for a blank subject rather than an empty record", () =>
    Effect.gen(function* () {
      const { fs, read } = fakeFileSystem(undefined);
      yield* recordAuthorizer(fs, "/state/a.json", "claude-code", "");
      expect(read()).toBeUndefined();
    }),
  );

  effectIt.effect("never fails the login when the write fails", () =>
    Effect.gen(function* () {
      const fs = {
        readFileString: () => Effect.succeed("{}"),
        writeFileString: () => Effect.fail(new Error("EROFS") as never),
      } as never;

      // The user is signed in either way; losing provenance must not surface as
      // a failed login.
      const exit = yield* Effect.exit(recordAuthorizer(fs, "/state/a.json", "codex", "user-a"));
      expect(exit._tag).toBe("Success");
    }),
  );
});
