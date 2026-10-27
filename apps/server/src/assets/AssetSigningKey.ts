import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

/** One successful key load for this server; failed loads leave the next request able to try. */
export class AssetSigningKey extends Context.Service<
  AssetSigningKey,
  {
    readonly get: Effect.Effect<Uint8Array, ServerSecretStore.SecretStoreError>;
  }
>()("t3/assets/AssetSigningKey") {}

export const layer = Layer.effect(
  AssetSigningKey,
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const semaphore = yield* Semaphore.make(1);
    let key: Uint8Array | undefined;
    const get = Effect.suspend(() =>
      key !== undefined
        ? Effect.succeed(key)
        : semaphore.withPermit(
            Effect.gen(function* () {
              key ??= yield* secrets.getOrCreateRandom("asset-access-signing-key", 32);
              return key;
            }),
          ),
    );
    return AssetSigningKey.of({ get });
  }),
);
