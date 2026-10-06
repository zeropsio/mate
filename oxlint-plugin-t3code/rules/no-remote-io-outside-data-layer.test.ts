import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";
import { HQ_CLIENT_VERBS, ZEROPS_CLIENT_VERBS } from "./no-remote-io-outside-data-layer.ts";

const RULE = "t3code/no-remote-io-outside-data-layer";
const LEDGER_DIRECTORY_ENV = "T3CODE_REMOTE_IO_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const webFile = createOxlintRuleHarness(RULE, { filename: "apps/web/src/zerops/useSomething.ts" });
const adapterFile = createOxlintRuleHarness(RULE, {
  filename: "packages/client-runtime/src/zerops/hq/client.ts",
});
const FETCH = `export const read = (url: string) => fetch(url);`;
const FETCH_ENTRY: ExceptionEntry = {
  path: "apps/web/src/zerops/useSomething.ts",
  kind: "CallExpression",
  fingerprint: "fetch",
  owner: "data-layer rewrite: projects",
  reason: "fixture exception",
  expires: "never",
};

const withFixtureLedger = <A, E, R>(
  entries: ReadonlyArray<ExceptionEntry>,
  effect: Effect.Effect<A, E, R>,
  reportLedgered = false,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "remote-io-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, "no-remote-io-outside-data-layer.json"),
        `${encodeUnknownJson(entries)}\n`,
      );
      const environment = process.env;
      const keys = [LEDGER_DIRECTORY_ENV, "T3CODE_GUARD_REPORT_LEDGERED"] as const;
      const previous = keys.map((key) => environment[key]);
      environment[LEDGER_DIRECTORY_ENV] = directory;
      if (reportLedgered) environment.T3CODE_GUARD_REPORT_LEDGERED = "1";
      return yield* effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            keys.forEach((key, index) => {
              const value = previous[index];
              if (value === undefined) delete environment[key];
              else environment[key] = value;
            });
          }),
        ),
      );
    }),
  );

/** The Zerops client's public methods that touch only its own memory, never the network. */
const ZEROPS_CLIENT_LOCAL_METHODS: ReadonlySet<string> = new Set([
  "admitWritesThrough",
  "restoreSession",
  "adoptRenewedSession",
  "forgetSession",
  "onIntegrationTokensWritten",
  "verifiedUser",
  "projectListRefused",
  "noteProjectListRefused",
  "signOutLocally",
]);

/** A class method's head, generic or not: `  async read(` or `  read<T>(`. */
const METHOD_HEAD = /^ {2}(?:async )?([a-z][A-Za-z]*)(?:<[^>]*>)?\(/gmu;

const sourceBlock = Effect.fnUntraced(function* (file: string, opening: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(path.join(import.meta.dirname, "../..", file));
  const start = text.indexOf(opening);
  assert.notEqual(start, -1, `${opening} is in ${file}`);
  return text.slice(start, text.indexOf("\n}\n", start));
});

it.layer(NodeServices.layer)("client verbs", (it) => {
  it("reads a generic method's name", () => {
    assert.deepStrictEqual(
      [..."  async readAll<T>(x: T) {\n  write<A, B>(a: A) {\n".matchAll(METHOD_HEAD)].map(
        (match) => match[1],
      ),
      ["readAll", "write"],
    );
  });

  it.effect("names every remote method of the Zerops client", () =>
    Effect.gen(function* () {
      const block = yield* sourceBlock(
        "packages/client-runtime/src/zerops/api.ts",
        "export class ZeropsApiClient {",
      );
      const methods = [...block.matchAll(METHOD_HEAD)].map((match) => match[1]!);
      assert.deepStrictEqual(
        [...new Set(methods)]
          .filter((name) => name !== "constructor" && !ZEROPS_CLIENT_LOCAL_METHODS.has(name))
          .toSorted(),
        [...ZEROPS_CLIENT_VERBS].toSorted(),
      );
    }),
  );

  it.effect("names every member of the HQ client", () =>
    Effect.gen(function* () {
      const block = yield* sourceBlock(
        "packages/client-runtime/src/zerops/hq/client.ts",
        "export interface HqApi {",
      );
      const members = [...block.matchAll(/^ {2}readonly ([a-zA-Z]+)/gmu)].map((match) => match[1]!);
      assert.deepStrictEqual(members.toSorted(), [...HQ_CLIENT_VERBS].toSorted());
    }),
  );
});

it.layer(NodeServices.layer)("no-remote-io-outside-data-layer ledger", (it) => {
  it.effect("an exact ledger entry suppresses the finding", () =>
    withFixtureLedger([FETCH_ENTRY], webFile.run(FETCH)),
  );

  it.effect("the reconciliation driver still sees a ledgered finding", () =>
    withFixtureLedger([FETCH_ENTRY], webFile.runAndExpectFailure(FETCH), true).pipe(
      Effect.tap((output) => Effect.sync(() => assert.match(output, /"ledgered":true/u))),
    ),
  );
});

describe("t3code/no-remote-io-outside-data-layer", () => {
  webFile.invalid("reports fetch in a web hook", `export const read = () => fetch("/api/x");`);
  webFile.invalid(
    "reports fetch reached through the global object",
    `export const read = (url: string) => globalThis.fetch(url);`,
  );
  webFile.invalid(
    "reports a socket, an event source and a raw request opened in the client",
    `export const open = (url: string) => [new WebSocket(url), new window.EventSource(url), new XMLHttpRequest()];`,
    undefined,
    3,
  );
  webFile.invalid(
    "reports a beacon sent from the client",
    `export const send = (url: string) => navigator.sendBeacon(url, "x");`,
  );
  webFile.invalid(
    "reports an HTTP client, a query library and a remote atom taken into the client",
    [
      `import { FetchHttpClient } from "effect/unstable/http";`,
      `import * as HttpClient from "effect/unstable/http/HttpClient";`,
      `import { useQuery } from "@tanstack/react-query";`,
      `import { AtomRpc } from "effect/unstable/reactivity";`,
      `export const parts = [FetchHttpClient, HttpClient, useQuery, AtomRpc];`,
    ].join("\n"),
    undefined,
    4,
  );
  webFile.invalid(
    "reports a remote-query atom built in the client",
    [
      `import { createEnvironmentRpcQueryAtomFamily, createEnvironmentSubscriptionAtomFamily } from "@t3tools/client-runtime/state/runtime";`,
      `export const a = createEnvironmentRpcQueryAtomFamily({ label: "x" });`,
      `export const b = createEnvironmentSubscriptionAtomFamily({ label: "y" });`,
    ].join("\n"),
    undefined,
    2,
  );
  webFile.invalid(
    "reports the Zerops and HQ clients built and called from a hook",
    [
      `export function useReads(client, hq, options) {`,
      `  const zerops = new ZeropsApiClient(options);`,
      `  const api = makeHqApi(options);`,
      `  void client.readProjectEnv("o", "p");`,
      `  void hq.api.release("a", "b");`,
      `  return [zerops, api];`,
      `}`,
    ].join("\n"),
    undefined,
    4,
  );
  webFile.invalid(
    "reports fetch handed on as a value",
    [
      `export const a = makeClient(globalThis.fetch);`,
      `export const b = makeClient({ fetch });`,
      `export const c = makeClient(fetch);`,
    ].join("\n"),
    undefined,
    3,
  );
  webFile.valid(
    "leaves a fetch the module was handed, and a property named fetch, alone",
    `export const read = (options: { fetch: typeof fetch }) => ({ fetch: options.fetch });`,
  );
  webFile.valid(
    "leaves fetch named in a type alone",
    [
      `export function f(g: typeof globalThis.fetch) { return g; }`,
      `export interface D { fetch: typeof globalThis.fetch; other: typeof fetch }`,
    ].join("\n"),
  );
  webFile.valid(
    "leaves a check that fetch exists alone",
    `export const can = typeof fetch === "function" && typeof globalThis.fetch === "function";`,
  );
  webFile.invalid(
    "reports Effect's socket module taken into the client",
    `import * as Socket from "effect/unstable/socket/Socket"; export const s = Socket;`,
  );
  webFile.invalid(
    "reports a remote command atom built in the client",
    [
      `export const a = createEnvironmentRpcCommand(runtime, { label: "x" });`,
      `export const b = createEnvironmentCommand(runtime, { label: "y" });`,
      `export const c = createEnvironmentRpcStreamCommand(runtime, { label: "z" });`,
    ].join("\n"),
    undefined,
    3,
  );
  webFile.valid(
    "allows verbs called on something that is not a client",
    [
      `export function useActions(runtime, access, image, flowValue) {`,
      `  void runtime.commands.restartService("s");`,
      `  void access.login("instance");`,
      `  image.release();`,
      `  void flowValue.redeploy("app");`,
      `}`,
    ].join("\n"),
  );
  adapterFile.valid(
    "allows an adapter to reach its remote",
    `export const read = (url: string) => fetch(url);`,
  );
  for (const filename of [
    "apps/web/src/zerops/useSomething.test.ts",
    "packages/client-runtime/src/remoteThing.bench.ts",
    "apps/web/src/zerops/__fixtures__/remoteFixture.ts",
    "packages/client-runtime/src/zerops/testing/remoteFixture.ts",
    "apps/desktop/src/updater.ts",
    "apps/server/src/zerops/link.ts",
  ]) {
    createOxlintRuleHarness(RULE, { filename }).valid(`does not guard ${filename}`, FETCH);
  }
  createOxlintRuleHarness(RULE, { filename: "apps/web/src/terminal/ghostty/runtime.ts" }).valid(
    "allows a module that fetches a bundled file, not source data",
    `export const read = (url: string) => window.fetch(url);`,
  );
  for (const filename of [
    "apps/mobile/src/features/zerops/screen.tsx",
    "packages/client-runtime/src/zerops/hq/journal.ts",
  ]) {
    createOxlintRuleHarness(RULE, { filename }).invalid(`guards ${filename}`, FETCH);
  }
  const PLATFORM_CALL = `export const restart = (platform: Platform, id: string) => platform.restartService(id);`;
  createOxlintRuleHarness(RULE, {
    filename: "packages/client-runtime/src/data/operations/executors/zerops.ts",
  }).valid("allows an operation executor to call a platform port", PLATFORM_CALL);
  createOxlintRuleHarness(RULE, {
    filename: "packages/client-runtime/src/data/adapters/services.ts",
  }).valid("allows a data-layer adapter to reach its remote", FETCH);
  for (const filename of [
    "packages/client-runtime/src/data/projections/services.ts",
    "packages/client-runtime/src/data/operations/receipts.ts",
    "packages/client-runtime/src/data/operations/restartService.ts",
    "packages/client-runtime/src/data/operations/coordinator.ts",
    "packages/client-runtime/src/data/store.ts",
    "packages/client-runtime/src/data/reducer.ts",
  ]) {
    createOxlintRuleHarness(RULE, { filename }).invalid(
      `guards the data layer's ${filename}`,
      PLATFORM_CALL,
    );
  }
  webFile.valid(
    "allows the HTTP client's types",
    `import type { HttpClient } from "effect/unstable/http"; export type C = HttpClient.HttpClient;`,
  );
});
