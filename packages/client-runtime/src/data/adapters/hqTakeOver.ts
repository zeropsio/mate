/**
 * A member's take-over, as the account holds it: the tokens HQ reads for the member while their
 * page demands them and again after each replace of ours; the replaces themselves, through their
 * own coordinator. Reads use the common retry and refusal policy.
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
    read: () => api.takeOverList(key.userId),
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
    /**
     * Takes one token over, the request's id the operation's that replaces it; a Mate's key goes to
     * `ownerUserId` when given, else to its owner.
     */
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
              id: requestId,
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
