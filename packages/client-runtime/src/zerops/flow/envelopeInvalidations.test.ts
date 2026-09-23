import type { ZeropsServiceSnapshot, ZeropsStateEnvelope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { ServiceRef } from "../data/types.ts";
import type { GitCheckoutState } from "../gitTab.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import {
  checkoutInvalidations,
  envelopeInvalidations,
  forgeRepositoryOf,
  type EnvelopeServices,
} from "./envelopeInvalidations.ts";

const GITEA = "https://gitea-1-3000.prg1.zerops.app";
const APPDEV_REMOTE = `${GITEA}/harbor/appdev.git`;
const APPSTAGE: ServiceRef = service("service-appstage", project("project-stage"));

/** The account holds project-stage's `appstage`; nothing else resolves. */
const services: EnvelopeServices = {
  serviceOf: (projectId, hostname) =>
    projectId === "project-stage" && hostname === "appstage" ? APPSTAGE : null,
};

const snapshot = (overrides: Partial<ZeropsServiceSnapshot> = {}): ZeropsServiceSnapshot => ({
  hostname: "appdev",
  typeVersion: "nodejs@22",
  runtimeClass: "dynamic",
  status: "ACTIVE",
  bootstrapped: true,
  remoteUrl: APPDEV_REMOTE,
  ...overrides,
});

const envelope = (overrides: Partial<ZeropsStateEnvelope> = {}): ZeropsStateEnvelope => ({
  phase: "develop-active",
  environment: "container",
  project: { id: "project-stage", name: "harbor stage" },
  services: [snapshot()],
  generated: "2026-09-23T10:00:00Z",
  ...overrides,
});

const attempt = (at: string, success: boolean) => ({ at, success, iteration: 1 });

const workSession = (deploys: Record<string, ReadonlyArray<ReturnType<typeof attempt>>>) => ({
  intent: "ship it",
  services: Object.keys(deploys),
  createdAt: "2026-09-23T09:00:00Z",
  deploys,
});

const APPDEV_REPO: Invalidation = {
  topic: "forge-repo",
  origin: GITEA,
  owner: "harbor",
  repo: "appdev",
};
const APPSTAGE_DEPLOYMENT: Invalidation = { topic: "deployment", service: APPSTAGE };

describe("envelopeInvalidations (DESIGN §6.1, G3)", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly previous: ZeropsStateEnvelope | undefined;
    readonly next: ZeropsStateEnvelope | undefined;
    readonly expected: ReadonlyArray<Invalidation>;
  }> = [
    {
      name: "the first envelope a feed hears changes nothing it can compare",
      previous: undefined,
      next: envelope({ services: [snapshot({ gitPushState: "pushed" })] }),
      expected: [],
    },
    {
      name: "a service's git push state changing re-reads its remote's repository",
      previous: envelope({ services: [snapshot({ gitPushState: "unpushed" })] }),
      next: envelope({ services: [snapshot({ gitPushState: "pushed" })] }),
      expected: [APPDEV_REPO],
    },
    {
      name: "a push state that appears for the first time is a change",
      previous: envelope({ services: [snapshot()] }),
      next: envelope({ services: [snapshot({ gitPushState: "pushed" })] }),
      expected: [APPDEV_REPO],
    },
    {
      name: "an unchanged push state re-reads nothing",
      previous: envelope({ services: [snapshot({ gitPushState: "pushed" })] }),
      next: envelope({
        services: [snapshot({ gitPushState: "pushed" })],
        generated: "2026-09-23T10:05:00Z",
      }),
      expected: [],
    },
    {
      name: "a push state on a service with no remote names no repository",
      previous: envelope({ services: [snapshot({ remoteUrl: undefined })] }),
      next: envelope({
        services: [snapshot({ remoteUrl: undefined, gitPushState: "pushed" })],
      }),
      expected: [],
    },
    {
      name: "a new successful deploy re-reads that service's deployment",
      previous: envelope({
        workSession: workSession({ appstage: [attempt("2026-09-23T09:10:00Z", false)] }),
      }),
      next: envelope({
        workSession: workSession({
          appstage: [attempt("2026-09-23T09:10:00Z", false), attempt("2026-09-23T09:20:00Z", true)],
        }),
      }),
      expected: [APPSTAGE_DEPLOYMENT],
    },
    {
      name: "a failed deploy attempt re-reads nothing",
      previous: envelope({ workSession: workSession({ appstage: [] }) }),
      next: envelope({
        workSession: workSession({ appstage: [attempt("2026-09-23T09:10:00Z", false)] }),
      }),
      expected: [],
    },
    {
      name: "a successful deploy already heard re-reads nothing",
      previous: envelope({
        workSession: workSession({ appstage: [attempt("2026-09-23T09:20:00Z", true)] }),
      }),
      next: envelope({
        workSession: workSession({ appstage: [attempt("2026-09-23T09:20:00Z", true)] }),
      }),
      expected: [],
    },
    {
      name: "a deploy to a hostname the account does not hold names no service",
      previous: envelope({ workSession: workSession({ apidev: [] }) }),
      next: envelope({
        workSession: workSession({ apidev: [attempt("2026-09-23T09:20:00Z", true)] }),
      }),
      expected: [],
    },
    {
      name: "a push and a deploy in one envelope re-read both",
      previous: envelope({
        services: [snapshot({ gitPushState: "unpushed" })],
        workSession: workSession({ appstage: [] }),
      }),
      next: envelope({
        services: [snapshot({ gitPushState: "pushed" })],
        workSession: workSession({ appstage: [attempt("2026-09-23T09:20:00Z", true)] }),
      }),
      expected: [APPDEV_REPO, APPSTAGE_DEPLOYMENT],
    },
    {
      name: "an envelope that went away re-reads nothing",
      previous: envelope({ services: [snapshot({ gitPushState: "pushed" })] }),
      next: undefined,
      expected: [],
    },
  ];

  it.each(cases)("$name", ({ previous, next, expected }) => {
    expect(envelopeInvalidations(previous, next, services)).toEqual(expected);
  });
});

describe("checkoutInvalidations (DESIGN §6.1, the Git tab's VCS status)", () => {
  const REPOSITORY = { origin: GITEA, owner: "harbor", repo: "appdev" };
  const checkout = (overrides: Partial<GitCheckoutState> = {}): GitCheckoutState => ({
    repository: "appdev",
    isRepo: true,
    hasRemote: true,
    headRef: "mate/ada",
    aheadCount: 0,
    behindCount: 0,
    hasUpstream: true,
    changed: [],
    ...overrides,
  });

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly previous: GitCheckoutState | undefined;
    readonly next: GitCheckoutState;
    readonly expected: ReadonlyArray<Invalidation>;
  }> = [
    {
      name: "the first status a mount hears changes nothing it can compare",
      previous: undefined,
      next: checkout(),
      expected: [],
    },
    {
      name: "commits leaving the checkout for its remote re-read the repository",
      previous: checkout({ aheadCount: 2 }),
      next: checkout({ aheadCount: 0 }),
      expected: [APPDEV_REPO],
    },
    {
      name: "a branch gaining its upstream re-reads the repository",
      previous: checkout({ hasUpstream: false, aheadCount: 1 }),
      next: checkout({ hasUpstream: true, aheadCount: 0 }),
      expected: [APPDEV_REPO],
    },
    {
      name: "a local commit re-reads nothing",
      previous: checkout({ aheadCount: 0 }),
      next: checkout({ aheadCount: 1 }),
      expected: [],
    },
    {
      name: "a file edited in the working tree re-reads nothing",
      previous: checkout(),
      next: checkout({ changed: [{ path: "src/app.ts", insertions: 1, deletions: 0 }] }),
      expected: [],
    },
  ];

  it.each(cases)("$name", ({ previous, next, expected }) => {
    expect(checkoutInvalidations(previous, next, REPOSITORY)).toEqual(expected);
  });

  it("a checkout with no Gitea repository re-reads nothing", () => {
    expect(checkoutInvalidations(checkout({ aheadCount: 2 }), checkout(), null)).toEqual([]);
  });
});

describe("forgeRepositoryOf", () => {
  it.each([
    [APPDEV_REMOTE, { origin: GITEA, owner: "harbor", repo: "appdev" }],
    [`${GITEA}/harbor/appdev`, { origin: GITEA, owner: "harbor", repo: "appdev" }],
    [
      "https://mate:secret@gitea-1-3000.prg1.zerops.app/harbor/appdev.git",
      { origin: GITEA, owner: "harbor", repo: "appdev" },
    ],
    ["git@gitea-1-3000.prg1.zerops.app:harbor/appdev.git", null],
    [`${GITEA}/harbor`, null],
    ["not a url", null],
  ] as const)("%s names %j", (remote, expected) => {
    expect(forgeRepositoryOf(remote)).toEqual(expected);
  });
});
