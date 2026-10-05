/**
 * HQ's navigation scope, through a thin adapter over today's structure stream
 * (`zerops/hq/client.ts` `streamStructure`) until the scoped HQ protocol replaces it (HANDOFF §9
 * step 3). Today's stream carries no revision: each value is ordered by the attempt that delivered
 * it and its place in that attempt. A snapshot is the scope's baseline, committed whole; an
 * application's change places its projects, and an application gone unlists them — it deletes
 * nothing. A Mate's attention as HQ relays it today is mapped to the Mate-authored value, with its
 * producer leg (the Mate's own link to HQ) apart: a live relay of a cut-off Mate is not live.
 *
 * Classification fixes one of today's verdicts (HANDOFF §7): a session ending (4401,
 * `session_required`) is a session to repair once, never a permanent refusal.
 *
 * @module data/adapters/hq
 */
import type { MateLiveView } from "@t3tools/shared/hqMates";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { HqError, type HqApi, type HqStructure } from "../../zerops/hq/client.ts";
import type { HqStructureEvent } from "../../zerops/hq/stream.ts";
import { scopeKeys, type AttentionValue, type LinkKey, type ScopeKey } from "../model.ts";
import { streamOf, type AccountInput, type Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import type { LinkOptions } from "../supervisor.ts";

/** Today's HQ client, as much of it as the navigation scope reads. */
export type HqStructureSource = Pick<HqApi, "streamStructure">;

export function classifyHqFailure(error: unknown): StreamFault {
  if (!(error instanceof HqError)) return { outcome: "transient", message: String(error) };
  const { message } = error;
  if (error.kind !== "refused") return { outcome: "transient", message };
  if (error.status === 401 || error.code === "session_required")
    return { outcome: "recoverable-session", message };
  if (error.status === 403) return { outcome: "authoritative-denial", message };
  return { outcome: "definitive-refusal", message };
}

const WORKING = new Set(["working", "connecting", "monitoring"]);
const WAITING = new Set(["approval", "input", "planReady"]);

/** The Mate-authored attention inside today's relayed overview. */
export function attentionOfView(view: MateLiveView): AttentionValue {
  const threads = view.threads?.list ?? [];
  const waiting = threads.filter((thread) => WAITING.has(thread.kind));
  return {
    mainChatId: view.main?.id ?? null,
    latestChatId: threads[0]?.id ?? null,
    working: threads.filter((thread) => WORKING.has(thread.kind)).length,
    waiting: waiting.length,
    resultIds: threads.flatMap((thread) =>
      thread.turnState === "completed" && thread.turnId !== null
        ? [`${thread.id}:${thread.turnId}`]
        : [],
    ),
    questionIds: waiting.map((thread) => thread.id),
    truncated: (view.threads?.omitted ?? 0) > 0,
  };
}

const producerOf = (view: MateLiveView) =>
  view.presence.online && view.presence.overview === "live" ? "up" : "down";

export function hqNavigationLink(options: {
  readonly orgId: string;
  readonly source: HqStructureSource;
  readonly store: AccountStore;
}): Pick<LinkOptions, "key" | "scopes" | "attempt"> {
  const { orgId, store } = options;
  const key: LinkKey = scopeKeys.hqLink(orgId);
  const navigation: ScopeKey = scopeKeys.navigation(orgId);

  const attempt = (): Effect.Effect<never, StreamFault, Scope.Scope> =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const dispatch = (input: AccountInput) => store.dispatch(input);
      const signal = (target: LinkKey | ScopeKey, event: StreamEvent) =>
        dispatch({ kind: "stream", key: target, now: clock.currentTimeMillisUnsafe(), event });

      signal(navigation, { kind: "attempt" });
      const generation = streamOf(store.state(), navigation).generation;
      let sequence = 0;
      const revision = () => ({
        kind: "hq-observation" as const,
        generation,
        sequence: ++sequence,
      });
      // What this attempt's stream said so far: which projects each application holds, which
      // Mates are outside any, and each Mate's whole overview, to read the next change against.
      const held = new Map<string, ReadonlySet<string>>();
      let outside: ReadonlySet<string> = new Set();
      const views = new Map<string, MateLiveView>();
      let opened = false;

      const rows = (pushed: ReadonlyArray<Row>) =>
        dispatch({
          kind: "rows",
          scope: navigation,
          generation,
          method: "push",
          via: "hq-stream",
          rows: pushed,
        });
      const membership = (add: ReadonlyArray<string>, remove: ReadonlyArray<string>) =>
        dispatch({ kind: "membership", scope: navigation, generation, delta: { add, remove } });
      const placementRows = (app: HqStructure["apps"][number]): ReadonlyArray<Row> =>
        app.projects.map((project) => ({
          family: "placement",
          id: project.projectId,
          value: { kind: "app", appId: app.id, appName: app.name, role: project.kind },
          revision: revision(),
        }));
      const outsideRows = (ids: ReadonlyArray<string>): ReadonlyArray<Row> =>
        ids.map((id) => ({
          family: "placement",
          id,
          value: { kind: "outside" },
          revision: revision(),
        }));
      const attentionRow = (projectId: string, view: MateLiveView): Row => ({
        family: "attention",
        id: projectId,
        value: attentionOfView(view),
        revision: revision(),
        producer: producerOf(view),
      });

      const onEvent = (event: HqStructureEvent) => {
        switch (event.kind) {
          case "snapshot": {
            const { apps, ungrouped } = event.structure;
            held.clear();
            for (const app of apps)
              held.set(app.id, new Set(app.projects.map((project) => project.projectId)));
            outside = new Set(ungrouped.map((entry) => entry.projectId));
            views.clear();
            for (const [projectId, view] of event.mates ?? []) views.set(projectId, view);
            dispatch({ kind: "baseline-begin", scope: navigation, generation });
            dispatch({
              kind: "baseline-commit",
              scope: navigation,
              generation,
              via: "hq-stream",
              members: [...[...held.values()].flatMap((ids) => [...ids]), ...outside],
              rows: [
                ...apps.flatMap(placementRows),
                ...outsideRows([...outside]),
                ...[...views].map(([projectId, view]) => attentionRow(projectId, view)),
              ],
            });
            signal(navigation, { kind: "baseline-committed" });
            return;
          }
          case "change": {
            const before = held.get(event.appId) ?? new Set<string>();
            const after = new Set(event.app?.projects.map((project) => project.projectId) ?? []);
            if (event.app === null) held.delete(event.appId);
            else {
              held.set(event.appId, after);
              rows(placementRows(event.app));
            }
            membership(
              [...after],
              [...before].filter((id) => !after.has(id)),
            );
            return;
          }
          case "ungrouped": {
            const after = new Set(event.mates.map((entry) => entry.projectId));
            rows(outsideRows([...after]));
            membership(
              [...after],
              [...outside].filter((id) => !after.has(id)),
            );
            outside = after;
            return;
          }
          case "mate": {
            if (event.value === null) {
              views.delete(event.projectId);
              dispatch({
                kind: "access",
                family: "attention",
                id: event.projectId,
                access: "denied",
              });
              return;
            }
            const before = views.get(event.projectId);
            if (before === undefined && event.value.presence === undefined) return;
            const view = { ...before, ...event.value } as MateLiveView;
            views.set(event.projectId, view);
            rows([attentionRow(event.projectId, view)]);
            return;
          }
          default:
            // Changes, releases, people, presses and HQ's health belong to later fact families.
            return;
        }
      };

      signal(navigation, { kind: "handshake" });
      return yield* Effect.tryPromise({
        try: (abort) =>
          options.source.streamStructure(
            {
              onEvent,
              onAlive: () => {
                if (opened) return;
                opened = true;
                signal(key, { kind: "handshake" });
                signal(key, { kind: "baseline-committed" });
              },
            },
            abort,
          ),
        catch: classifyHqFailure,
      }).pipe(
        Effect.andThen(
          Effect.fail<StreamFault>({ outcome: "transient", message: "HQ's stream ended." }),
        ),
      );
    });

  return { key, scopes: [navigation], attempt };
}
