/**
 * Whether this Mate is automated, and the organization's keys its agents run on.
 *
 * An automated Mate (`MateState.automated`, decisions 1 and 8) takes tasks from outside and runs
 * only on the organization's API keys, never on a person's subscription. HQ says which it is in
 * its `state` frame and hands an automated Mate the keys in a `provider-keys` frame; the link
 * passes both here (`heard`, `keysHeard`). The keys go to the default OpenCode instance as
 * sensitive variables — the settings keep them in the secret store, and a client only ever reads
 * that one is set — and OpenCode is turned on. An ordinary Mate sets none of them.
 *
 * The keys' frame names the model the organization picked for its automated Mates, one of the
 * offered list (`automatedModels`); anything else, or none, is the default (`automatedModelOf`).
 * Each new task's run and the stand-up start on it (`modelSelection`); a run under way keeps the
 * model it started on.
 *
 * The flag is HQ's and never changes once the Mate is made, so HQ's last word on it, and on the
 * model, is kept in the server's state directory (`automated-mate.json`) and a restart starts from
 * it: an automated Mate never lets a person's subscription in while its link waits for HQ's first
 * state, nor runs a task on another model. A Mate HQ never said is automated starts as ordinary.
 *
 * @module ZeropsAutomation
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ModelSelection,
} from "@t3tools/contracts";
import {
  automatedModelOf,
  automatedModelOffer,
  automatedOpenCodeModel,
  defaultOpenCodeInstance,
  OPENCODE_KEY_PROVIDERS,
  openCodeInstancePatch,
  openCodeKeyIsSet,
  openCodeKeyValue,
  withOpenCodeKey,
  withoutOpenCodeKey,
} from "@t3tools/shared/openCodeKeyProviders";
import type { MateLinkDown, MateState } from "@t3tools/shared/mateLink";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";

/** What an automated Mate answers a sign-in, or a run on one: nobody's subscription runs it. */
export const AUTOMATED_MATE_SIGNS_NOBODY_IN =
  "An automated Mate runs on your organization's API key; nobody signs in to it.";

const OPENCODE = ProviderDriverKind.make("opencode");

/** The provider an automated Mate's agents run on with the organization's key: Nebius first. */
const AUTOMATED_PROVIDER = OPENCODE_KEY_PROVIDERS[0]!;

/**
 * What an automated Mate's agents run on until the organization picks a model — its stand-up and
 * every task: the default OpenCode instance, where the organization's key is set, on the
 * provider's default model for automated work.
 */
export const AUTOMATED_MODEL_SELECTION: ModelSelection = {
  instanceId: defaultInstanceIdForDriver(OPENCODE),
  model: automatedOpenCodeModel(AUTOMATED_PROVIDER),
};

/** The keys HQ hands an automated Mate, by the variable each provider reads. */
export type ProviderKeys = Extract<MateLinkDown, { readonly type: "provider-keys" }>["keys"];

export class ZeropsAutomation extends Context.Service<
  ZeropsAutomation,
  {
    /** Whether HQ last said this Mate is automated; not until it says. */
    readonly automated: Effect.Effect<boolean>;
    /** Whether the organization's key is set on OpenCode for the provider an automated Mate uses. */
    readonly keySet: Effect.Effect<boolean>;
    /** HQ's word on the Mate (its `state` frame). */
    readonly heard: (mate: MateState) => Effect.Effect<void>;
    /**
     * HQ's keys and the organization's model (its `provider-keys` frame): the keys set on an
     * automated Mate, ignored on another; the model kept for the runs that start next.
     */
    readonly keysHeard: (keys: ProviderKeys, model?: string) => Effect.Effect<void>;
    /**
     * What a new task's run and the stand-up start on: the organization's model where it picked
     * one of the offered list, else the default (`AUTOMATED_MODEL_SELECTION`).
     */
    readonly modelSelection: Effect.Effect<ModelSelection>;
  }
>()("t3/zerops/ZeropsAutomation") {}

/** HQ's last word on the flag and the model, as the state directory keeps it. */
const AutomatedFile = Schema.fromJsonString(
  Schema.Struct({ automated: Schema.Boolean, model: Schema.optionalKey(Schema.String) }),
);
const decodeAutomatedFile = Schema.decodeUnknownOption(AutomatedFile);
const encodeAutomatedFile = Schema.encodeSync(AutomatedFile);

export const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const flagPath = path.join(stateDir, "automated-mate.json");
  // Unreadable or absent: ordinary, on the default model, until HQ says otherwise.
  const kept = yield* fs.readFileString(flagPath).pipe(
    Effect.map((text) => Option.getOrUndefined(decodeAutomatedFile(text))),
    Effect.orElseSucceed(() => undefined),
  );
  const automated = yield* Ref.make(kept?.automated === true);
  // The organization's model, as an offered slug; none: the default.
  const picked = yield* Ref.make<string | undefined>(
    automatedModelOffer(kept?.model) === undefined ? undefined : kept?.model,
  );
  /** Keeps HQ's word for the next start; a write that fails is told, and HQ says it again. */
  const keep = Effect.gen(function* () {
    const model = yield* Ref.get(picked);
    yield* fs.writeFileString(
      flagPath,
      encodeAutomatedFile({
        automated: yield* Ref.get(automated),
        ...(model === undefined ? {} : { model }),
      }),
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("zerops automation: the Mate's flag could not be kept", {
        reason: error.message,
      }),
    ),
  );
  // The last keys HQ handed over: set once the Mate is known to be automated.
  const heldKeys = yield* Ref.make<ProviderKeys | undefined>(undefined);
  const writing = yield* Semaphore.make(1);

  /** The default OpenCode instance holding exactly `keys`; nothing written when it already does. */
  const apply = (keys: ProviderKeys) =>
    Effect.gen(function* () {
      const current = yield* settings.getSettings;
      const before = defaultOpenCodeInstance(current);
      let next = before;
      for (const provider of OPENCODE_KEY_PROVIDERS) {
        const value = keys.findLast((key) => key.env === provider.variable)?.value.trim() ?? "";
        if (value === "") {
          if (openCodeKeyIsSet(next, provider)) next = withoutOpenCodeKey(next, provider);
        } else if (openCodeKeyValue(next, provider) !== value || next.enabled !== true) {
          next = withOpenCodeKey(next, provider, value);
        }
      }
      if (next === before) return;
      yield* settings.updateSettings(openCodeInstancePatch(current, next));
    }).pipe(
      writing.withPermit,
      // Only the step that failed: the error's cause holds the settings it wrote, the key in them.
      Effect.catchTags({
        ServerSettingsError: (error) =>
          Effect.logWarning("zerops automation: the organization's key could not be set", {
            operation: error.operation,
          }),
      }),
    );

  /** The organization's model kept for the runs that start next: offered, else none (the default). */
  const modelHeard = (model: string | undefined) =>
    Effect.gen(function* () {
      const offered = automatedModelOffer(model) === undefined ? undefined : model?.trim();
      if (model !== undefined && offered === undefined)
        yield* Effect.logWarning(
          "zerops automation: the organization's model is not offered; the default runs",
          { model, runs: AUTOMATED_MODEL_SELECTION.model },
        );
      const was = yield* Ref.getAndSet(picked, offered);
      if (was !== offered) yield* keep;
    });

  const keysHeard: ZeropsAutomation["Service"]["keysHeard"] = (keys, model) =>
    modelHeard(model).pipe(
      Effect.andThen(Ref.set(heldKeys, keys)),
      Effect.andThen(Ref.get(automated)),
      Effect.flatMap((is) => (is ? apply(keys) : Effect.void)),
    );

  const heard: ZeropsAutomation["Service"]["heard"] = (mate) =>
    Effect.gen(function* () {
      const is = mate.automated === true;
      const was = yield* Ref.getAndSet(automated, is);
      if (is !== was) yield* keep;
      if (!is || was) return;
      const keys = yield* Ref.get(heldKeys);
      if (keys !== undefined) yield* apply(keys);
    });

  const keySet = settings.getSettings.pipe(
    Effect.map((current) => openCodeKeyIsSet(defaultOpenCodeInstance(current), AUTOMATED_PROVIDER)),
    Effect.orElseSucceed(() => false),
  );

  const modelSelection = Effect.map(Ref.get(picked), (model): ModelSelection => ({
    instanceId: AUTOMATED_MODEL_SELECTION.instanceId,
    model: automatedModelOf(model),
  }));

  return ZeropsAutomation.of({
    automated: Ref.get(automated),
    keySet,
    heard,
    keysHeard,
    modelSelection,
  });
});

export const layer = Layer.effect(ZeropsAutomation, make);
