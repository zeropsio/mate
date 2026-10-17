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
 * Until HQ's first state the Mate is taken as ordinary: the flag is HQ's, and a restart hears it
 * again on the next link.
 *
 * @module ZeropsAutomation
 */
import {
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
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { ServerSettingsService } from "../serverSettings.ts";

/** What an automated Mate answers a sign-in, or a run on one: nobody's subscription runs it. */
export const AUTOMATED_MATE_SIGNS_NOBODY_IN =
  "An automated Mate runs on your organization's API key; nobody signs in to it.";

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
    /** HQ's keys (its `provider-keys` frame): set on an automated Mate, ignored on another. */
    readonly keysHeard: (keys: ProviderKeys) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsAutomation") {}

export const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const automated = yield* Ref.make(false);
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

  const keysHeard: ZeropsAutomation["Service"]["keysHeard"] = (keys) =>
    Ref.set(heldKeys, keys).pipe(
      Effect.andThen(Ref.get(automated)),
      Effect.flatMap((is) => (is ? apply(keys) : Effect.void)),
    );

  const heard: ZeropsAutomation["Service"]["heard"] = (mate) =>
    Effect.gen(function* () {
      const is = mate.automated === true;
      const was = yield* Ref.getAndSet(automated, is);
      if (!is || was) return;
      const keys = yield* Ref.get(heldKeys);
      if (keys !== undefined) yield* apply(keys);
    });

  const keySet = settings.getSettings.pipe(
    Effect.map((current) => {
      const provider = OPENCODE_KEY_PROVIDERS[0];
      return provider !== undefined && openCodeKeyIsSet(defaultOpenCodeInstance(current), provider);
    }),
    Effect.orElseSucceed(() => false),
  );

  return ZeropsAutomation.of({ automated: Ref.get(automated), keySet, heard, keysHeard });
});

export const layer = Layer.effect(ZeropsAutomation, make);
