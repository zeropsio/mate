/**
 * The tier a new environment or a new Mate starts from, as the organization's HQ stream last said
 * it (`appReads`), **as the person** (guide 4.3, SPEC §3.2c).
 *
 * The recipe is not a Zerops object and never was: it is `import.yaml` in the application's recipe
 * repository, proposed by a Mate and landed on its `main` — by Core where it only adds files, by a
 * developer of the application where it edits one. HQ reads every tier off that `main` as the
 * person, for whoever may read the application's changes, and carries them on its stream beside
 * the application's releases; a recipe landing moves the application's revision, and its fresh
 * tiers come down the same stream. Nothing here reads HQ on its own (owner, 2026-10-01: no fetch
 * in a hook). While the stream is down, what it said last is said and never handed over (0.13.2's
 * rule: a remembered answer is not acted on); it reconnects by itself, and its fresh snapshot
 * hands the tier over again.
 *
 * What comes back is the tier as `main` holds it, and the names of its services: the creation's
 * plan converts it for the platform (`createEnvironment.ts`, `recipeTier.ts`), since which service
 * goes in when depends on whether the new environment has a Mate.
 *
 * Four honest answers, and the New Mate dialog says a different thing for each (`newMateDoor`):
 * `loading` while HQ's stream has not said the application's tiers yet, `present`, `absent` where
 * HQ says `main` has no such tier (no file, or one declaring no service), and `unreadable` where
 * HQ's read failed, HQ holds a tier this build finds no service in, or its snapshot says nothing
 * of the tier: that is not "no recipe", and a Mate is never made empty for it.
 */

import { useAtomValue } from "@effect/atom-react";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import type { AppRead } from "@t3tools/shared/hqAppReads";
import {
  recipeTierServices,
  type EnvironmentRecipeChoice,
  type RecipeTier,
} from "@t3tools/client-runtime/zerops";
import { useCallback, useState } from "react";

import { hqAppReadsAtom, hqDown, hqNavigationAtom } from "../state/zerops";
import { useAccountDataOptional } from "./ZeropsAccountData";

export type GroupRecipeTier = Extract<EnvironmentRecipeChoice, { kind: "tier" }>;

export interface GroupRecipe {
  readonly state: "loading" | "present" | "absent" | "unreadable";
  /** The tier, while the recipe is `present`. */
  readonly tier: GroupRecipeTier | undefined;
  readonly services: ReadonlyArray<string>;
  /** No answer from HQ's stream yet, or its stream is down — what the creation's form waits on. */
  readonly loading: boolean;
  /** The answer held is being read again — *Try again* — and stands meanwhile. */
  readonly rereading: boolean;
  /** Asks HQ's stream for a fresh snapshot, keeping the answer held until it lands: *Try again*. */
  readonly reread: () => void;
}

type Answer = Pick<GroupRecipe, "state" | "tier" | "services">;

const LOADING: Answer = { state: "loading", tier: undefined, services: [] };
const ABSENT: Answer = { state: "absent", tier: undefined, services: [] };
const UNREADABLE: Answer = { state: "unreadable", tier: undefined, services: [] };

/** A streamed declaration and its services, without keeping a second copy of HQ's fact. */
const answerOf = (read: RecipeTierResponse | undefined, tier: RecipeTier): Answer => {
  if (read === undefined) return UNREADABLE;
  if (read.state === "absent") return ABSENT;
  const services = recipeTierServices(read.importYaml);
  return services === undefined
    ? UNREADABLE
    : {
        state: "present",
        tier: { kind: "tier", tier, yaml: read.importYaml },
        services: services.map((service) => service.hostname),
      };
};

export function useZeropsGroupRecipe(input: {
  /** The application whose recipe it is — its group. */
  readonly appId: string | undefined;
  readonly tier: RecipeTier;
  readonly enabled: boolean;
}): GroupRecipe {
  const { appId, enabled, tier } = input;
  const navigation = useAtomValue(hqNavigationAtom);
  const reads = useAtomValue(hqAppReadsAtom);
  const appRead = appId === undefined ? undefined : reads?.get(appId);
  const [retrying, setRetrying] = useState<AppRead | undefined>(undefined);
  const retry = useAccountDataOptional()?.retry;

  const reread = useCallback(() => {
    if (retry === undefined) return;
    setRetrying(appRead);
    retry();
  }, [appRead, retry]);

  const answer =
    !enabled || appRead === undefined
      ? LOADING
      : appRead.failure !== null || appRead.value === null
        ? UNREADABLE
        : answerOf(appRead.value.recipes[tier], tier);
  const down = hqDown(navigation);
  return {
    ...answer,
    tier: down ? undefined : answer.tier,
    loading: down || answer.state === "loading",
    rereading: retrying !== undefined && retrying === appRead,
    reread,
  };
}
