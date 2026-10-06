/**
 * What HQ offers the person to do with an application, as its structure streamed it (`can`,
 * `@t3tools/shared/hqOffers`): its changes' verbs, a deploy asked again, and each
 * environment's deploy key. Drawn here, never decided: HQ decides each over the very target its
 * write is enforced with, and decides the write again at the press. While HQ does not answer,
 * every one of them is unavailable since then; before HQ has said, none is known.
 */
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import { useCallback } from "react";

import { useHqOffers } from "./useHqOffers";

type ChangeVerb = "read" | "comment" | "merge" | "close" | "redeploy";

const VERBS: { readonly [V in ChangeVerb]: string } = {
  read: "read_change",
  comment: "comment_change",
  merge: "merge_change",
  close: "close_change",
  redeploy: "redeploy",
};

/**
 * An application's change verbs: whether each is offered, in words why one is not — HQ's refusal,
 * that it has not said, or since when it does not answer — and whether HQ refused reading them.
 */
export type ZeropsChangeOffers = { readonly [V in ChangeVerb]: boolean } & {
  readonly why: { readonly [V in ChangeVerb]?: string };
  readonly readRefused: boolean;
};

/** An application's offers by its id; `undefined` for one HQ's structure does not hold, or before it. */
export type ZeropsChangeOffersOf = (appId: string) => ZeropsChangeOffers | undefined;

export function useChangeOffers(): ZeropsChangeOffersOf {
  const { structure, state, words } = useHqOffers();
  return useCallback(
    (appId) => {
      const app = structure?.apps.find((candidate) => candidate.id === appId);
      if (app === undefined) return undefined;
      const states = Object.fromEntries(
        Object.entries(VERBS).map(([verb, hqVerb]) => [verb, state(app.can, hqVerb)]),
      ) as { readonly [V in ChangeVerb]: HqOfferState };
      const why: { [V in ChangeVerb]?: string } = {};
      for (const verb of Object.keys(VERBS) as ReadonlyArray<ChangeVerb>) {
        const reason = words(states[verb]);
        if (reason !== undefined) why[verb] = reason;
      }
      return {
        read: states.read.kind === "allowed",
        comment: states.comment.kind === "allowed",
        merge: states.merge.kind === "allowed",
        close: states.close.kind === "allowed",
        redeploy: states.redeploy.kind === "allowed",
        why,
        readRefused: states.read.kind === "refused",
      };
    },
    [state, structure, words],
  );
}

/**
 * Whether HQ offers the person keeping an environment's deploy key (`keep_deploy_token`), by its
 * project's id; `undefined` while HQ has not said, or does not answer.
 */
export function useKeepDeployKeyOffer(): (projectId: string) => boolean | undefined {
  const { structure, state } = useHqOffers();
  return useCallback(
    (projectId) => {
      const environment = structure?.apps
        .flatMap((app) =>
          app.environments === undefined || "refused" in app.environments ? [] : app.environments,
        )
        .find((candidate) => candidate.projectId === projectId);
      const offer = state(environment?.can, "keep_deploy_token");
      return offer.kind === "allowed" ? true : offer.kind === "refused" ? false : undefined;
    },
    [state, structure],
  );
}
