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

import type { EnvironmentTier } from "@t3tools/shared/hqEnvironment";

/** What a tier follows: a stage the head of `main`, a production its releases. */
export const TIER_SOURCES: { readonly [T in EnvironmentTier]: ReadonlyArray<string> } = {
  stage: ["main"],
  production: ["release"],
};
