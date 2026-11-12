/**
 * A member's take-over, as the account holds it: the tokens the member minted, read while their page
 * demands them (supervised by the common retry and refusal policy) and again after each replace of
 * ours; the replaces themselves, through their own coordinator.
 */
import * as Effect from "effect/Effect";
import type { HqApi } from "../../zerops/hq/client.ts";
import {
  takeOverId,
  takeOverLink,
  takeOverRequestScope,
  takeOverScope,
  type TakeOverKey,
} from "../families/hqTakeOver.ts";
import { makeOperations } from "../operations/coordinator.ts";
import { makeTakeOverExecutor, type TakeOverWrites } from "../operations/executors/hqTakeOver.ts";
import type { AccountStore } from "../store.ts";
import { commitOwn, makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";
import { hqNeedsUpdate } from "../../zerops/hq/refusals.ts";

type TakeOverApi = TakeOverWrites & Pick<HqApi, "takeOverList">;

export function makeTakeOver(options: {
  readonly store: AccountStore;
  readonly api: TakeOverApi;
  readonly makeId: () => string;
}) {
  const { store, api } = options;
  let closed = false;
  const reads = makeSettingsReads(store);
  const listRead = (key: TakeOverKey): SettingRead<"hqTakeOver"> => ({
    family: "hqTakeOver",
    id: takeOverId(key),
    scope: takeOverScope(key),
    link: takeOverLink(key),
    read: () => api.takeOverList?.(key.userId),
    unsupported: hqNeedsUpdate("take over a member's tokens"),
  });
  const operations = makeOperations({
    store,
    makeId: options.makeId,
    executors: { hq: makeTakeOverExecutor({ api, current: () => !closed }) },
  });
  return {
    demand: (key: TakeOverKey): (() => void) => (closed ? () => {} : reads.demand(listRead(key))),
    again: (key: TakeOverKey) => {
      if (!closed) reads.again(listRead(key));
    },
    /** Replaces one token; a Mate's key goes to `ownerUserId` when given, else to its owner. */
    replace: async (key: TakeOverKey, tokenId: string, ownerUserId?: string): Promise<string> => {
      const requestId = options.makeId();
      if (!closed)
        commitOwn(store, "hqTakeOverRequest", takeOverRequestScope(key), takeOverId(key), {
          requestId,
          tokenId,
        });
      try {
        await Effect.runPromise(
          operations.submit(
            {
              kind: "take-over-token",
              ...key,
              tokenId,
              ...(ownerUserId === undefined ? {} : { ownerUserId }),
            },
            requestId,
          ),
        );
        return requestId;
      } finally {
        if (!closed) reads.readAfterWrite(listRead(key));
      }
    },
    close: () => {
      closed = true;
      reads.close();
    },
  };
}

export type TakeOver = ReturnType<typeof makeTakeOver>;
