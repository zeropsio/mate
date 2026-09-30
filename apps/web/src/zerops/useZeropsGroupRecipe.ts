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
 * What comes back is already import-ready (`importReadyTier`): every
 * `buildFromGit` + `zeropsSetup` converted to `startWithoutCode`, with the map
 * of which repository each service's code lives in carried alongside for zcp's
 * adoption.
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
  importReadyTier,
  RECIPE_TIER_PATHS,
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
  /** `state` is `loading`: what the stage's and the production's form waits on. */
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
      if (!cancelled) setHeld({ key, tries, answer });
    };
    void client.readFile(slug, GROUP_REPOSITORY, RECIPE_TIER_PATHS[tier], "main").then(
      (file) => {
        const ready = file === undefined ? undefined : importReadyTier(file.content);
        settle(
          ready === undefined
            ? ABSENT
            : {
                state: "present",
                tier: { kind: "tier", tier, yaml: ready.yaml, sources: ready.sources },
                services: ready.services,
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
  const answer = key === "" ? (pending ? LOADING : ABSENT) : (current?.answer ?? LOADING);
  const rereading = current !== null && current.tries !== tries;
  return { ...answer, loading: answer.state === "loading", rereading, reread };
}
