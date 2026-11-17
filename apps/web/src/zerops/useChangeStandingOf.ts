/**
 * Where each open change stands for the person looking (`changeStanding`): whether they merge in
 * its application, whether somebody asked, and the names that say it. The one reader every surface
 * that names a change shares — the menu, the conversation's header and composer, the overview, the
 * project's page, a change's chip — so none decides the rule again.
 *
 * Its answer moves only when what decides a standing does: who merges in an application
 * (`mergers`, the person's `can`), what the member list calls somebody, which Mates are the
 * person's own, for a comment's mark their opening a change's review, or a merge, close or ask
 * starting or ending (`useChangeActOf`). HQ's navigation moves
 * for much else — a Mate's word, a change's push — and none of that hands a list surface a new
 * reader.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  changeStandingOf,
  viewerMerges,
  type ChangeStandingFacts,
  type ChangeStandingOf,
} from "@t3tools/client-runtime/zerops";
import { shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useMemo } from "react";

import { zeropsAccountDisplay } from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { hqNavigationAtom, hqPeopleAtom, zeropsSessionAtom } from "../state/zerops";
import { changeSeenKey, useChangesSeen } from "./changeSeen";
import { useChangeActOf } from "./flowVerbs";
import { useZeropsSessionOptional } from "./sessionContext";

const NO_FACTS: ChangeStandingFacts = { apps: {}, names: {} };

/**
 * What decides a standing in the organization in view, shared structurally: the same object until
 * an application's mergers, the person's merge verdict there, or somebody's name changes.
 */
export const changeStandingFactsAtom = Atom.make((get): ChangeStandingFacts => {
  const view = get(hqNavigationAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  if (view.orgId !== organizationId || view.structure === null) return NO_FACTS;
  const people = get(hqPeopleAtom);
  return {
    apps: Object.fromEntries(
      view.structure.apps.map((app) => [
        app.id,
        {
          merges: viewerMerges(hqOffer(app.can, "merge_change")),
          people: app.mergers?.people ?? null,
        },
      ]),
    ),
    names:
      people === null
        ? {}
        : Object.fromEntries(Object.entries(people).map(([id, person]) => [id, person.called])),
    // The person's own Mates, as HQ says whose each is: a comment on their change is for them.
    own: Object.fromEntries(
      Object.entries(get(shownHqProjectPeopleAtom)).flatMap(([projectId, facts]) =>
        facts.mine === true ? [[projectId, true as const]] : [],
      ),
    ),
  };
}).pipe(
  Atom.withEquality((a, b) => shareEqual(a, b) === a),
  Atom.withLabel("zerops:change-standing"),
);

/**
 * A reader handed down in place of the account's: a surface drawn outside an account — a design
 * harness, a story of one state — says who looks and who merges itself.
 */
export const ChangeStandingContext = createContext<ChangeStandingOf | null>(null);

/** A change's standing and its word, by its application: stable while what decides it stands. */
export function useChangeStandingOf(): ChangeStandingOf {
  const given = useContext(ChangeStandingContext);
  const facts = useAtomValue(changeStandingFactsAtom);
  const viewer = useZeropsSessionOptional()?.user;
  const userId = viewer?.id;
  const name = viewer == null ? undefined : zeropsAccountDisplay(viewer).name;
  // When each change's review was last opened here: what was commented since is unread.
  const seen = useChangesSeen();
  const read = useMemo(
    () =>
      changeStandingOf(facts, {
        userId,
        name,
        seenAt: (appId, repository, number) => seen[changeSeenKey(appId, repository, number)],
      }),
    [facts, userId, name, seen],
  );
  // What is being done to it now (`changeActOf`): a merge on its way says so on every door to it.
  const actOf = useChangeActOf();
  return useMemo(() => {
    const standing = given ?? read;
    if (actOf === null) return standing;
    return (appId, pull) => {
      const base = standing(appId, pull);
      const act =
        appId === undefined || pull.repository === undefined || pull.number === undefined
          ? undefined
          : actOf(appId, {
              repository: pull.repository,
              number: pull.number,
              headSha: pull.headSha,
            });
      return act === undefined ? base : { ...base, act };
    };
  }, [actOf, given, read]);
}
