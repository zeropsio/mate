import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleBatch } from "../test/utils.ts";

const RULE_NAME = "no-frame-per-tick";
const LEDGER_DIRECTORY_ENV = "T3CODE_FRAME_PER_TICK_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const batch = createOxlintRuleBatch("t3code/no-frame-per-tick");

const webFile = batch.createHarness({
  filename: "apps/web/src/components/example/Surface.tsx",
});
const restingObserverFile = batch.createHarness({
  filename: "apps/web/src/lib/restingIntersections.ts",
});
const testFile = batch.createHarness({
  filename: "apps/web/src/components/example/Surface.test.tsx",
});
const serverFile = batch.createHarness({
  filename: "apps/server/src/example.ts",
});

const withFixtureLedger = <A, E, R>(
  entries: ReadonlyArray<ExceptionEntry>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "frame-per-tick-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, `${RULE_NAME}.json`),
        `${encodeUnknownJson(entries)}\n`,
      );

      const environment = globalThis.process.env;
      const previous = environment[LEDGER_DIRECTORY_ENV];
      environment[LEDGER_DIRECTORY_ENV] = directory;

      return yield* effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete environment[LEDGER_DIRECTORY_ENV];
            else environment[LEDGER_DIRECTORY_ENV] = previous;
          }),
        ),
      );
    }),
  );

describe("t3code/no-frame-per-tick", () => {
  webFile.valid(
    "allows an observer made through the resting helper",
    `
      import { watchIntersections } from "~/lib/restingIntersections";

      export const watch = (target: Element) =>
        watchIntersections(() => undefined, { rootMargin: "128px" })?.observe(target);
    `,
  );

  restingObserverFile.valid(
    "allows the plain observer inside the resting helper itself",
    `export const make = (callback: IntersectionObserverCallback) => new IntersectionObserver(callback);`,
  );

  testFile.valid(
    "ignores a test's own observer",
    `export const observer = new IntersectionObserver(() => undefined);`,
  );

  serverFile.valid(
    "ignores code outside the web client",
    `export const observer = new IntersectionObserver(() => undefined);`,
  );

  webFile.valid(
    "allows asking whether the browser has an observer",
    `export const supported = typeof IntersectionObserver === "function";`,
  );

  webFile.valid(
    "does not take a local class of the same name for the browser's",
    `
      class IntersectionObserver {}
      export const observer = new IntersectionObserver();
    `,
  );

  webFile.valid(
    "allows other observers",
    `
      export const sizes = new ResizeObserver(() => undefined);
      export const nodes = new MutationObserver(() => undefined);
    `,
  );

  webFile.valid(
    "allows a picture loaded eagerly",
    `export const picture = <img alt="" loading="eager" src="/a.png" />;`,
  );

  webFile.valid(
    "allows a loading prop that says something else",
    `export const button = <Button loading={busy} />;`,
  );

  webFile.valid(
    "allows content-visibility: hidden",
    `
      export const skipped = { contentVisibility: "hidden" } as const;
      export const row = <li className="[content-visibility:hidden]" />;
    `,
  );

  webFile.valid(
    "ignores comments that mention the three",
    `
      // new IntersectionObserver, loading="lazy" and content-visibility: auto are discussed here.
      export const surface = <div />;
    `,
  );

  webFile.invalid(
    "reports a plain IntersectionObserver",
    `export const observer = new IntersectionObserver(() => undefined, { rootMargin: "128px" });`,
    (output) => {
      assert.match(output, /watchIntersections/);
    },
  );

  webFile.invalid(
    "reports a plain observer reached through the window",
    `export const observer = new window.IntersectionObserver(() => undefined);`,
  );

  webFile.invalid(
    "reports a picture left to the browser's lazy loading",
    `export const picture = <img alt="" loading="lazy" src="/a.png" />;`,
    (output) => {
      assert.match(output, /useNearViewport/);
    },
  );

  webFile.invalid(
    "reports lazy loading passed to a component that draws the picture",
    `export const picture = <AssetImage alt="" loading={"lazy"} src="/a.png" />;`,
  );

  webFile.invalid(
    "reports lazy loading written to a picture",
    `export const defer = (picture: HTMLImageElement) => { picture.loading = "lazy"; };`,
  );

  webFile.invalid(
    "reports content-visibility: auto as a class",
    `export const row = <li className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_96px]" />;`,
    (output) => {
      assert.match(output, /content-visibility: auto/);
    },
  );

  webFile.invalid(
    "reports content-visibility: auto as a style",
    `export const row = <li style={{ contentVisibility: "auto" }} />;`,
  );

  webFile.invalid(
    "reports content-visibility: auto written to a style",
    `
      export const skip = (row: HTMLElement) => {
        row.style.contentVisibility = "auto";
        row.style.setProperty("content-visibility", "auto");
      };
    `,
    undefined,
    2,
  );
});

describe("temporary frame-per-tick ledger", () => {
  // witness: oxlint-plugin-t3code/rules/no-frame-per-tick.ts | if (ledgered && !shouldReportLedgered()) return; →
  it.effect("suppresses an exact finding from a fixture ledger", () =>
    withFixtureLedger(
      [
        {
          path: "apps/web/src/components/example/Surface.tsx",
          kind: "JSXAttribute",
          fingerprint: 'loading="lazy"',
          owner: "karel",
          reason: "fixture exception",
          expires: "never",
        },
      ],
      Effect.gen(function* () {
        const linted = yield* Effect.exit(
          webFile.run(`export const picture = <img alt="" loading="lazy" src="/a.png" />;`),
        );
        assert.equal(linted._tag, "Success");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
