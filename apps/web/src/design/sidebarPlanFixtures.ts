/**
 * The pass 16 plan's menu, as fixtures: projects standing in every state its
 * mock draws, so the harness (`design.html?set=plan`) can be put side by side
 * with it.
 *
 * Every chip's every tone stands in one of them: Quillmark with a change
 * waiting for production and a stage, Tiller with neither, Beviro whose last
 * release failed (amber), Brightfold healthy, Ferrow with only a stage,
 * Imperial Titan folded with production down (red) and Maren at work in it,
 * Corvel releasing and Lanternfield stopped on purpose (hollow); Harbourline,
 * a name too long for the heading, whose stage's last deploy failed while its
 * production is down, and Marlow, whose stages are two, one of them down.
 * Hollin holds a Mate in each state of its owner's seat. Every name but
 * Beviro's and Imperial Titan's, and every word, is made up; the hosts are
 * `example.app`.
 *
 * Fixtures only: nothing here ships in the app bundle.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
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

/** A project of the plan: its application in HQ. */
const group = (appId: string, appName: string) => ({ appId, appName });
type PlanGroup = ReturnType<typeof group>;

function routes(...hosts: ReadonlyArray<string>): ReadonlyArray<ZeropsPublicRoute> {
  return hosts.map((host) => ({ service: "app", port: 80, host, url: `https://${host}` }));
}

/**
 * A Mate's container, connected, its agent signed in (D6's tag) — or, with
 * `signer: null`, nobody signed in yet; `owner` is its project's `OWNER`
 * entry, and `connected: false` a Mate whose socket is not open yet.
 */
function mate(
  id: string,
  bot: string,
  app: PlanGroup,
  options: {
    readonly signer?: string | null;
    readonly owner?: string;
    readonly connected?: boolean;
  } = {},
): ZeropsCandidate {
  const { signer = "u-plan", owner, connected = true } = options;
  return {
    key: `${id}:zcp`,
    project: {
      id,
      name: `${bot} - dev`,
      status: "ACTIVE",
      tagList: ["mate", ...(signer === null ? [] : [`mate:signer:claude-code:${signer}`])],
      hq: { ...app, kind: "mate", mate: { name: bot, face: "" } } satisfies HqPlacement,
      ...(owner === undefined ? {} : { userRoles: [{ clientUserId: owner, roleCode: "OWNER" }] }),
    },
    group: connected ? "connected" : "ready",
    ...(connected ? { environmentId: EnvironmentId.make(`env-${id}`) } : {}),
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  };
}

/** A stage or a production: no container, its services standing as the platform says. */
function stop(
  id: string,
  role: "stage" | "prod",
  app: PlanGroup,
  options: {
    readonly hosts: ReadonlyArray<string>;
    readonly status?: string;
    readonly deployedMinutesAgo?: number;
    /** Its own name, where a project has more than one stage. */
    readonly name?: string;
  },
): ZeropsCandidate {
  return {
    key: `${id}:zcp`,
    project: {
      id,
      name: options.name ?? (role === "prod" ? "production" : "stage"),
      status: "ACTIVE",
      hq: {
        ...app,
        kind: role === "prod" ? "production" : "stage",
        mate: null,
      } satisfies HqPlacement,
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
          runtime: true,
        },
      ],
    },
  } as ZeropsCandidate;
}

const QUILLMARK = group("quillmark", "Quillmark");
const TILLER = group("tiller", "Tiller");
const BEVIRO = group("beviro", "Beviro");
const BRIGHTFOLD = group("brightfold", "Brightfold");
const FERROW = group("ferrow", "Ferrow");
const TITAN = group("titan", "Imperial Titan");
const CORVEL = group("corvel", "Corvel");
const LANTERNFIELD = group("lanternfield", "Lanternfield");
const HOLLIN = group("hollin", "Hollin");
const HARBOURLINE = group("harbourline", "Harbourline Field Service Scheduler");
const MARLOW = group("marlow", "Marlow");

export const PLAN_CANDIDATES: ReadonlyArray<ZeropsCandidate> = [
  mate("quillmark-orla", "Orla", QUILLMARK),
  stop("quillmark-stage", "stage", QUILLMARK, {
    hosts: ["quillmark-stage.example.app"],
    deployedMinutesAgo: 180,
  }),
  stop("quillmark-prod", "prod", QUILLMARK, {
    hosts: ["quillmark.example.app", "admin.quillmark.example.app"],
  }),
  mate("tiller-pim", "Pim", TILLER),
  mate("tiller-tamsin", "Tamsin", TILLER),
  mate("beviro-rue", "Rue", BEVIRO),
  mate("beviro-vesna", "Vesna", BEVIRO),
  stop("beviro-stage", "stage", BEVIRO, {
    hosts: ["beviro-stage.example.app"],
    deployedMinutesAgo: 40,
  }),
  stop("beviro-prod", "prod", BEVIRO, {
    hosts: ["beviro.example.app", "admin.beviro.example.app"],
  }),
  mate("brightfold-ilo", "Ilo", BRIGHTFOLD),
  mate("brightfold-brin", "Brin", BRIGHTFOLD),
  stop("brightfold-prod", "prod", BRIGHTFOLD, { hosts: ["brightfold.example.app"] }),
  mate("ferrow-odo", "Odo", FERROW),
  stop("ferrow-stage", "stage", FERROW, {
    hosts: ["ferrow-stage.example.app", "api.ferrow-stage.example.app"],
    deployedMinutesAgo: 4 * 24 * 60,
  }),
  mate("titan-maren", "Maren", TITAN),
  stop("titan-prod", "prod", TITAN, {
    hosts: ["titan.example.app"],
    status: "CONTAINER_FAILED",
  }),
  mate("corvel-sef", "Sef", CORVEL),
  stop("corvel-prod", "prod", CORVEL, { hosts: ["corvel.example.app"] }),
  mate("lanternfield-tove", "Tove", LANTERNFIELD),
  stop("lanternfield-prod", "prod", LANTERNFIELD, {
    hosts: ["lanternfield.example.app"],
    status: "STOPPED",
  }),
  mate("harbourline-arlo", "Arlo", HARBOURLINE),
  stop("harbourline-stage", "stage", HARBOURLINE, {
    hosts: ["harbourline-stage.example.app"],
    deployedMinutesAgo: 25,
  }),
  stop("harbourline-prod", "prod", HARBOURLINE, {
    hosts: ["harbourline.example.app"],
    status: "CONTAINER_FAILED",
  }),
  mate("marlow-wren", "Wren", MARLOW),
  stop("marlow-stage", "stage", MARLOW, {
    hosts: ["marlow-stage.example.app"],
    deployedMinutesAgo: 90,
  }),
  stop("marlow-qa", "stage", MARLOW, {
    hosts: ["marlow-qa.example.app"],
    status: "CONTAINER_FAILED",
    deployedMinutesAgo: 300,
    name: "qa",
  }),
  stop("marlow-prod", "prod", MARLOW, { hosts: ["marlow.example.app"] }),
  // Whose each Mate is, in every state its seat has (the owner, 2026-09-29):
  // nobody's and nobody signed in, open here and not yet; the viewer's own
  // and a colleague's, nobody signed in; and one signed in by somebody the
  // member list does not name.
  mate("hollin-sable", "Sable", HOLLIN, { signer: null }),
  mate("hollin-pell", "Pell", HOLLIN, { signer: null, connected: false }),
  mate("hollin-idris", "Idris", HOLLIN, { signer: null, owner: "cu-petra" }),
  mate("hollin-tamar", "Tamar", HOLLIN, { signer: null, owner: "cu-karel" }),
  mate("hollin-noor", "Noor", HOLLIN, { signer: "u-gone" }),
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
    unread: false,
    pausedUntil: undefined,
    threadKey: `env-${id}:thread-${id}`,
    task: rest.subject,
    ...rest,
  };
}

export const PLAN_ACTIVITY = new Map<string, ZeropsAgentActivity>([
  [
    "quillmark-orla",
    activity("quillmark-orla", {
      minutes: 7 * 60,
      subject: "Sort the recipe cards by season, then by how long they take",
      snippet: "The cards sort by season first; the time they take breaks the ties.",
    }),
  ],
  [
    "tiller-pim",
    activity("tiller-pim", {
      minutes: 3 * 24 * 60,
      subject: "Can the shared preview links expire after a day?",
      snippet: "They can: each link carries its own expiry, a day unless you say otherwise.",
    }),
  ],
  ["tiller-tamsin", activity("tiller-tamsin", { minutes: 5 * 24 * 60 })],
  [
    "beviro-rue",
    activity("beviro-rue", {
      minutes: 24 * 60,
      subject: "Tidy the invoice footer and move the bank details up",
      snippet: "The bank details sit under the total now; the footer keeps only the address.",
    }),
  ],
  [
    "beviro-vesna",
    activity("beviro-vesna", {
      minutes: 5,
      kind: "input",
      face: "needs",
      subject: "Make the product gallery quicker on slow phones",
      snippet: "Load the full-size photos only on a tap, or keep the first two ready?",
      question: "Load the full-size photos only on a tap, or keep the first two ready?",
    }),
  ],
  [
    "brightfold-ilo",
    activity("brightfold-ilo", {
      minutes: 12,
      face: "done",
      unread: true,
      subject: "Let the export run without the desktop app open",
      snippet: "The export runs on the server now, and mails the file once it is ready.",
    }),
  ],
  [
    "brightfold-brin",
    activity("brightfold-brin", {
      minutes: 1.1,
      kind: "working",
      face: "working",
      subject: "Add a health page with the build number and the uptime",
      liveStep: { words: "Stamp the build number into the page", code: "npm run stamp" },
    }),
  ],
  [
    "ferrow-odo",
    activity("ferrow-odo", {
      minutes: 4 * 24 * 60,
      kind: "failed",
      face: "needs",
      subject: "Deploy the ferrow stage from main",
      snippet: "The type check stopped at 3 errors in the sync queue",
      errorLine: "The type check stopped at 3 errors in the sync queue",
    }),
  ],
  [
    "corvel-sef",
    activity("corvel-sef", {
      minutes: 50,
      subject: "Serve the map tiles from the edge cache",
      snippet: "The tiles come from the edge cache now; merged as #12.",
    }),
  ],
  [
    "lanternfield-tove",
    activity("lanternfield-tove", {
      minutes: 9 * 24 * 60,
      subject: "Try a lighter charting library",
      snippet: "It draws, but the old one still handles long series better.",
    }),
  ],
  [
    "hollin-noor",
    activity("hollin-noor", {
      minutes: 2 * 60,
      subject: "Move the booking form's date picker to the top",
      snippet: "It sits above the name field now, and opens on today.",
    }),
  ],
  [
    "harbourline-arlo",
    activity("harbourline-arlo", {
      minutes: 30,
      subject: "Let a dispatcher drag a visit to another technician",
      snippet: "The visit moves, and the technician's day recounts its travel.",
    }),
  ],
  [
    "marlow-wren",
    activity("marlow-wren", {
      minutes: 3 * 60,
      subject: "Send the weekly digest on Monday mornings",
      snippet: "The digest goes out at 7:00 in each reader's own time zone.",
    }),
  ],
  [
    "titan-maren",
    activity("titan-maren", {
      minutes: 3.5,
      kind: "working",
      face: "working",
      subject: "Make the level editor save while you draw",
      liveStep: { words: "Drawing a test level to watch it save" },
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
  ["quillmark-orla", KAREL],
  ["tiller-pim", VIEWER],
  ["tiller-tamsin", VIEWER],
  ["beviro-rue", MILO],
  ["beviro-vesna", VIEWER],
  ["brightfold-ilo", KAREL],
  ["brightfold-brin", VIEWER],
  ["ferrow-odo", KAREL],
  ["titan-maren", VIEWER],
  ["corvel-sef", VIEWER],
  ["lanternfield-tove", KAREL],
  ["harbourline-arlo", VIEWER],
  ["marlow-wren", KAREL],
  ["hollin-idris", VIEWER],
  ["hollin-tamar", KAREL],
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
    "quillmark",
    flow({
      pullRequests: [change(4, "Sort the recipe cards by season and time", "quillmark-orla")],
      environments: new Map([
        ["quillmark-stage", row("quillmark-stage", "stage", sha("45a1c07"))],
        ["quillmark-prod", row("quillmark-prod", "production", `${sha("44b2d19")} v0.1.44 petra`)],
      ]),
      releaseOffered: true,
      releaseContents: waiting("Sort the recipe cards by season and time"),
    }),
  ],
  ["tiller", flow({})],
  [
    "beviro",
    flow({
      environments: new Map([
        ["beviro-stage", row("beviro-stage", "stage", sha("58c3e21"))],
        ["beviro-prod", row("beviro-prod", "production", `${sha("56d4f33")} v0.1.56 petra`)],
      ]),
      releaseOffered: true,
      releaseContents: waiting("Tidy the invoice footer", "Quicker gallery on slow phones"),
      releaseFailure: {
        tag: "v0.1.57",
        kind: "deploy-failed",
        at: minutesAgo(12),
        error: "The build step exited with code 2 while installing packages.",
        service: "app",
      },
    }),
  ],
  [
    "brightfold",
    flow({
      pullRequests: [
        change(2, "Add a health page with the build number and the uptime", "brightfold-brin"),
      ],
      environments: new Map([
        ["brightfold-prod", row("brightfold-prod", "production", `${sha("10e5a44")} v0.1.0 petra`)],
      ]),
    }),
  ],
  [
    "ferrow",
    flow({
      environments: new Map([["ferrow-stage", row("ferrow-stage", "stage", sha("71f6b55"))]]),
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
  [
    "corvel",
    flow({
      environments: new Map([
        ["corvel-prod", row("corvel-prod", "production", `${sha("12b8d77")} v1.2.0 petra`)],
      ]),
      releaseInFlight: "v1.2.1",
    }),
  ],
  [
    "lanternfield",
    flow({
      environments: new Map([
        [
          "lanternfield-prod",
          row("lanternfield-prod", "production", `${sha("31c9e88")} v0.3.1 karel`),
        ],
      ]),
    }),
  ],
  [
    "harbourline",
    flow({
      environments: new Map([
        // The stage's last deploy failed; what it ran before still serves.
        ["harbourline-stage", row("harbourline-stage", "stage", sha("64e0b19"), "bad")],
        [
          "harbourline-prod",
          row("harbourline-prod", "production", `${sha("61c2f08")} v1.8.2 petra`),
        ],
      ]),
    }),
  ],
  [
    "marlow",
    flow({
      environments: new Map([
        ["marlow-stage", row("marlow-stage", "stage", sha("29d7a13"))],
        ["marlow-qa", row("marlow-qa", "stage", sha("27b5c90"))],
        ["marlow-prod", row("marlow-prod", "production", `${sha("25a4e81")} v3.0.1 karel`)],
      ]),
    }),
  ],
  // No stop yet: its Mates' seats are what it shows.
  ["hollin", flow({})],
]);

/** Folded as the plan's mock draws it. */
export const PLAN_COLLAPSED: ReadonlyArray<string> = ["titan"];

/** The Mate whose conversation is open. */
export const PLAN_ACTIVE = "brightfold-brin";
