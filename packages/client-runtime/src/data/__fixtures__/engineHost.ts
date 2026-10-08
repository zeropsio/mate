/** An engine host over a real store and live text, for the readers' tests; its links are counters. */
import type { ConversationRow, Item, RunRecord } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";

import { engineHeader } from "./mateEngine.ts";
import { ENGINE_LIVE_POLICY, makeEngineLiveText } from "../engineLive.ts";
import type { MateEngineHost } from "../engineHost.ts";
import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
  engineRowsScope,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import type { Row } from "../reducer.ts";
import { makeAccountStore } from "../store.ts";

/** A host over a real store and live text; the conversation's link is a counter. */
export function makeTestEngineHost(
  key: EngineConversationKey = { environmentId: "env-ada", conversationId: "thread-ada" },
) {
  const ENV = key.environmentId;
  const atoms = AtomRegistry.make();
  const store = makeAccountStore(atoms);
  const live = makeEngineLiveText({
    policy: { ...ENGINE_LIVE_POLICY, publicationCoalescingMs: 0 },
    setTimer: (callback) => {
      queueMicrotask(callback);
      return 0;
    },
    clearTimer: () => {},
  });
  const counts = { held: 0, earlier: 0, rowsHeld: 0 };
  const host = {
    store,
    atoms,
    live,
    conversations: {
      hold: () => {
        counts.held += 1;
        return () => {
          counts.held -= 1;
        };
      },
      holdRows: () => {
        counts.rowsHeld += 1;
        return () => {
          counts.rowsHeld -= 1;
        };
      },
      readEarlier: () => {
        counts.earlier += 1;
        return true;
      },
    },
    operations: {},
    close: () => {},
  } as unknown as MateEngineHost;
  let seq = 100;
  const deliver = (records: {
    readonly runs?: ReadonlyArray<RunRecord>;
    readonly items?: ReadonlyArray<Item>;
  }) => {
    const revision = (rev: number) => ({
      kind: "mate-conversation" as const,
      environmentId: ENV,
      epoch: 1,
      seq: rev,
    });
    seq += 1;
    // The Mate's window opens on the oldest run delivered and says whether runs lie before it.
    const oldest = Math.min(...(records.runs ?? []).map((run) => run.ordinal), Infinity);
    const window =
      oldest === Infinity
        ? { oldestOrdinal: 1, earlier: false }
        : { oldestOrdinal: oldest, earlier: oldest > 1 };
    const rows: Row[] = [
      {
        family: "mateEngineConversation",
        id: engineConversationId(key),
        value: {
          environmentId: ENV,
          header: engineHeader(key.conversationId),
          window,
        },
        revision: revision(seq),
      },
      ...(records.runs ?? []).map((run): Row => ({
        family: "mateEngineRun",
        id: engineFactId(ENV, run.id),
        value: { ...run, environmentId: ENV },
        revision: revision(seq),
      })),
      ...(records.items ?? []).map((item): Row => ({
        family: "mateEngineItem",
        id: engineFactId(ENV, item.id),
        value: { ...item, environmentId: ENV },
        revision: revision(seq),
      })),
    ];
    store.dispatch({
      kind: "delivery",
      via: "mate-direct",
      scopes: Object.values(engineConversationScopes(key)).map((scope) => ({
        scope,
        generation: 0,
      })),
      reset: false,
      partial: true,
      rows,
      removals: [],
    });
  };
  /** The Mate's conversation rows, as its rows subscription delivers them. */
  const deliverRows = (rows: ReadonlyArray<ConversationRow>) => {
    seq += 1;
    store.dispatch({
      kind: "delivery",
      via: "mate-direct",
      scopes: [{ scope: engineRowsScope(ENV), generation: 0 }],
      reset: false,
      rows: rows.map((row): Row => ({
        family: "mateEngineRow",
        id: engineFactId(ENV, row.conversationId),
        value: { ...row, environmentId: ENV },
        revision: { kind: "mate-conversation", environmentId: ENV, epoch: 1, seq },
      })),
      removals: [],
    });
  };
  return { host, live, deliver, deliverRows, counts };
}
