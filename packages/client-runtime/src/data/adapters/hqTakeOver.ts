/**
 * A member's take-over, as the account holds it: the tokens the member minted, which HQ picks out of
 * the organization's token list this browser reads from Zerops for each read, read while their page
 * demands them (supervised by the common retry and refusal policy) and again after each replace of
 * ours; the replaces themselves, through their own coordinator.
 */
import * as Effect from "effect/Effect";
import type { ZeropsIntegrationToken } from "../../zerops/groupReach.ts";
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
  /** The organization's integration tokens, read fresh from Zerops with the person's own session. */
  readonly tokens: (orgId: string) => Promise<ReadonlyArray<ZeropsIntegrationToken>>;
  readonly makeId: () => string;
}) {
  const { store, api, tokens } = options;
  let closed = false;
  const reads = makeSettingsReads(store);
  const listRead = (key: TakeOverKey): SettingRead<"hqTakeOver"> => ({
    family: "hqTakeOver",
    id: takeOverId(key),
    scope: takeOverScope(key),
    link: takeOverLink(key),
    read: async () => api.takeOverList(key.userId, await tokens(key.orgId)),
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
