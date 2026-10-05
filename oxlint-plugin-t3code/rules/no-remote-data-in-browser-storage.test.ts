import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE = "t3code/no-remote-data-in-browser-storage";
const LEDGER_DIRECTORY_ENV = "T3CODE_BROWSER_STORAGE_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const webFile = createOxlintRuleHarness(RULE, { filename: "apps/web/src/zerops/fixtureMemory.ts" });
const mobileFile = createOxlintRuleHarness(RULE, {
  filename: "apps/mobile/src/features/zerops/fixtureMemory.ts",
});
const KEEP = `export const keep = (text: string) => localStorage.setItem("mate:fixture", text);`;
const KEEP_ENTRY: ExceptionEntry = {
  path: "apps/web/src/zerops/fixtureMemory.ts",
  kind: "CallExpression",
  fingerprint: `localStorage.setItem("mate:fixture")`,
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
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "browser-storage-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, "no-remote-data-in-browser-storage.json"),
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

it.layer(NodeServices.layer)("no-remote-data-in-browser-storage ledger", (it) => {
  it.effect("an exact ledger entry suppresses the finding", () =>
    withFixtureLedger([KEEP_ENTRY], webFile.run(KEEP)),
  );

  it.effect("the reconciliation driver still sees a ledgered finding", () =>
    withFixtureLedger([KEEP_ENTRY], webFile.runAndExpectFailure(KEEP), true).pipe(
      Effect.tap((output) => Effect.sync(() => assert.match(output, /"ledgered":true/u))),
    ),
  );
});

describe("t3code/no-remote-data-in-browser-storage", () => {
  webFile.invalid("reports local storage written outside the allowlist", KEEP);
  webFile.invalid(
    "reports session storage and IndexedDB reached through the window",
    [
      `export const read = () => window.sessionStorage.getItem("k");`,
      `export const open = () => globalThis.indexedDB.open("db");`,
    ].join("\n"),
    undefined,
    2,
  );
  webFile.invalid(
    "reports a storage-event listener",
    `export const listen = (onChange: () => void) => window.addEventListener("storage", onChange);`,
  );
  webFile.invalid(
    "reports the app's storage helpers used outside the allowlist",
    [
      `import { accountLocalStorage } from "./accountLifetime";`,
      `import { useLocalStorage, setLocalStorageItem } from "~/hooks/useLocalStorage";`,
      `export const read = () => accountLocalStorage.getItem("mate:zerops:fixture");`,
      `export const keep = (value: string) => setLocalStorageItem("mate:zerops:fixture", value, Codec);`,
      `export const useFixture = () => useLocalStorage("mate:zerops:fixture", null, Codec);`,
    ].join("\n"),
    (output) => assert.match(output, /accountLocalStorage\.getItem\(\\"mate:zerops:fixture\\"\)/u),
    3,
  );
  mobileFile.invalid(
    "reports a mobile key-value store taken into the app",
    [
      `import * as SecureStore from "expo-secure-store";`,
      `import AsyncStorage from "@react-native-async-storage/async-storage";`,
      `export const stores = [SecureStore, AsyncStorage];`,
    ].join("\n"),
    undefined,
    2,
  );
  for (const filename of [
    "apps/web/src/zerops/mutedMates.ts",
    "apps/web/src/composerDraftStore.ts",
    "apps/web/src/zerops/handover.ts",
    "apps/web/src/zerops/bootFrame.ts",
    "apps/mobile/src/features/zerops/storage.ts",
  ]) {
    createOxlintRuleHarness(RULE, { filename }).valid(
      `allows a preference, a draft or sign-in kept by ${filename}`,
      `import * as SecureStore from "expo-secure-store"; export const read = () => [SecureStore, window.localStorage.getItem("k")];`,
    );
  }
  for (const filename of [
    "apps/web/src/zerops/fixtureMemory.test.ts",
    "apps/web/src/zerops/__fixtures__/tabs.ts",
    "packages/client-runtime/src/zerops/testing/tabs.ts",
    "apps/server/src/zerops/state.ts",
  ]) {
    createOxlintRuleHarness(RULE, { filename }).valid(
      `does not guard ${filename}`,
      `export const read = () => localStorage.getItem("k");`,
    );
  }
  webFile.invalid(
    "reports a zustand store persisted outside the allowlist",
    `import { persist } from "zustand/middleware";\nexport const store = create(persist(() => ({}), { name: "mate:fixture" }));`,
  );
  webFile.valid(
    "leaves zustand's other middleware alone",
    `import { subscribeWithSelector } from "zustand/middleware";\nexport const m = subscribeWithSelector;`,
  );
  webFile.valid(
    "leaves a storage the module was handed alone",
    `export const read = (localStorage: Storage) => localStorage.getItem("k");`,
  );
});
