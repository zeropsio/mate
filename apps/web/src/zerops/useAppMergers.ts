/**
 * Who merges a project's changes, read from HQ's navigation and set by whoever HQ's structure verb
 * lets (an Owner or Admin): one write through the account's operations (`set-mergers`), whose
 * answer is the limit as it stands. An HQ older than the setting is learned from that write alone:
 * HQ's navigation says nothing of who merges until a project limits it.
 */
import {
  initialStream,
  MERGERS_UNSUPPORTED,
  OperationStopped,
  organizationMembers,
  sameMergers,
  type MembersRead,
} from "@t3tools/client-runtime/data";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import {
  shownMergers,
  type MergersPeople,
} from "~/components/zerops/projectMerging/projectMerging.logic";

import { useAccountOrgId, useDetailDemand, useProjection } from "./accountData";
import { useAccountOperationsOptional } from "./accountOperations";
import { useZeropsSessionOptional } from "./sessionContext";
import { useHqStructure } from "./useHqOffers";

/** Save, as pressed: under way, or refused in plain words. */
export type MergingPress =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "refused"; readonly words: string };

export interface AppMergers {
  /** `undefined` while HQ's navigation has not named the project; `null`: it limits nothing. */
  readonly people: MergersPeople | undefined;
  /** HQ is older than the setting: nothing is offered. */
  readonly older: boolean;
  /** Whether the person changes it; `undefined` while their role is not read. */
  readonly editable: boolean | undefined;
  readonly press: MergingPress;
  /** Sets who merges; `onSaved` once HQ answered. Absent outside an account. */
  readonly save: ((people: MergersPeople, onSaved: () => void) => void) | undefined;
}

const IDLE: MergingPress = { kind: "idle" };

export function useAppMergers(appId: string): AppMergers {
  const app = useHqStructure()?.apps.find((candidate) => candidate.id === appId);
  const offer = hqOffer(app?.can, "structure");
  const operations = useAccountOperationsOptional();
  const orgId = useAccountOrgId();
  const [press, setPress] = useState(IDLE);
  const [older, setOlder] = useState(false);
  const [answer, setAnswer] = useState<Parameters<typeof shownMergers>[1]>(null);
  const held = app === undefined ? undefined : (app.mergers?.people ?? null);
  // The answer stands in only until HQ's navigation moves: from then on the navigation is read,
  // whatever it says later.
  if (answer !== null && held !== undefined && !sameMergers(held, answer.over)) setAnswer(null);
  const save = (people: MergersPeople, onSaved: () => void) => {
    if (operations === null || orgId === null || held === undefined) return;
    setPress({ kind: "saving" });
    operations
      .run(
        { kind: "set-mergers", orgId, appId, people },
        { orgId, unobserved: "HQ isn't answering. Check who can merge when it returns." },
      )
      .then(
        ({ mergers }) => {
          setAnswer({ over: held, now: mergers?.people ?? null });
          setPress(IDLE);
          onSaved();
        },
        (cause: unknown) => {
          if (cause instanceof OperationStopped && cause.code === MERGERS_UNSUPPORTED) {
            setOlder(true);
            setPress(IDLE);
            return;
          }
          setPress({
            kind: "refused",
            words: cause instanceof Error ? cause.message : "HQ did not take this change.",
          });
        },
      );
  };
  return {
    people: held === undefined ? undefined : shownMergers(held, answer),
    older,
    editable: offer.kind === "unknown" ? undefined : offer.kind === "allowed",
    press,
    save: operations === null || orgId === null ? undefined : save,
  };
}

const UNREAD_MEMBERS = Atom.make<MembersRead>({
  fact: { kind: "unknown" },
  coverage: "unknown",
  stream: initialStream({ parent: null, mode: "sampled" }),
  link: null,
  members: [],
  status: "loading",
  settled: false,
  refused: false,
});

/** The organization's member list, held while the caller is drawn: who can be picked. */
export function useMergingMembers(): MembersRead {
  const clientId = useZeropsSessionOptional()?.activeOrganization?.id ?? null;
  const orgId = useAccountOrgId();
  useDetailDemand("organizationMembers", undefined, clientId);
  return useProjection(
    organizationMembers,
    orgId === null || clientId === null ? null : { orgId, clientId },
    UNREAD_MEMBERS,
  );
}
