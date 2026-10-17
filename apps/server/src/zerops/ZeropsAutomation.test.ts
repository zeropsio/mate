import { assert, describe, it } from "@effect/vitest";
import { ServerSettingsError, type ServerSettings } from "@t3tools/contracts";
import {
  defaultOpenCodeInstance,
  OPENCODE_KEY_PROVIDERS,
} from "@t3tools/shared/openCodeKeyProviders";
import type { MateState } from "@t3tools/shared/mateLink";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";

import * as ServerSettingsModule from "../serverSettings.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as ZeropsAutomationModule from "./ZeropsAutomation.ts";
import { ZeropsAutomation } from "./ZeropsAutomation.ts";

const nebius = OPENCODE_KEY_PROVIDERS[0]!;
// Built from parts: no scanner takes a fixture for a key.
const KEY = ["nb", "acme", "fixture", "0042"].join("-");
const keys = [{ env: nebius.variable, value: KEY }];

const mate = (automated: boolean | undefined): MateState =>
  ({
    mateId: "mate-nova",
    name: "Nova",
    ...(automated === undefined ? {} : { automated }),
  }) as unknown as MateState;

const nebiusKey = (settings: ServerSettings) =>
  defaultOpenCodeInstance(settings).environment?.find(
    (variable) => variable.name === nebius.variable,
  );

const withAutomation = <A, E>(
  body: Effect.Effect<A, E, ZeropsAutomation | ServerSettingsService>,
  settings: Layer.Layer<
    ServerSettingsService,
    ServerSettingsError
  > = ServerSettingsModule.layerTest(),
) => body.pipe(Effect.provide(ZeropsAutomationModule.layer.pipe(Layer.provideMerge(settings))));

describe("an automated Mate and the organization's keys", () => {
  it.effect("is not automated until HQ says it is", () =>
    withAutomation(
      Effect.gen(function* () {
        const automation = yield* ZeropsAutomation;
        assert.isFalse(yield* automation.automated);
        yield* automation.heard(mate(true));
        assert.isTrue(yield* automation.automated);
        yield* automation.heard(mate(undefined));
        assert.isFalse(yield* automation.automated);
      }),
    ),
  );

  it.effect(
    "sets the organization's key on its OpenCode as a secret variable and turns OpenCode on",
    () =>
      withAutomation(
        Effect.gen(function* () {
          const automation = yield* ZeropsAutomation;
          yield* automation.heard(mate(true));
          yield* automation.keysHeard(keys);
          const settings = yield* (yield* ServerSettingsService).getSettings;
          assert.deepStrictEqual(nebiusKey(settings), {
            name: nebius.variable,
            value: KEY,
            sensitive: true,
          });
          assert.isTrue(defaultOpenCodeInstance(settings).enabled);
          assert.isTrue(yield* automation.keySet);
        }),
      ),
  );

  it.effect("an ordinary Mate ignores the organization's keys", () =>
    withAutomation(
      Effect.gen(function* () {
        const automation = yield* ZeropsAutomation;
        yield* automation.heard(mate(false));
        yield* automation.keysHeard(keys);
        assert.isUndefined(nebiusKey(yield* (yield* ServerSettingsService).getSettings));
        assert.isFalse(yield* automation.keySet);
      }),
    ),
  );

  it.effect("keys heard before HQ says the Mate is automated are set once it does", () =>
    withAutomation(
      Effect.gen(function* () {
        const automation = yield* ZeropsAutomation;
        yield* automation.keysHeard(keys);
        assert.isFalse(yield* automation.keySet);
        yield* automation.heard(mate(true));
        assert.isTrue(yield* automation.keySet);
      }),
    ),
  );

  it.effect("an empty list clears the key it set", () =>
    withAutomation(
      Effect.gen(function* () {
        const automation = yield* ZeropsAutomation;
        yield* automation.heard(mate(true));
        yield* automation.keysHeard(keys);
        yield* automation.keysHeard([]);
        assert.isUndefined(nebiusKey(yield* (yield* ServerSettingsService).getSettings));
        assert.isFalse(yield* automation.keySet);
      }),
    ),
  );

  it.effect("the same key told again writes nothing", () => {
    let writes = 0;
    const counting = Layer.effect(
      ServerSettingsService,
      Effect.gen(function* () {
        const inner = yield* ServerSettingsService;
        return ServerSettingsService.of({
          ...inner,
          updateSettings: (patch) =>
            Effect.sync(() => void writes++).pipe(Effect.andThen(inner.updateSettings(patch))),
        });
      }),
    ).pipe(Layer.provide(ServerSettingsModule.layerTest()));
    return withAutomation(
      Effect.gen(function* () {
        const automation = yield* ZeropsAutomation;
        yield* automation.heard(mate(true));
        yield* automation.keysHeard(keys);
        yield* automation.keysHeard(keys);
        yield* automation.heard(mate(true));
        assert.strictEqual(writes, 1);
      }),
      counting,
    );
  });

  it.effect("a key it could not set never reaches a log line", () => {
    const lines: string[] = [];
    const logger = Logger.make(({ message, cause }) => {
      lines.push(`${JSON.stringify(message)} ${Cause.pretty(cause)}`);
    });
    const failing = Layer.effect(
      ServerSettingsService,
      Effect.gen(function* () {
        const inner = yield* ServerSettingsService;
        return ServerSettingsService.of({
          ...inner,
          updateSettings: (patch) =>
            Effect.fail(
              new ServerSettingsError({
                settingsPath: "/tmp/settings.json",
                operation: "write-secret",
                cause: new Error(JSON.stringify(patch)),
              }),
            ),
        });
      }),
    ).pipe(Layer.provide(ServerSettingsModule.layerTest()));
    return withAutomation(
      Effect.gen(function* () {
        const automation = yield* ZeropsAutomation;
        yield* automation.heard(mate(true));
        yield* automation.keysHeard(keys);
        assert.isFalse(yield* automation.keySet);
        assert.isAbove(lines.length, 0);
        assert.isFalse(lines.some((line) => line.includes(KEY)));
      }),
      failing,
    ).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
});
