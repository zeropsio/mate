/** HQ attachment reads beside the scope socket, using each demanded scope's stream policy. */
import { changeReadId, changeReadRequest, hqChangeReadFamily } from "../families/hqChangeRead.ts";
import type { ChangeReadRequest } from "../families/hqChangeRead.ts";
import type { ChangeDetailResponse, AttachmentLink } from "@t3tools/shared/hqChanges";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Random from "effect/Random";

import { hqPictureFamily, pictureId, pictureLink } from "../families/hqPicture.ts";
import { factKey, type ScopeKey } from "../model.ts";
import { streamOf, type Row } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";

export const makeHqPictureReads = (options: {
  readonly orgId: string;
  readonly store: AccountStore;
  readonly read: (link: AttachmentLink) => Effect.Effect<Blob, StreamFault>;
  readonly change?: (
    request: ChangeReadRequest,
  ) => Effect.Effect<ChangeDetailResponse, StreamFault>;
  readonly signal: (scope: ScopeKey, event: StreamEvent) => Effect.Effect<unknown>;
  readonly wake: () => void;
  readonly refresh?: Set<ScopeKey>;
}) =>
  Effect.sync(() => {
    const { store, signal } = options;
    const active = new Map<
      ScopeKey,
      { readonly generation: number; readonly fiber: Fiber.Fiber<void> }
    >();
    const observe = Effect.fnUntraced(function* (scopes: ReadonlyArray<ScopeKey>) {
      const wanted = new Set(
        scopes.filter((scope) =>
          [hqPictureFamily.scope.suffix, hqChangeReadFamily.scope.suffix].includes(
            scope.split(":")[2]!,
          ),
        ),
      );
      for (const [scope, entry] of active) {
        if (wanted.has(scope) && streamOf(store.state(), scope).generation === entry.generation)
          continue;
        active.delete(scope);
        yield* Fiber.interrupt(entry.fiber);
      }
      const now = yield* Clock.currentTimeMillis;
      let wakeAt = Number.POSITIVE_INFINITY;
      for (const scope of wanted) {
        const stream = streamOf(store.state(), scope);
        if (stream.phase === "refused" || stream.phase === "live" || active.has(scope)) continue;
        if (stream.next.kind === "retry" && stream.next.at > now) {
          wakeAt = Math.min(wakeAt, stream.next.at);
          continue;
        }
        const owner = scope.split(":").slice(3).join(":");
        const isChange = scope.split(":")[2] === hqChangeReadFamily.scope.suffix;
        const family = isChange ? "hqChangeRead" : "hqPicture";
        const link = isChange ? changeReadRequest(owner) : pictureLink(owner);
        if (link === null) {
          yield* signal(scope, {
            kind: "fault",
            jitter: 0,
            fault: {
              outcome: "definitive-refusal",
              message: "Invalid HQ detail identity.",
            },
          });
          continue;
        }
        yield* signal(scope, { kind: "attempt" });
        yield* signal(scope, { kind: "handshake" });
        const generation = streamOf(store.state(), scope).generation;
        const id = isChange
          ? changeReadId(options.orgId, owner)
          : pictureId({ orgId: options.orgId, link: link as AttachmentLink });
        // Attachment ids identify immutable bytes. A remount or segment never reads them again.
        if (
          !options.refresh?.has(scope) &&
          readsOfState(store.state()).fact(family, id).kind === "known"
        ) {
          yield* signal(scope, { kind: "baseline-committed" });
          continue;
        }
        store.dispatch({ kind: "baseline-begin", scope, generation });
        const request: Effect.Effect<Blob | ChangeDetailResponse, StreamFault> = isChange
          ? (options.change?.(link as ChangeReadRequest) ??
            Effect.fail({ outcome: "definitive-refusal", message: "HQ cannot read this change." }))
          : options.read(link as AttachmentLink);
        const read = request.pipe(
          Effect.flatMap((blob) =>
            Effect.gen(function* () {
              const current = streamOf(store.state(), scope);
              if (
                current.generation !== generation ||
                !current.demanded ||
                current.phase !== "baselining"
              )
                return;
              if ((isChange ? hqChangeReadFamily : hqPictureFamily).sampled!.decode(blob) === null)
                return yield* Effect.fail<StreamFault>({
                  outcome: "definitive-refusal",
                  message: isChange
                    ? "HQ returned an invalid change."
                    : "HQ returned no picture bytes.",
                });
              store.dispatch({
                kind: "baseline-commit",
                scope,
                generation,
                via: "hq-stream",
                members: [id],
                rows: [
                  {
                    family,
                    id,
                    value: blob,
                    revision: {
                      kind: "hq",
                      incarnation: isChange
                        ? [
                            id,
                            (blob as ChangeDetailResponse).change.updatedAt,
                            (blob as ChangeDetailResponse).change.head,
                            (blob as ChangeDetailResponse).mainHead,
                          ].join("/")
                        : id,
                      revision: 0,
                    },
                  } as Row,
                ],
              });
              options.refresh?.delete(scope);
              yield* signal(scope, { kind: "baseline-committed" });
            }),
          ),
          Effect.catch((fault) =>
            Effect.gen(function* () {
              const current = streamOf(store.state(), scope);
              if (
                current.generation !== generation ||
                !current.demanded ||
                current.phase !== "baselining"
              )
                return;
              if (
                fault.outcome === "authoritative-denial" &&
                store.state().facts.has(factKey(family, id))
              )
                store.dispatch({ kind: "access", family, id, access: "denied" });
              yield* signal(scope, { kind: "fault", fault, jitter: yield* Random.next });
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (active.get(scope)?.generation === generation) active.delete(scope);
              options.wake();
            }),
          ),
        );
        const fiber = yield* Effect.forkScoped(read, { startImmediately: false });
        active.set(scope, { generation, fiber });
      }
      return wakeAt;
    });
    return observe;
  });
