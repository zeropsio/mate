import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Deploys } from "./deploys.ts";
import { HqOperationReader } from "./hqScopes.ts";

/** The scope hub checks the recipient's app access before reading durable operation facts. */
export const hqOperationReaderLayer = Layer.effect(
  HqOperationReader,
  Effect.map(Deploys, (deploys) => ({
    read: (_userId: string, appId: string) =>
      Effect.map(deploys.operations(appId), (records) =>
        records.map((value) => ({ key: `${appId}:${value.id}`, value })),
      ),
  })),
);
