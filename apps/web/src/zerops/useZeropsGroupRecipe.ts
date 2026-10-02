/**
 * The tier a new environment starts from, read out of the application's recipe in HQ **as the
 * person** (guide 4.3, SPEC §3.2c).
 *
 * The recipe is not a Zerops object and never was: it is `import.yaml` in the application's recipe
 * repository, proposed by a Mate and landed on its `main` — by Core where it only adds files, by a
 * developer of the application where it edits one. So this reads a tier off that `main` through
 * the organization's official HQ, as the person: HQ answers only who may read the application's
 * changes, and a person who may not sees no recipe rather than somebody else's.
 *
 * What comes back is the tier as `main` holds it, and the names of its services: the creation's
 * plan converts it for the platform (`createEnvironment.ts`, `recipeTier.ts`), since which service
 * goes in when depends on whether the new environment has a Mate.
 *
 * Four honest answers, and the New Mate dialog says a different thing for each (`newMateDoor`):
 * `loading` while the tier is being read — or cannot be read yet, the organization's HQ not open
 * here this moment — `present`, `absent` where HQ says `main` has no such tier (no file, or one
 * declaring no service), and `unreadable` where the read failed, or HQ holds a tier this build
 * finds no service in: that is not "no recipe", and a Mate is never made empty for it.
 */

import {
  recipeTierServices,
  type EnvironmentRecipeChoice,
  type RecipeTier,
} from "@t3tools/client-runtime/zerops";
import { useCallback, useEffect, useState } from "react";

import { useOfficialHq } from "./accountHq";

export type GroupRecipeTier = Extract<EnvironmentRecipeChoice, { kind: "tier" }>;

export interface GroupRecipe {
  readonly state: "loading" | "present" | "absent" | "unreadable";
  /** The tier, while the recipe is `present`. */
  readonly tier: GroupRecipeTier | undefined;
  readonly services: ReadonlyArray<string>;
  /**
   * No answer read this time yet — what the stage's and the production's form waits on. `state`
   * may meanwhile say what the last read said (a dialog opened again).
   */
  readonly loading: boolean;
  /** The answer held is being read again — *Try again* — and stands meanwhile. */
  readonly rereading: boolean;
  /** Reads it again, keeping the answer held until the new one: *Try again*. */
  readonly reread: () => void;
}

type Answer = Pick<GroupRecipe, "state" | "tier" | "services">;

const LOADING: Answer = { state: "loading", tier: undefined, services: [] };
const ABSENT: Answer = { state: "absent", tier: undefined, services: [] };
const UNREADABLE: Answer = { state: "unreadable", tier: undefined, services: [] };

/**
 * The last answer read for each recipe, so a dialog opened again says at once what it said the
 * time before — the door open or shut, no form flashing on the way — while the recipe is read anew
 * behind it, and `loading` holds Add until that read is back. Only a mount's first read stands on
 * it: a proposal landing reads again from nothing. A failed read says nothing about the recipe and
 * is never remembered.
 */
const remembered = new Map<string, Answer>();

/** Forgets every remembered answer: a test's clean start. */
export function forgetGroupRecipes(): void {
  remembered.clear();
}

export function useZeropsGroupRecipe(input: {
  /** The application whose recipe it is — its group. */
  readonly appId: string | undefined;
  readonly tier: RecipeTier;
  readonly enabled: boolean;
  /**
   * What `main` may have changed with — the newest proposal of the recipe that landed, while the
   * application's changes are known. Once known, a change of it reads the recipe again, from
   * nothing.
   */
  readonly revision?: string | undefined;
}): GroupRecipe {
  const { appId, enabled, revision, tier } = input;
  // Keyed on it, so a read that could not go out goes once the organization's HQ is open here.
  const hq = useOfficialHq();
  // A revision first known is where the recipe was read from; only one after it is news.
  const [landings, setLandings] = useState({ seen: revision, count: 0 });
  if (revision !== landings.seen) {
    setLandings({
      seen: revision,
      count:
        landings.seen === undefined || revision === undefined ? landings.count : landings.count + 1,
    });
  }
  // Each *Try again*: the answer held stands until the read it asked for is back.
  const [tries, setTries] = useState(0);
  const [held, setHeld] = useState<{
    readonly key: string;
    /** The try it answers. */
    readonly tries: number;
    readonly answer: Answer;
  } | null>(null);
  const recipe = hq === null || appId === undefined ? "" : `${hq.address}|${appId}|${tier}`;
  const key = enabled && recipe !== "" ? `${recipe}|${landings.count}` : "";

  useEffect(() => {
    if (key === "" || hq === null || appId === undefined) return;
    const stop = new AbortController();
    const settle = (answer: Answer) => {
      if (answer.state !== "unreadable") remembered.set(recipe, answer);
      if (!stop.signal.aborted) setHeld({ key, tries, answer });
    };
    void hq.api.recipeTier(appId, tier, stop.signal).then(
      (read) => {
        if (read.state === "absent") {
          settle(ABSENT);
          return;
        }
        const services = recipeTierServices(read.importYaml);
        settle(
          services === undefined
            ? UNREADABLE
            : {
                state: "present",
                tier: { kind: "tier", tier, yaml: read.importYaml },
                services: services.map((service) => service.hostname),
              },
        );
      },
      () => {
        settle(UNREADABLE);
      },
    );
    return () => {
      stop.abort();
    };
  }, [appId, hq, key, recipe, tier, tries]);

  const reread = useCallback(() => {
    setTries((current) => current + 1);
  }, []);

  const current = key !== "" && held !== null && held.key === key ? held : null;
  const recalled = key !== "" && held === null ? remembered.get(recipe) : undefined;
  // Not asked yet — the organization's HQ not open here, nothing wanted — is not "no recipe".
  const answer = current?.answer ?? recalled ?? LOADING;
  const rereading = current !== null && current.tries !== tries;
  // A remembered answer is said, not acted on: what is imported comes from this read.
  const loading = answer.state === "loading" || (key !== "" && current === null);
  return { ...answer, loading, rereading, reread };
}
