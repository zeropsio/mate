/**
 * A real account data layer over a Zerops that answers only the sampled reads a test scripts —
 * so a test sees what the store's sharing and sampling do, not what a fake claims.
 *
 * Lives outside `*.test.*` on purpose: it runs the layer's own Effect runtime.
 */
import { makeAccountStore, observeAccount, type ZeropsWire } from "@t3tools/client-runtime/data";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { AccountData } from "../ZeropsAccountData";

/** Real time enough for the layer, on its own runtime, to carry a read through. */
export const LAYER_TURNS_MS = 20;

/** The account observing `orgId`, whose `GET`s `answer` answers — `null` for a path it has not. */
export function makeSampledAccount(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly orgId: string;
  readonly answer: (
    path: string,
  ) => Promise<{ readonly status: number; readonly body: unknown }> | null;
}): AccountData {
  const wire: ZeropsWire = {
    open: Effect.succeed({
      receiverId: "receiver",
      frames: Stream.never,
      post: () => Effect.succeed({ items: [] }),
      get: (path) => {
        const answered = input.answer(path);
        return answered === null
          ? Effect.succeed({ status: 404, body: null })
          : Effect.promise(() => answered);
      },
    }),
  };
  const store = makeAccountStore(input.registry);
  const observation = observeAccount({ store, wire, repairSession: Effect.void });
  observation.show(input.orgId);
  return {
    data: store.data,
    orgId: input.orgId,
    demandDetail: observation.demandDetail,
    readDetail: observation.readDetail,
    revalidate: observation.revalidate,
    retryDetail: observation.retryDetail,
    retry: observation.retry,
    logs: null,
  };
}

/**
 * The account observing `orgId`, whose member list is what `members` resolves at each read, a
 * rejection the platform refusing it (403); counting its reads.
 */
export function makeMemberAccount(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly orgId: string;
  readonly members: () => Promise<ReadonlyArray<ZeropsOrganizationMember>>;
}): { readonly value: AccountData; readonly reads: () => number } {
  let reads = 0;
  const value = makeSampledAccount({
    registry: input.registry,
    orgId: input.orgId,
    answer: (path) => {
      if (!path.includes("/user/list")) return null;
      reads += 1;
      return input.members().then(
        (clientUserList) => ({ status: 200, body: { clientUserList } }),
        () => ({ status: 403, body: null }),
      );
    },
  });
  return { value, reads: () => reads };
}
