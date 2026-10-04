/**
 * The tier a new environment or a new Mate starts from, as the organization's HQ stream last said
 * it (`appReads`), **as the person** (guide 4.3, SPEC §3.2c).
 *
 * The recipe is not a Zerops object and never was: it is `import.yaml` in the application's recipe
 * repository, proposed by a Mate and landed on its `main` — by Core where it only adds files, by a
 * developer of the application where it edits one. HQ reads every tier off that `main` as the
 * person, for whoever may read the application's changes, and carries them on its stream beside
 * the application's releases; a recipe landing moves the application's revision, and its fresh
 * tiers come down the same stream. No fetch in a hook (owner, 2026-10-01).
 *
 * The Mate tier alone is read on its own, through its store (`mateRecipeReads.ts`), where the
 * stream cannot be acted on for it: a Core from before its stream carried the tier, or one that
 * could not read it, and any Core while its stream is down — 0.13.2's rule, a remembered answer
 * is said, not acted on. While that read is on its way, what was said last is said and no tier
 * is handed over, so Add waits for it.
 *
 * What comes back is the tier as `main` holds it, and the names of its services: the creation's
 * plan converts it for the platform (`createEnvironment.ts`, `recipeTier.ts`), since which service
 * goes in when depends on whether the new environment has a Mate.
 *
 * Four honest answers, and the New Mate dialog says a different thing for each (`newMateDoor`):
 * `loading` while nothing is said of the tier yet, `present`, `absent` where HQ says `main` has
 * no such tier (no file, or one declaring no service), and `unreadable` where HQ's read failed or
 * HQ holds a tier this build finds no service in: that is not "no recipe", and a Mate is never
 * made empty for it.
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

import { hqStructureAtom } from "../state/zerops";
import { useOfficialHq } from "./accountHq";
import { requestHqSnapshot } from "./hqStructure";
import { rereadMateRecipe, useMateRecipeRead, type ReadMateRecipe } from "./mateRecipeReads";

export type GroupRecipeTier = Extract<EnvironmentRecipeChoice, { kind: "tier" }>;

export interface GroupRecipe {
  readonly state: "loading" | "present" | "absent" | "unreadable";
  /** The tier, while the recipe is `present`. */
  readonly tier: GroupRecipeTier | undefined;
  readonly services: ReadonlyArray<string>;
  /** No answer from HQ's stream yet — what the creation's form waits on. */
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
  // Not carried, and not read on its own here: not known yet.
  if (read === undefined) return LOADING;
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
  const streamed = useAtomValue(hqStructureAtom);
  const appRead = appId === undefined ? undefined : streamed?.appReads?.get(appId);
  const [retrying, setRetrying] = useState<AppRead | undefined>(undefined);
  const hq = useOfficialHq();
  const streamDown =
    streamed !== null && streamed !== undefined && streamed.unavailableSince !== null;
  const streamedMate =
    appRead !== undefined && appRead.failure === null ? appRead.value?.recipes.mate : undefined;
  // The Mate tier is read on its own where the stream carries none, or is down.
  const readsOwn =
    tier === "mate" &&
    enabled &&
    hq !== null &&
    appId !== undefined &&
    (streamDown ||
      (appRead !== undefined &&
        appRead.value !== null &&
        appRead.failure === null &&
        streamedMate === undefined));
  const ownKey = readsOwn ? `${hq.address}|${appId}` : undefined;
  const reader = useCallback<ReadMateRecipe>(
    (signal) =>
      hq === null || appId === undefined
        ? Promise.reject(new Error("HQ is not open here."))
        : hq.api.mateRecipe(appId, signal),
    [appId, hq],
  );
  const own = useMateRecipeRead(ownKey, readsOwn ? reader : undefined);

  const reread = () => {
    if (ownKey !== undefined) {
      rereadMateRecipe(ownKey);
      return;
    }
    if (streamed === null || streamed === undefined) return;
    setRetrying(appRead);
    requestHqSnapshot(streamed.organizationId);
  };

  if (ownKey !== undefined) {
    // Said: what was read last, else what the stream last said; acted on only once read afresh.
    const said: Answer =
      own.last === undefined
        ? streamedMate === undefined
          ? LOADING
          : answerOf(streamedMate, tier)
        : own.last.kind === "failed"
          ? UNREADABLE
          : answerOf(own.last.tier, tier);
    const acted = own.fresh;
    return {
      ...said,
      tier: acted ? said.tier : undefined,
      loading: !acted,
      rereading: own.reading && own.last !== undefined,
      reread,
    };
  }

  const answer =
    !enabled || appRead === undefined
      ? LOADING
      : appRead.failure !== null || appRead.value === null
        ? UNREADABLE
        : answerOf(appRead.value.recipes[tier], tier);
  return {
    ...answer,
    loading: answer.state === "loading",
    rereading: retrying !== undefined && retrying === appRead,
    reread,
  };
}
