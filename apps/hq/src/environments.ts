/**
 * An application's environments (SPEC §3.2b): its stage and production projects, held by HQ where
 * main declared them in the group repository's `environments.yaml`. Each has a name, its tier, the
 * branches it follows — a stage `main`, a production `release` — and its place in the order they
 * were declared in (main D24: a release reads the first stage). It is recorded with the project's
 * attach (`structure.ts`), with no pull request; every stage deploys on push, since main's app
 * never wrote `on-request` or `requireOnStage`.
 *
 * @module environments
 */

export type EnvironmentTier = "stage" | "production";

/** What a tier follows: a stage the head of `main`, a production its releases. */
export const TIER_SOURCES: { readonly [T in EnvironmentTier]: ReadonlyArray<string> } = {
  stage: ["main"],
  production: ["release"],
};

/** A name a branch and a deploy ask an environment by (main D10). */
const NAME = /^[a-z][a-z0-9-]*$/u;

/**
 * The longest name, a DNS label's length: a deploy key is named `mate-hq-deploy:<env>:<projectId>`,
 * and Zerops caps a token's name at 255 characters.
 */
export const ENVIRONMENT_NAME_MAX = 63;

/** The highest number a taken name is given before there is none (main D10). */
const LAST_SUFFIX = 999;

/**
 * What an environment is called, from the name a person gave its project (main D10): diacritics
 * dropped, lower-case, every run of anything else a dash, leading non-letters and trailing dashes
 * cut; the tier when nothing is left; numbered from `-2` when taken. At most `ENVIRONMENT_NAME_MAX`
 * characters, a number included. None past `-999`.
 */
export function deriveEnvironmentName(
  projectName: string,
  tier: EnvironmentTier,
  taken: ReadonlyArray<string>,
): string | undefined {
  const cleaned = projectName
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^[^a-z]+|-+$/gu, "");
  const base = cleaned.length === 0 ? tier : cleaned;
  /** `base` cut so `rest` still fits, with no dash left at the cut. */
  const within = (rest: string) =>
    `${base.slice(0, ENVIRONMENT_NAME_MAX - rest.length).replace(/-+$/u, "")}${rest}`;
  const used = new Set(taken);
  if (!used.has(within(""))) return within("");
  for (let suffix = 2; suffix <= LAST_SUFFIX; suffix += 1) {
    const candidate = within(`-${String(suffix)}`);
    if (!used.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Why a name a person gave an environment is refused (main D11; longer than
 * `ENVIRONMENT_NAME_MAX`), or nothing.
 */
export function environmentNameProblem(
  name: string,
): "environment_name_missing" | "environment_name_long" | "environment_name_invalid" | undefined {
  if (name.trim().length === 0) return "environment_name_missing";
  if (name.length > ENVIRONMENT_NAME_MAX) return "environment_name_long";
  return NAME.test(name) ? undefined : "environment_name_invalid";
}
