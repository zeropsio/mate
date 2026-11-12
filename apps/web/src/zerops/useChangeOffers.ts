/**
 * What the person may do with an application (`can`, `@t3tools/shared/hqOffers`), decided from
 * their live Zerops roles: its changes' verbs, a deploy asked again, and each environment's deploy
 * key. Drawn here, never decided; HQ decides the write again at the press, and answers at once
 * while it is away (`hqAwayAnswer`). Before the roles are read, none is known.
 */
import { useAtomValue } from "@effect/atom-react";
import { hqMergeOfferWords, hqOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { hqOffer, type HqOfferState } from "@t3tools/shared/hqOffers";
import { useCallback } from "react";

import { zeropsSessionAtom } from "../state/zerops";
import { useHqStructure } from "./useHqOffers";
import { usePersonNames } from "./useZeropsMateOwners";

type ChangeVerb = "read" | "comment" | "merge" | "close";

const VERBS: { readonly [V in ChangeVerb]: string } = {
  read: "read_change",
  comment: "comment_change",
  merge: "merge_change",
  close: "close_change",
};

/**
 * An application's change verbs: whether each is offered, in words why one is not — HQ's refusal,
 * that it has not said, or since when it does not answer — and whether HQ refused reading them.
 * A merge the application's limit holds says who merges there, by name.
 */
export type ZeropsChangeOffers = { readonly [V in ChangeVerb]: boolean } & {
  readonly why: { readonly [V in ChangeVerb]?: string };
  readonly readRefused: boolean;
};

/** An application's offers by its id; `undefined` for one HQ's structure does not hold, or before it. */
export type ZeropsChangeOffersOf = (appId: string) => ZeropsChangeOffers | undefined;

export function useChangeOffers(): ZeropsChangeOffersOf {
  const structure = useHqStructure();
  const nameOf = usePersonNames(
    useAtomValue(zeropsSessionAtom)?.activeOrganization?.organizationId,
  );
  return useCallback(
    (appId) => {
      const app = structure?.apps.find((candidate) => candidate.id === appId);
      if (app === undefined) return undefined;
      const states = Object.fromEntries(
        Object.entries(VERBS).map(([verb, hqVerb]) => [verb, hqOffer(app.can, hqVerb)]),
      ) as { readonly [V in ChangeVerb]: HqOfferState };
      const why: { [V in ChangeVerb]?: string } = {};
      for (const verb of Object.keys(VERBS) as ReadonlyArray<ChangeVerb>) {
        const reason =
          verb === "merge"
            ? hqMergeOfferWords(states.merge, app.mergers, nameOf)
            : hqOfferWords(states[verb]);
        if (reason !== undefined) why[verb] = reason;
      }
      return {
        read: states.read.kind === "allowed",
        comment: states.comment.kind === "allowed",
        merge: states.merge.kind === "allowed",
        close: states.close.kind === "allowed",
        why,
        readRefused: states.read.kind === "refused",
      };
    },
    [nameOf, structure],
  );
}

/**
 * Whether HQ offers the person keeping an environment's deploy key (`keep_deploy_token`), by its
 * project's id; `undefined` while HQ has not said, or does not answer.
 */
export function useKeepDeployKeyOffer(): (projectId: string) => boolean | undefined {
  const structure = useHqStructure();
  return useCallback(
    (projectId) => {
      const environment = structure?.apps
        .flatMap((app) => app.environments ?? [])
        .find(
          (candidate) =>
            candidate.target.kind === "zerops" && candidate.target.projectId === projectId,
        );
      const offer = hqOffer(environment?.can, "keep_deploy_token");
      return offer.kind === "allowed" ? true : offer.kind === "refused" ? false : undefined;
    },
    [structure],
  );
}

/** A native environment's own deployment verdict, never a sibling project's grant. */
export function useEnvironmentDeployOffer(): (projectId: string) => boolean {
  const structure = useHqStructure();
  return useCallback(
    (projectId) => {
      const environment = structure?.apps
        .flatMap((app) => app.environments ?? [])
        .find((row) => row.target.kind === "zerops" && row.target.projectId === projectId);
      return hqOffer(environment?.can, "redeploy").kind === "allowed";
    },
    [structure],
  );
}
