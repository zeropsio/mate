/**
 * The tier a new environment starts from, read out of the group repo **as the
 * person** (guide 4.3).
 *
 * The recipe is not a Zerops object and never was: it is `import.yaml` in the
 * group repo, proposed by a Mate and merged by somebody with production rights
 * (D13). So this reads `{slug}/group` on `main` with the person's own Gitea
 * token — Gitea enforces their mirrored rights, and a person who cannot see the
 * repository sees no recipe rather than somebody else's.
 *
 * What comes back is the tier as `main` holds it, and the names of its
 * services: the creation's plan converts it for the platform
 * (`createEnvironment.ts`, `recipeTier.ts`), since which service goes in when
 * depends on whether the new environment has a Mate.
 *
 * Four honest answers, and the New Mate dialog says a different thing for each
 * (`newMateDoor`): `loading` while the repository is being read — or cannot be
 * read yet, its org still being looked up or no token held this moment —
 * `present`, `absent` where `main` has no recipe (no file, one declaring no
 * services, no group org or no Gitea at all), and `unreadable` where the read
 * failed: that is not "no recipe", and a Mate is never made empty for it.
 */

import {
  GROUP_REPOSITORY,
  RECIPE_TIER_PATHS,
  recipeTierServices,
  type EnvironmentRecipeChoice,
  type RecipeTier,
} from "@t3tools/client-runtime/zerops";
import { useCallback, useEffect, useState } from "react";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

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
  /** The answer held is being read again — *Try again*, or a token back — and stands meanwhile. */
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
  /** Gitea's public origin, or `undefined` while the account has none. */
  readonly giteaOrigin: string | undefined;
  /** The group's Gitea org — its registry slug. */
  readonly slug: string | undefined;
  readonly tier: RecipeTier;
  readonly enabled: boolean;
  /**
   * What the read needs is still being read — the account's Gitea, the registry naming the
   * group's org — so a missing origin or org is not known to be missing yet: `loading`.
   */
  readonly pending?: boolean | undefined;
  /**
   * What `main` may have changed with — the newest proposal of the recipe that landed, while the
   * forge has answered. Once known, a change of it reads the recipe again, from nothing.
   */
  readonly revision?: string | undefined;
}): GroupRecipe {
  const { enabled, giteaOrigin, pending = false, revision, slug, tier } = input;
  // Keyed on it, so a read that could not go out goes once a token is held.
  const readable = useGiteaReadable(giteaOrigin);
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
  const key =
    enabled && giteaOrigin !== undefined && slug !== undefined
      ? `${giteaOrigin}|${slug}|${tier}|${landings.count}`
      : "";

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined || slug === undefined || !readable) return;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    let cancelled = false;
    const settle = (answer: Answer) => {
      if (answer.state !== "unreadable") remembered.set(`${giteaOrigin}|${slug}|${tier}`, answer);
      if (!cancelled) setHeld({ key, tries, answer });
    };
    void client.readFile(slug, GROUP_REPOSITORY, RECIPE_TIER_PATHS[tier], "main").then(
      (file) => {
        const services = file === undefined ? undefined : recipeTierServices(file.content);
        settle(
          file === undefined || services === undefined
            ? ABSENT
            : {
                state: "present",
                tier: { kind: "tier", tier, yaml: file.content },
                services: services.map((service) => service.hostname),
              },
        );
      },
      () => {
        settle(UNREADABLE);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [giteaOrigin, key, readable, slug, tier, tries]);

  const reread = useCallback(() => {
    setTries((current) => current + 1);
  }, []);

  const current = key !== "" && held !== null && held.key === key ? held : null;
  const recalled =
    key !== "" && held === null ? remembered.get(`${giteaOrigin}|${slug}|${tier}`) : undefined;
  const answer =
    key === "" ? (pending ? LOADING : ABSENT) : (current?.answer ?? recalled ?? LOADING);
  const rereading = current !== null && current.tries !== tries;
  // A remembered answer is said, not acted on: what is imported comes from this read.
  const loading = answer.state === "loading" || (key !== "" && current === null);
  return { ...answer, loading, rereading, reread };
}
