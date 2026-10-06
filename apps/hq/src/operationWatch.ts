/** Scoped observation of accepted operations. No platform inventory survives a registration. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { type ZeropsError, ZeropsUnavailable } from "./zerops/api.ts";

export const ProcessEvidence = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  appVersion: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
  _version: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        code: Schema.optionalKey(Schema.NullOr(Schema.String)),
        message: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});
export type ProcessEvidence = typeof ProcessEvidence.Type;
const VersionEvidence = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  _version: Schema.optionalKey(Schema.Number),
});
export type VersionEvidence = typeof VersionEvidence.Type;
export type OperationError = ZeropsError & { readonly retryAfterMs?: number };

/** Recovery scheduling affects transport health only; never an operation outcome. */
export const operationBackoff = (attempt: number, retryAfterMs = 0) =>
  Effect.flatMap(Random.next, (jitter) =>
    Effect.sleep(
      Math.max(retryAfterMs, Math.min(30_000, 250 * 2 ** Math.min(attempt, 7)) * (0.5 + jitter)),
    ),
  );

export interface OperationTarget {
  readonly projectId: string;
  readonly processIds: ReadonlyArray<string>;
  readonly versionId: string | null;
}
export interface OperationSignal {
  readonly phase: "baselining" | "live" | "recovering";
  readonly processes: ReadonlyArray<ProcessEvidence>;
  readonly version: VersionEvidence | null;
}
/** Injectable transport at the operation boundary, also used by Core integration fixtures. */
export class OperationObserver extends Context.Service<OperationObserver, OperationWatch>()(
  "@t3tools/hq/operationWatch/OperationObserver",
) {}

export interface OperationWatch {
  readonly watch: (target: OperationTarget) => Stream.Stream<OperationSignal, OperationError>;
}
export interface Registration {
  readonly search: ReadonlyArray<{
    readonly name: string;
    readonly operator: string;
    readonly value: string | ReadonlyArray<string>;
  }>;
  readonly sort: ReadonlyArray<never>;
  readonly wsOutputType: "listStream" | "updateStream";
  readonly receiverId: string;
  readonly subscriptionName: string;
  readonly limit?: number;
  readonly disableOutput?: boolean;
}
export interface OperationWire {
  readonly makeId: () => string;
  readonly open: Effect.Effect<
    {
      readonly receiverId: string;
      readonly frames: Stream.Stream<string, OperationError>;
      readonly post: (path: string, body: Registration) => Effect.Effect<unknown, OperationError>;
      readonly get: (path: string) => Effect.Effect<unknown, OperationError>;
    },
    OperationError,
    Scope.Scope
  >;
}
const Frame = Schema.fromJsonString(
  Schema.Struct({
    subscriptionName: Schema.optionalKey(Schema.String),
    data: Schema.optionalKey(
      Schema.Struct({ update: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
    ),
  }),
);
const decodeFrame = Schema.decodeUnknownOption(Frame);
const decodeProcess = Schema.decodeUnknownOption(ProcessEvidence);
const decodeVersion = Schema.decodeUnknownOption(VersionEvidence);
const ProcessRead = ProcessEvidence.mapFields((fields) => {
  const { id: _id, ...rest } = fields;
  return rest;
});
const ProcessPage = Schema.Struct({
  items: Schema.Array(ProcessEvidence),
  totalHits: Schema.optionalKey(Schema.Number),
});
const VersionPage = Schema.Struct({
  items: Schema.Array(VersionEvidence),
  totalHits: Schema.optionalKey(Schema.Number),
});
const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown): Effect.Effect<A, ZeropsError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      () =>
        new ZeropsUnavailable({
          operation: "registration",
          message: "Malformed operation observation",
        }),
    ),
  );

export function makeOperationWatch(wire: OperationWire): OperationWatch {
  return {
    watch: (target) =>
      Stream.unwrap(
        Effect.sync(() => {
          // Keep only this operation's handles; revisions prevent a buffered push regressing a baseline.
          const processes = new Map<string, ProcessEvidence>();
          let version: VersionEvidence | null = null;
          let attempt = 0;
          const keepProcess = (row: ProcessEvidence) => {
            if (
              !target.processIds.includes(row.id) &&
              !(
                target.processIds.length === 0 &&
                target.versionId !== null &&
                row.appVersion?.id === target.versionId
              )
            )
              return;
            const prior = processes.get(row.id);
            if (
              prior !== undefined &&
              prior._version !== undefined &&
              (row._version ?? -1) < prior._version
            )
              return;
            processes.set(row.id, row);
          };
          const keepVersion = (row: VersionEvidence) => {
            if (row.id !== target.versionId) return;
            if (
              version !== null &&
              version._version !== undefined &&
              (row._version ?? -1) < version._version
            )
              return;
            version = row;
          };
          const signal = (phase: OperationSignal["phase"]): OperationSignal => ({
            phase,
            processes: [...processes.values()],
            version,
          });
          const cycle = (): Stream.Stream<OperationSignal, OperationError> =>
            Stream.scoped(
              Stream.unwrap(
                Effect.gen(function* () {
                  const link = yield* wire.open;
                  // Zerops requires clientId even for searches scoped to one project.
                  const project = yield* link
                    .get(`/project/${target.projectId}`)
                    .pipe(
                      Effect.flatMap((body) =>
                        decode(Schema.Struct({ clientId: Schema.String }), body),
                      ),
                    );
                  const subscriptions = new Map<string, "process" | "app-version">();
                  const register = (
                    entity: "process" | "app-version",
                    output: "listStream" | "updateStream",
                  ) => {
                    const name = wire.makeId();
                    subscriptions.set(name, entity);
                    const search: Registration["search"] = [
                      { name: "clientId", operator: "eq", value: project.clientId },
                      { name: "projectId", operator: "eq", value: target.projectId },
                      ...(entity === "process" && output === "listStream"
                        ? [
                            {
                              name: "status",
                              operator: "in",
                              value: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"],
                            },
                          ]
                        : []),
                      ...(entity === "app-version"
                        ? [{ name: "id", operator: "in", value: [target.versionId ?? ""] }]
                        : []),
                    ];
                    return link.post(`/${entity}/search`, {
                      search,
                      sort: [],
                      wsOutputType: output,
                      receiverId: link.receiverId,
                      subscriptionName: name,
                      ...(output === "listStream" ? { limit: 2000 } : { disableOutput: true }),
                    });
                  };
                  // Arm terminal updates first so nothing ending during registration can fall through a gap.
                  yield* register("process", "updateStream");
                  const baseline = yield* register("process", "listStream").pipe(
                    Effect.flatMap((body) => decode(ProcessPage, body)),
                  );
                  for (const row of baseline.items) keepProcess(row);
                  for (const id of new Set([...target.processIds, ...processes.keys()])) {
                    if (baseline.items.some((row) => row.id === id)) continue;
                    const body = yield* link.get(`/process/${id}`);
                    const row = yield* decode(ProcessRead, body);
                    const appVersion = row.appVersion ?? processes.get(id)?.appVersion;
                    processes.set(id, {
                      ...row,
                      id,
                      ...(appVersion === undefined ? {} : { appVersion }),
                    });
                  }
                  if (target.versionId !== null) {
                    yield* register("app-version", "updateStream");
                    const baseline = yield* register("app-version", "listStream").pipe(
                      Effect.flatMap((body) => decode(VersionPage, body)),
                    );
                    const row = baseline.items.find((row) => row.id === target.versionId);
                    if (row !== undefined) keepVersion(row);
                    else {
                      const body = yield* link.get(`/app-version/${target.versionId}`);
                      const status = yield* decode(Schema.Struct({ status: Schema.String }), body);
                      // GET may have no revision: it is the fresh answer for this registration.
                      version = { id: target.versionId, status: status.status };
                    }
                  }
                  attempt = 0;
                  return Stream.concat(
                    Stream.succeed(signal("live")),
                    link.frames.pipe(
                      Stream.map((raw) => {
                        const frame = Option.getOrUndefined(decodeFrame(raw));
                        const entity = subscriptions.get(frame?.subscriptionName ?? "");
                        if (entity === undefined) return undefined;
                        let changed = false;
                        for (const value of frame?.data?.update ?? []) {
                          if (entity === "process") {
                            const row = Option.getOrUndefined(decodeProcess(value));
                            if (
                              row !== undefined &&
                              (target.processIds.includes(row.id) ||
                                (target.processIds.length === 0 &&
                                  row.appVersion?.id === target.versionId))
                            ) {
                              keepProcess(row);
                              changed = true;
                            }
                          } else {
                            const row = Option.getOrUndefined(decodeVersion(value));
                            if (row !== undefined && row.id === target.versionId) {
                              keepVersion(row);
                              changed = true;
                            }
                          }
                        }
                        return changed ? signal("live") : undefined;
                      }),
                      Stream.filter((value): value is OperationSignal => value !== undefined),
                      Stream.concat(
                        Stream.fail(
                          new ZeropsUnavailable({
                            operation: "socket",
                            message: "Operation receiver ended",
                          }),
                        ),
                      ),
                    ),
                  );
                }),
              ),
            );
          const recover = (): Stream.Stream<OperationSignal, OperationError> =>
            cycle().pipe(
              Stream.catch((error) => {
                if (error._tag === "ZeropsRefused") return Stream.fail(error);
                const retry = Effect.gen(function* () {
                  yield* operationBackoff(attempt++, error.retryAfterMs);
                  return recover();
                });
                return Stream.concat(Stream.succeed(signal("recovering")), Stream.unwrap(retry));
              }),
            );
          return Stream.concat(Stream.succeed(signal("baselining")), recover());
        }),
      ),
  };
}
