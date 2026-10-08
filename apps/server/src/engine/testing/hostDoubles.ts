/**
 * What the engine's live layer needs from the server, as inert doubles: for a test that builds a
 * layer holding the engine with the switch on `v1` (the live branch is typed in, never built) or
 * on `mate` with nothing to drive.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { WorkspaceHistory } from "../../checkpointing/WorkspaceHistory.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderRuntimeEventBusTest } from "../../spi/ProviderRuntimeEventBus.ts";

export const engineHostDoubles = Layer.mergeAll(
  Layer.mock(ProviderService)({
    streamEvents: Stream.empty,
    listSessions: () => Effect.succeed([]),
  }),
  ProviderRuntimeEventBusTest.make(Stream.empty),
  Layer.mock(WorkspaceHistory)({}),
  Layer.orDie(NodeSqliteClient.layer({ filename: ":memory:" })),
);
