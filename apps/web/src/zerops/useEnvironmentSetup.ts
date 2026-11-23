/**
 * Environments whose setup is not finished, through the account's projection, and *Finish setting
 * up* as one HQ start (main D21, E07): `deploy_key` for an environment HQ holds without a usable
 * key, `environment` with its project for a stage or a production HQ does not hold. HQ runs it on
 * the person's token; its application's navigation `operation` says how it stands, to every
 * device, and a failed one is finished again. Nothing of it runs in this tab.
 */
import { environmentSetup, hqOperationOf } from "@t3tools/client-runtime/data";
import type {
  GroupEnvironmentTier,
  HalfMadeGroupEnvironment,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { applicationOperationsAtom, useEnvironmentStarts } from "./useEnvironmentOperation";
import { useAccountOrgId, useProjection } from "./ZeropsAccountData";

const NONE = Atom.make<ReadonlyArray<HalfMadeGroupEnvironment & { readonly finish: boolean }>>([]);

/** The kinds a finish starts. */
const FINISH_KINDS = ["environment", "deploy_key"] as const;

export interface FinishGroupEnvironment {
  /** The applications whose environment is being finished now, with its tier. */
  readonly finishing: ReadonlyMap<string, GroupEnvironmentTier>;
  /** The applications whose last finish did not go through, with its tier. */
  readonly unfinished: ReadonlyMap<string, GroupEnvironmentTier>;
  /** Why the last finish asked here was refused, by application. */
  readonly refused: ReadonlyMap<string, string>;
  /** Finishes `entry`, as the person asked. */
  readonly finish: (entry: HalfMadeGroupEnvironment) => void;
}

export function useEnvironmentSetup(projectIds: ReadonlyArray<string>) {
  const orgId = useAccountOrgId();
  const halfMade = useProjection(
    environmentSetup,
    useMemo(() => (orgId === null ? null : { orgId, projectIds }), [orgId, projectIds]),
    NONE,
  );
  const operations = useAtomValue(applicationOperationsAtom);
  const starts = useEnvironmentStarts();
  // Each finish this tab asked for, by application: its tier, then the operation HQ took it as,
  // until HQ's navigation showed that operation and it ended.
  const [asked, setAsked] = useState<ReadonlyMap<string, Asked>>(() => new Map());
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(() => new Map());

  const finish = useCallback(
    (entry: HalfMadeGroupEnvironment) => {
      const { groupId, tier } = entry;
      setAsked((current) => new Map(current).set(groupId, { tier }));
      setRefused((current) => without(current, groupId));
      // HQ holds the environment: only its key is missing. Otherwise its project is attached too.
      const started =
        entry.registered && entry.environmentName !== undefined
          ? starts.startDeployKey(groupId, entry.environmentName)
          : starts.startEnvironment(groupId, { tier, projectId: entry.projectId });
      started.then(
        (id) => {
          setAsked((current) => {
            const held = current.get(groupId);
            return held === undefined ? current : new Map(current).set(groupId, { ...held, id });
          });
        },
        (cause: unknown) => {
          setAsked((current) => without(current, groupId));
          setRefused((current) => new Map(current).set(groupId, zeropsErrorMessage(cause)));
        },
      );
    },
    [starts],
  );
  // A finish asked here is under way until HQ showed its operation and that operation ended.
  useEffect(() => {
    let next: Map<string, Asked> | undefined;
    for (const [groupId, held] of asked) {
      if (held.id === undefined) continue;
      const operation = operations.get(groupId);
      const shown = operation?.id === held.id;
      if (shown && held.seen !== true)
        (next ??= new Map(asked)).set(groupId, { ...held, seen: true });
      else if (held.seen === true && (!shown || operation?.failure !== undefined))
        (next ??= new Map(asked)).delete(groupId);
    }
    if (next !== undefined) setAsked(next);
  }, [asked, operations]);

  const finishing = useMemo((): FinishGroupEnvironment => {
    const going = new Map<string, GroupEnvironmentTier>();
    const failed = new Map<string, GroupEnvironmentTier>();
    for (const [groupId, operation] of operations) {
      for (const kind of FINISH_KINDS) {
        const standing = hqOperationOf(operation, kind, undefined).kind;
        const tier =
          asked.get(groupId)?.tier ?? halfMade.find((entry) => entry.groupId === groupId)?.tier;
        if (tier === undefined) continue;
        if (standing === "going" || standing === "waiting") going.set(groupId, tier);
        if (standing === "failed") failed.set(groupId, tier);
      }
    }
    // A start HQ has not shown yet is under way from the press.
    for (const [groupId, { tier }] of asked) if (!failed.has(groupId)) going.set(groupId, tier);
    return { finishing: going, unfinished: failed, refused, finish };
  }, [asked, finish, halfMade, operations, refused]);

  return { halfMade, finishing };
}

interface Asked {
  readonly tier: GroupEnvironmentTier;
  /** The operation HQ took it as, once HQ answered its start. */
  readonly id?: string;
  /** HQ's navigation showed that operation. */
  readonly seen?: true;
}

const without = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};
