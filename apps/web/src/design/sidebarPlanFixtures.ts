/**
 * The pass 16 plan's menu, as fixtures: the six projects its mock draws, so
 * the harness (`design.html?set=plan`) can be put side by side with it.
 *
 * Every production chip state the plan names stands in one of them: Letopis
 * with a change waiting for production, Mate with none, Beviro whose last
 * release failed, Snap healthy, ZIT with only a stage, and Imperial Titan
 * folded, production down, and Lena at work in it. Every word is made up;
 * the hosts are `example.app`.
 *
 * Fixtures only: nothing here ships in the app bundle.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  deployedVersion,
  type EnvironmentRow,
  type FlowPullRequest,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { SidebarProjectFlow } from "~/components/zerops/SidebarZeropsTree";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const sha = (seed: string) => seed.padEnd(40, "0").slice(0, 40);

const group = (id: string, name: string) => [`mate:g:${id}`, `mate:name:${name}`];

function routes(...hosts: ReadonlyArray<string>): ReadonlyArray<ZeropsPublicRoute> {
  return hosts.map((host) => ({ service: "app", port: 80, host, url: `https://${host}` }));
}

/** A Mate's container, connected. */
function mate(id: string, bot: string, groupTags: ReadonlyArray<string>): ZeropsCandidate {
  return {
    key: `${id}:zcp`,
    project: {
      id,
      name: `${bot} - dev`,
      status: "ACTIVE",
      tagList: ["mate", ...groupTags, "mate:role:dev", `mate:bot:${bot}`],
    },
    group: "connected",
    environmentId: EnvironmentId.make(`env-${id}`),
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  };
}

/** A stage or a production: no container, its services standing as the platform says. */
function stop(
  id: string,
  role: "stage" | "prod",
  groupTags: ReadonlyArray<string>,
  options: {
    readonly hosts: ReadonlyArray<string>;
    readonly status?: string;
    readonly deployedMinutesAgo?: number;
  },
): ZeropsCandidate {
  return {
    key: `${id}:zcp`,
    project: {
      id,
      name: role === "prod" ? "production" : "stage",
      status: "ACTIVE",
      tagList: [...groupTags, `mate:role:${role}`],
    },
    group: "unavailable",
    reason: "no Zerops Mate container in this project",
    missingContainer: true,
    routes: routes(...options.hosts),
    services: {
      hostnames: ["app"],
      deployedAt:
        options.deployedMinutesAgo === undefined
          ? undefined
          : minutesAgo(options.deployedMinutesAgo),
      deployable: [
        {
          serviceId: `${id}-app`,
          hostname: "app",
        },
      ],
      statuses: [
        {
          hostname: "app",
          status: options.status ?? "ACTIVE",
        },
      ],
    },
  } as ZeropsCandidate;
}

const LETOPIS = group("letopis", "Letopis");
const MATE = group("mate", "Mate");
const BEVIRO = group("beviro", "Beviro");
const SNAP = group("snap", "Snap");
const ZIT = group("zit", "ZIT");
const TITAN = group("titan", "Imperial Titan");

export const PLAN_CANDIDATES: ReadonlyArray<ZeropsCandidate> = [
  mate("letopis-fen", "Fen", LETOPIS),
  stop("letopis-stage", "stage", LETOPIS, {
    hosts: ["letopis-stage.example.app"],
    deployedMinutesAgo: 180,
  }),
  stop("letopis-prod", "prod", LETOPIS, {
    hosts: ["letopis.example.app", "admin.letopis.example.app"],
  }),
  mate("mate-dara", "Dara", MATE),
  mate("mate-exp", "Experimentator", MATE),
  mate("beviro-cleo", "Cleo", BEVIRO),
  mate("beviro-juno", "Juno", BEVIRO),
  stop("beviro-stage", "stage", BEVIRO, {
    hosts: ["shop-stage.example.app"],
    deployedMinutesAgo: 40,
  }),
  stop("beviro-prod", "prod", BEVIRO, { hosts: ["shop.example.app", "admin.shop.example.app"] }),
  mate("snap-kai", "Kai", SNAP),
  mate("snap-nova", "Nova", SNAP),
  stop("snap-prod", "prod", SNAP, { hosts: ["snap.example.app"] }),
  mate("zit-theo", "Theo", ZIT),
  stop("zit-stage", "stage", ZIT, {
    hosts: ["zit-stage.example.app", "api.zit-stage.example.app", "ws.zit-stage.example.app"],
    deployedMinutesAgo: 4 * 24 * 60,
  }),
  mate("titan-lena", "Lena", TITAN),
  stop("titan-prod", "prod", TITAN, { hosts: ["titan.example.app"], status: "CONTAINER_FAILED" }),
];

function activity(
  id: string,
  input: Partial<ZeropsAgentActivity> & { readonly minutes: number },
): ZeropsAgentActivity {
  const { minutes, ...rest } = input;
  return {
    threadId: ThreadId.make(`thread-${id}`),
    kind: "idle",
    status: null,
    face: "idle",
    subject: undefined,
    snippet: undefined,
    at: minutesAgo(minutes),
    progress: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: `env-${id}:thread-${id}`,
    task: rest.subject,
    ...rest,
  };
}

export const PLAN_ACTIVITY = new Map<string, ZeropsAgentActivity>([
  [
    "letopis-fen",
    activity("letopis-fen", {
      minutes: 7 * 60,
      subject: "Study the specification, then build the core and the server from the ground up",
      snippet: "Rebuilt the core and the server foundation, keeping every behaviour it had.",
    }),
  ],
  [
    "mate-dara",
    activity("mate-dara", {
      minutes: 3 * 24 * 60,
      subject: "What alternatives do we have for the dev URL?",
      snippet: "A signed-in dev URL works without a platform change: the session allows it.",
    }),
  ],
  ["mate-exp", activity("mate-exp", { minutes: 5 * 24 * 60 })],
  [
    "beviro-cleo",
    activity("beviro-cleo", {
      minutes: 24 * 60,
      subject: "Check the admin sign-in after the upgrade",
      snippet: "The admin signs in again; the session cookie lasts a day now.",
    }),
  ],
  [
    "beviro-juno",
    activity("beviro-juno", {
      minutes: 5,
      kind: "input",
      face: "needs",
      subject: "Tune the storefront: page render, navigation, images and the cart",
      snippet: "Merge #54 into production now, or wait for tonight's window?",
      question: "Merge #54 into production now, or wait for tonight's window?",
    }),
  ],
  [
    "snap-kai",
    activity("snap-kai", {
      minutes: 12,
      face: "done",
      unread: true,
      subject: "Make the spec usable by a separate service with its own session",
      snippet: "Dropped every local assumption from the spec, so it stands on its own.",
    }),
  ],
  [
    "snap-nova",
    activity("snap-nova", {
      minutes: 1.1,
      kind: "working",
      face: "working",
      subject: "Add a /status page showing hostname, Node version and server time",
      liveStep: { words: "Build the app", code: "pnpm build" },
    }),
  ],
  [
    "zit-theo",
    activity("zit-theo", {
      minutes: 4 * 24 * 60,
      kind: "failed",
      face: "needs",
      subject: "Deploy the zitcore stage from main",
      snippet: "Build failed: tsc found 3 errors in src/net/session.ts",
      errorLine: "Build failed: tsc found 3 errors in src/net/session.ts",
    }),
  ],
  [
    "titan-lena",
    activity("titan-lena", {
      minutes: 3.5,
      kind: "working",
      face: "working",
      subject: "Titan game destruction and enemies",
      liveStep: { words: "Checking the game in the browser" },
    }),
  ],
]);

const VIEWER: ZeropsMateOwner = {
  name: "Petra Malá",
  initials: "PM",
  avatarUrl: null,
  isViewer: true,
};
const KAREL: ZeropsMateOwner = {
  name: "Karel Novák",
  initials: "KN",
  avatarUrl: null,
  isViewer: false,
};
const MILO: ZeropsMateOwner = {
  name: "Milo Dvořák",
  initials: "MD",
  avatarUrl: null,
  isViewer: false,
};

export const PLAN_OWNERS = new Map<string, ZeropsMateOwner>([
  ["letopis-fen", KAREL],
  ["mate-dara", VIEWER],
  ["mate-exp", VIEWER],
  ["beviro-cleo", MILO],
  ["beviro-juno", VIEWER],
  ["snap-kai", KAREL],
  ["snap-nova", VIEWER],
  ["zit-theo", KAREL],
  ["titan-lena", VIEWER],
]);

function row(
  projectId: string,
  tier: "stage" | "production",
  appVersionName: string,
  tone: EnvironmentRow["tone"] = "good",
): EnvironmentRow {
  const version = deployedVersion(appVersionName);
  const source = tier === "production" ? "release" : "main";
  return {
    kind: "environment",
    projectId,
    name: tier,
    tier,
    source,
    commit: version.commit,
    version,
    versionRepository: "app",
    line: version.label === undefined ? source : `${source} · ${version.label}`,
    tone,
  };
}

function change(number: number, title: string, mateProjectId: string): FlowPullRequest {
  return {
    repository: "app",
    number,
    title,
    kind: "code",
    mateProjectId,
    author: undefined,
    url: undefined,
    checks: "passing",
    checkWord: "Passing",
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    headSha: "3f9c1b2",
    baseBranch: "main",
    line: `app #${String(number)}`,
    updatedAt: minutesAgo(90),
  };
}

const waiting = (...subjects: ReadonlyArray<string>) => [
  { commits: subjects.map((subject, index) => ({ sha: `c${String(index)}`, subject })) },
];

const flow = (input: Partial<SidebarProjectFlow>): SidebarProjectFlow => ({
  pullRequests: [],
  environments: new Map(),
  releaseOffered: false,
  ...input,
});

export const PLAN_FLOWS = new Map<string, SidebarProjectFlow>([
  [
    "letopis",
    flow({
      pullRequests: [
        change(4, "Rebuild the world core and durable server foundations", "letopis-fen"),
      ],
      environments: new Map([
        ["letopis-stage", row("letopis-stage", "stage", sha("45a1c07"))],
        ["letopis-prod", row("letopis-prod", "production", `${sha("44b2d19")} v0.1.44 petra`)],
      ]),
      releaseOffered: true,
      releaseContents: waiting("Rebuild the world core and durable server foundations"),
    }),
  ],
  ["mate", flow({})],
  [
    "beviro",
    flow({
      environments: new Map([
        ["beviro-stage", row("beviro-stage", "stage", sha("58c3e21"))],
        ["beviro-prod", row("beviro-prod", "production", `${sha("56d4f33")} v0.1.56 petra`)],
      ]),
      releaseOffered: true,
      releaseContents: waiting("Tune the image sizes", "Keep the cart across a reload"),
      releaseFailure: {
        tag: "v0.1.57",
        kind: "deploy-failed",
        at: minutesAgo(12),
        error: "Build pipeline failed; no recognised log pattern matched.",
        service: "app",
      },
    }),
  ],
  [
    "snap",
    flow({
      pullRequests: [
        change(
          2,
          "Add a /status page to the app showing hostname, Node version and current server time",
          "snap-nova",
        ),
      ],
      environments: new Map([
        ["snap-prod", row("snap-prod", "production", `${sha("10e5a44")} v0.1.0 petra`)],
      ]),
    }),
  ],
  [
    "zit",
    flow({
      environments: new Map([["zit-stage", row("zit-stage", "stage", sha("71f6b55"))]]),
    }),
  ],
  [
    "titan",
    flow({
      environments: new Map([
        ["titan-prod", row("titan-prod", "production", `${sha("23a7c66")} v2.3.0 petra`)],
      ]),
    }),
  ],
]);

/** Folded as the plan's mock draws it. */
export const PLAN_COLLAPSED: ReadonlyArray<string> = ["titan"];

/** The Mate whose conversation is open. */
export const PLAN_ACTIVE = "snap-nova";
