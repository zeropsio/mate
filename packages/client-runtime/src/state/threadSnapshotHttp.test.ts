import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { MateDiagnosticEvent } from "../zerops/diagnostics.ts";
import { mateDiagnostics } from "../zerops/diagnostics.ts";
import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { fetchEnvironmentThreadSnapshot } from "./threadSnapshotHttp.ts";

const encodeSnapshot = Schema.encodeSync(Schema.fromJsonString(OrchestrationThreadDetailSnapshot));

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const prepared: PreparedConnection = {
  environmentId,
  label: "Test",
  httpBaseUrl: "https://mate.example.test",
  socketUrl: "wss://mate.example.test/ws",
  httpAuthorization: { _tag: "Dpop", accessToken: "test-access", expiresAtEpochMs: 1_000_000 },
  target: new PrimaryConnectionTarget({
    environmentId,
    label: "Test",
    httpBaseUrl: "https://mate.example.test",
    wsBaseUrl: "wss://mate.example.test",
  }),
};
const snapshot: OrchestrationThreadDetailSnapshot = {
  snapshotSequence: 10,
  thread: {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Read history",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    activities: [],
    checkpoints: [],
    proposedPlans: [],
    session: null,
  },
};

describe("thread snapshot measurements", () => {
  it.effect(
    "separates authentication preparation from transport without changing readable history",
    () =>
      Effect.gen(function* () {
        let now = 0;
        const entries: MateDiagnosticEvent[] = [];
        const time = vi.spyOn(performance, "now").mockImplementation(() => now);
        const enabled = vi.spyOn(mateDiagnostics, "enabled", "get").mockReturnValue(true);
        const record = vi
          .spyOn(mateDiagnostics, "record")
          .mockImplementation((entry) => entries.push(entry));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            time.mockRestore();
            enabled.mockRestore();
            record.mockRestore();
          }),
        );
        const response = new Response(encodeSnapshot(snapshot), {
          headers: { "server-timing": "snapshot;dur=150" },
        });
        const arrayBuffer = response.arrayBuffer.bind(response);
        let reads = 0;
        response.arrayBuffer = () => {
          reads++;
          now = 900;
          return arrayBuffer();
        };
        const fetchFn: typeof fetch = () => {
          now = 700;
          return Promise.resolve(response);
        };
        const actual = yield* fetchEnvironmentThreadSnapshot({
          prepared,
          threadId,
          signer: Option.some({
            thumbprint: Effect.succeed("test-thumbprint"),
            createProof: () =>
              Effect.sync(() => {
                now = 500;
                return "test-proof";
              }),
          }),
        }).pipe(Effect.provide(remoteHttpClientLayer(fetchFn)));
        expect(actual).toEqual(snapshot);
        expect(reads).toBe(1);
        const stages = entries.filter((entry) => entry.kind === "history-stage");
        expect(stages.map((entry) => [entry.stage, entry.durationMs])).toEqual([
          ["prepare", 500],
          ["request", undefined],
          ["headers", 200],
          ["body", 200],
          ["decode", 0],
        ]);
        expect(stages.find((entry) => entry.stage === "headers")?.serverTiming).toBe(
          "snapshot;dur=150",
        );
      }),
  );
});
