/**
 * An application whose production and stage are branches of a Git repository, as HQ tells it once
 * a release went out: production `main` with v0.1.3 pushed, stage `mate-stage` with the merged head
 * pushed (the MimV1 rig's mim-eval2, 2026-10-18).
 */
import { HqEnvironmentId } from "@t3tools/contracts";

import type { AccountStore } from "../store.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { hqAppFamily, hqAppsScope } from "../families/hqNavigation.ts";
import { seedHqNavigation } from "./hqNavigation.ts";

export const GIT_APP = "shop";
export const GIT_PRODUCTION = HqEnvironmentId.make("git-production");
export const GIT_STAGE = HqEnvironmentId.make("git-stage");
const REMOTE = { url: "https://github.com/acme/shop.git", repositoryId: "1" };
const KEPT_AT = "2026-10-18T08:32:56.792316Z";
const BEFORE = "c".repeat(40);
const HEAD = "d".repeat(40);
const GROUP = "e".repeat(40);
const ATTACHED = "2026-10-18T10:27:28.517144Z";
const PRODUCTION_TARGET = { kind: "git", branch: "main", delivery: "direct" } as const;
const RELEASE_TARGET = {
  environmentId: GIT_PRODUCTION,
  createdAt: ATTACHED,
  target: PRODUCTION_TARGET,
} as const;

function pushed(id: string, branch: string, cause: "release" | "merge", ref: string) {
  const attempt = {
    remote: REMOTE,
    ref: `refs/heads/${branch}`,
    sha: HEAD,
    credentialKeptAt: KEPT_AT,
    before: BEFORE,
    phase: "submitting",
  };
  return {
    id,
    kind: "push",
    service: "appdev",
    sha: HEAD,
    state: "pushed",
    cause,
    ref,
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-10-18T11:23:18.987Z",
    endedAt: "2026-10-18T11:23:29.542Z",
    supersededBy: null,
    evidence: {
      attempt,
      confirmed: {
        remote: REMOTE,
        ref: attempt.ref,
        before: BEFORE,
        after: HEAD,
        at: "2026-10-18T11:23:29.436Z",
        via: "answer",
      },
      nextActor: "none",
      nextAction: "Operation ended",
    },
  };
}

const environment = {
  sources: ["main"],
  keyHeld: false,
  keyInvalid: false,
  can: { remove_git_environment: { allow: true } },
  birth: { ended: true },
};

const RELEASE_OFFER = {
  head: GROUP,
  suggestion: "v0.1.4",
  summary: { subjects: [], total: 0, more: 0, atLeast: false },
  gate: { allow: false, reason: "Production already runs what is merged." },
  releaseTarget: RELEASE_TARGET,
  inFlight: null,
};

const ENVIRONMENTS = [
  {
    ...environment,
    id: GIT_PRODUCTION,
    target: PRODUCTION_TARGET,
    tier: "production",
    name: "shop-production",
    sources: ["release"],
    order: 1,
    release: {
      id: "267",
      target: "git",
      releaseTarget: RELEASE_TARGET,
      tag: "v0.1.3",
      planned: true,
      ended: true,
      landed: true,
      endedAt: "2026-10-18T11:23:29.542Z",
      leftOut: [],
    },
    jobs: [pushed("60", "main", "release", "v0.1.3")],
  },
  {
    ...environment,
    id: GIT_STAGE,
    target: { kind: "git", branch: "mate-stage", delivery: "direct" },
    tier: "stage",
    name: "shop-stage",
    order: 2,
    release: null,
    jobs: [pushed("59", "mate-stage", "merge", HEAD)],
  },
];

/** Seeds the application's navigation and, unless `detail` is false, its held releases and repositories. */
export function seedGitApplication(
  store: AccountStore,
  orgId: string,
  options: { readonly detail?: boolean } = {},
): void {
  seedHqNavigation(store, orgId, {
    structure: { ungrouped: [], apps: [{ id: GIT_APP, name: "Shop", projects: [] }] },
  });
  // HQ's navigation row as its own decoder reads it, environments and all.
  const scope = hqAppsScope(orgId);
  const held = store.state().streams.get(scope);
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: held?.generation ?? 0 }],
    reset: false,
    rows: [
      {
        family: "hqApp",
        id: GIT_APP,
        value: hqAppFamily.hq!.decode(
          {
            id: GIT_APP,
            name: "Shop",
            can: {},
            contents: { empty: true, deletingProjectIds: [] },
            projectIds: [],
            births: [],
            environments: ENVIRONMENTS,
            changes: [],
            releaseOffer: RELEASE_OFFER,
          },
          `app:${GIT_APP}`,
        )!,
        revision: { kind: "hq", incarnation: "seed", revision: 1_000_000 },
      },
    ],
    removals: [],
  });
  if (options.detail === false) return;
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope: hqAppDetailScope(orgId, GIT_APP), generation: 0 }],
    reset: false,
    rows: [
      {
        key: "releases",
        value: {
          kind: "releases",
          value: [
            {
              tag: "v0.1.3",
              sha: GROUP,
              entries: [{ service: "appdev", sha: HEAD }],
              by: "owner",
              at: "2026-10-18T11:23:18.273Z",
              state: "approved",
              reason: null,
              rollbackOf: null,
              target: "git",
              releaseTarget: RELEASE_TARGET,
            },
          ],
        },
      },
      {
        key: "repos",
        value: {
          kind: "repos",
          value: [
            {
              name: "appdev",
              mainHead: HEAD,
              updatedAt: "2026-10-18T11:18:43.808Z",
              remote: {
                ...REMOTE,
                keptAt: KEPT_AT,
                keptBy: "owner",
                expiresAt: null,
                invalidSince: null,
              },
            },
          ],
        },
      },
    ].map(({ key, value }, index) => ({
      family: "hqAppDetail",
      id: `${GIT_APP}/${key}`,
      revision: { kind: "hq", incarnation: "git-application", revision: index + 1 },
      value: value as never,
    })),
    removals: [],
  });
}
