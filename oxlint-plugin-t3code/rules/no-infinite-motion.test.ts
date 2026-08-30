import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE_NAME = "no-infinite-motion";
const LEDGER_DIRECTORY_ENV = "T3CODE_INFINITE_MOTION_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const mobileFile = createOxlintRuleHarness("t3code/no-infinite-motion", {
  filename: "apps/mobile/src/features/example/MotionSurface.tsx",
});
const webFile = createOxlintRuleHarness("t3code/no-infinite-motion", {
  filename: "apps/web/src/components/example/MotionSurface.tsx",
});
const serviceMapFile = createOxlintRuleHarness("t3code/no-infinite-motion", {
  filename: "apps/web/src/components/zerops/ZeropsServiceMap.tsx",
});
const nonProtectedZeropsFile = createOxlintRuleHarness("t3code/no-infinite-motion", {
  filename: "apps/web/src/components/zerops/ZeropsProjectPicker.tsx",
});
const testFile = createOxlintRuleHarness("t3code/no-infinite-motion", {
  filename: "apps/web/src/components/example/MotionSurface.test.tsx",
});
const lifecycleStripFile = createOxlintRuleHarness("t3code/no-infinite-motion", {
  filename: "apps/web/src/components/zerops/ZeropsLifecycleStrip.tsx",
});

const entry = (path: string, kind: string, fingerprint: string): ExceptionEntry => ({
  path,
  kind,
  fingerprint,
  owner: "karel",
  reason: "fixture exception",
  expires: "F5b",
});

const withFixtureLedger = <A, E, R>(
  entries: ReadonlyArray<ExceptionEntry>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "motion-ledger-" });
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

describe("t3code/no-infinite-motion", () => {
  mobileFile.valid(
    "allows a finite Reanimated repeat count",
    `
      import { withRepeat, withTiming } from "react-native-reanimated";

      export const animation = withRepeat(withTiming(1), 3);
    `,
  );

  mobileFile.valid(
    "does not guess whether a variable repeat count is infinite",
    `
      import { withRepeat } from "react-native-reanimated";

      export const repeat = (x: number, count: number) => withRepeat(x, count);
    `,
  );

  mobileFile.valid(
    "does not treat a shadowed Infinity binding as the global sentinel",
    `
      import { withRepeat } from "react-native-reanimated";

      const Infinity = 3;
      export const animation = withRepeat(1, Infinity);
    `,
  );

  mobileFile.valid(
    "ignores a local withRepeat function with the sentinel spelling",
    `
      const withRepeat = (value: number, count: number) => value + count;
      export const animation = withRepeat(1, -1);
    `,
  );

  webFile.valid(
    "allows one-shot arbitrary animation utilities",
    `export const surface = <div className="animate-[foo_1s_forwards]" />;`,
  );

  webFile.valid(
    "ignores comments that mention animation utilities",
    `
      // animate-spin is discussed here, but no class applies it.
      export const surface = <div />;
    `,
  );

  webFile.valid(
    "ignores an unrelated local function named cn",
    `
      const cn = (value: string) => value;
      export const label = cn("animate-spin");
    `,
  );

  mobileFile.valid(
    "ignores an unrelated local Animated object",
    `
      const Animated = { loop: (value: number) => value };
      export const animation = Animated.loop(1);
    `,
  );

  nonProtectedZeropsFile.valid(
    "allows Spinner outside the protected roots",
    `
      import { Spinner } from "~/components/ui/spinner";

      export const picker = <Spinner />;
    `,
  );

  testFile.valid(
    "skips test files",
    `
      import { withRepeat } from "react-native-reanimated";
      import { Spinner } from "~/components/ui/spinner";

      export const fixtures = [withRepeat(1, -1), <Spinner className="animate-spin" />];
    `,
  );

  mobileFile.invalid(
    "reports an infinite repeat from a direct Reanimated import",
    `
      import { withRepeat, withTiming } from "react-native-reanimated";

      export const animation = withRepeat(withTiming(1), -1);
    `,
  );

  mobileFile.invalid(
    "reports an infinite repeat from an aliased Reanimated import",
    `
      import { withRepeat as repeatForever } from "react-native-reanimated";

      export const animation = repeatForever(1, -1);
    `,
  );

  mobileFile.invalid(
    "reports an infinite repeat from a Reanimated namespace import",
    `
      import * as Reanimated from "react-native-reanimated";

      export const animation = Reanimated.withRepeat(1, -1);
    `,
  );

  mobileFile.invalid(
    "reports the global Infinity Reanimated repeat sentinel",
    `
      import { withRepeat } from "react-native-reanimated";

      export const animation = withRepeat(1, Infinity);
    `,
  );

  mobileFile.invalid(
    "reports Animated.loop from a React Native import",
    `
      import { Animated as Motion } from "react-native";

      export const animation = Motion.loop(Motion.timing(value, { toValue: 1 }));
    `,
  );

  serviceMapFile.invalid(
    "reports Spinner in a protected root",
    `
      import { Spinner } from "~/components/ui/spinner";

      export const map = <Spinner />;
    `,
  );

  serviceMapFile.invalid(
    "reports an aliased Spinner in a protected root",
    `
      import { Spinner as LoadingIndicator } from "~/components/ui/spinner";

      export const map = <LoadingIndicator />;
    `,
  );

  webFile.invalid(
    "reports animate-spin in a className literal",
    `export const indicator = <span className="animate-spin" />;`,
    (output) => {
      assert.match(output, /T3CODE_GUARD_FINDING:/u);
      assert.match(output, /"ruleName":"no-infinite-motion"/u);
      assert.match(output, /"kind":"Literal"/u);
      assert.include(output, String.raw`"fingerprint":"\"animate-spin\""`);
      assert.match(output, /"ledgered":false/u);
    },
  );

  webFile.invalid(
    "reports a variant-prefixed infinite animation utility",
    `export const indicator = <span className="motion-safe:animate-pulse" />;`,
  );

  webFile.invalid(
    "reports an arbitrary infinite animation utility",
    `export const indicator = <span className="motion-reduce:animate-[spin_1s_linear_INFINITE]" />;`,
  );

  webFile.invalid(
    "reports an animation utility in a conditional className expression",
    `export const indicator = <span className={busy ? "animate-spin" : ""} />;`,
  );

  webFile.invalid(
    "reports class literals through logical, binary, and array expressions",
    `export const indicator = <span className={[busy && ("size-3 " + "animate-bounce")]} />;`,
  );

  webFile.invalid(
    "reports an infinite animation template passed to a class builder",
    `
      import { cn } from "~/lib/utils";
      export const indicator = cn("x", \`animate-ping\`);
    `,
    (output) => {
      expect(output.match(/t3code\(no-infinite-motion\)/gu)).toHaveLength(1);
    },
  );

  webFile.invalid(
    "reports an infinite utility passed to a relatively imported class builder",
    `
      import { cn } from "../../lib/cn";
      export const variant = cn("animate-spin");
    `,
  );

  webFile.invalid(
    "reports a class-like property nested in a class builder argument",
    `
      import { cva } from "class-variance-authority";
      export const indicator = cva("x", { variants: { toneClassName: "animate-spin" } });
    `,
  );

  webFile.invalid(
    "reports a one-hop const used in a class-like position",
    `
      const spin = "animate-spin";
      export const indicator = <span className={spin} />;
    `,
  );

  webFile.invalid(
    "reports an infinite inline style iteration count",
    `export const indicator = <span style={{ animationIterationCount: "INFINITE" }} />;`,
    (output) => assert.match(output, /"kind":"Property"/u),
  );

  webFile.invalid(
    "reports an infinite inline animation shorthand",
    `export const indicator = <span style={{ animation: "spin 1s linear infinite" }} />;`,
  );

  mobileFile.invalid(
    "reports an infinite StyleSheet animation",
    `
      import { StyleSheet as Styles } from "react-native";
      export const styles = Styles.create({ indicator: { animationIterationCount: "infinite" } });
    `,
  );

  mobileFile.invalid(
    "reports an infinite animation through a React Native namespace",
    `
      import * as ReactNative from "react-native";
      const animation = ReactNative.Animated.loop(1);
      export const styles = ReactNative.StyleSheet.create({
        indicator: { animation: "spin 1s infinite" },
      });
    `,
    (output) => {
      expect(output.match(/t3code\(no-infinite-motion\)/gu)).toHaveLength(2);
    },
  );
});

it.layer(NodeServices.layer)("temporary infinite-motion ledger", (it) => {
  it.effect("suppresses an exact class finding from a fixture ledger", () =>
    withFixtureLedger(
      [entry("apps/web/src/components/example/MotionSurface.tsx", "Literal", '"animate-spin"')],
      webFile.run(`export const indicator = <span className="animate-spin" />;`),
    ),
  );

  it.effect("suppresses an exact protected Spinner finding from a fixture ledger", () =>
    withFixtureLedger(
      [
        entry(
          "apps/web/src/components/zerops/ZeropsLifecycleStrip.tsx",
          "JSXOpeningElement",
          '<Spinner className="size-3 shrink-0" />',
        ),
      ],
      lifecycleStripFile.run(`
        import { Spinner } from "~/components/ui/spinner";
        export const indicator = <Spinner className="size-3 shrink-0" />;
      `),
    ),
  );
});
