/**
 * The left menu while a new Mate comes up (`design.html?set=coming`): one project, Acme Docs, with
 * Fen resting, Ada at work and Quinn — the Mate just added — in each of its first minutes, and
 * after. `window.__comingMenu.go(phase)` moves Quinn on from a script, so a per-frame sampler can
 * watch its row hand over from coming up to up, and on to its first job.
 *
 * - `pending`: its birth alone, before the listing holds its project;
 * - `coming`, `almost`, `slow`: listed, its birth's words;
 * - `failed`: the platform refused its creation;
 * - `ready`: up, nobody has signed in yet;
 * - `working`: at its first job;
 * - `blinking`: at work while its socket reconnects — its face still works;
 * - `remembered`: its row from HQ's last word of it, stored while it slept, its socket not open yet.
 *
 * Fixtures only: nothing here ships, and no route imports this module.
 */
import type { ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqMate, HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";

import { overviewAgentActivity, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { mateArrival, type MateComing } from "@t3tools/client-runtime/data";

export const COMING_PHASES = [
  "pending",
  "coming",
  "almost",
  "slow",
  "failed",
  "ready",
  "working",
  "blinking",
  "remembered",
] as const;

export type ComingPhase = (typeof COMING_PHASES)[number];

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A Mate of Acme Docs as HQ places it, wearing `face`, its record saying `record` too. */
const acme = (face: string, record: Partial<HqMate>): HqPlacement => ({
  appId: "acme",
  appName: "Acme Docs",
  kind: "mate",
  mate: { face, ...record },
});
/** Signed in by the harness's person, as HQ's overview of the Mate names them. */
const SIGNED: Partial<HqMate> = {
  logins: { "claude-code": { signedInBy: "u-harness", present: true, token: false } },
};

function mate(
  id: string,
  bot: string,
  face: string,
  record: Partial<HqMate>,
  over: {
    readonly status?: string;
    readonly group?: ZeropsCandidate["group"];
    /** Its container, as the platform reads it; `null` while it has none. */
    readonly service?: { readonly status: string } | null;
    /** Reachable at its origin, and connected here. */
    readonly reached?: boolean;
    readonly connected?: boolean;
    readonly creationFailed?: boolean;
  } = {},
): ZeropsCandidate {
  const { status = "ACTIVE", group = "connected", service = { status: "ACTIVE" } } = over;
  const reached = over.reached ?? true;
  const connected = over.connected ?? group === "connected";
  return {
    key: `${id}:zcp`,
    project: {
      id,
      name: bot,
      status,
      // Made minutes ago: an unsigned one is still arriving (`mateArrivingUntil`).
      created: minutesAgo(3),
      tagList: ["mate"],
      hq: acme(face, record),
    },
    group,
    ...(service === null ? {} : { service: { id: "zcp", name: "zcp", status: service.status } }),
    ...(reached ? { containerOrigin: `https://zcp-${id}.example.test` } : {}),
    ...(connected ? { environmentId: EnvironmentId.make(`env-${id}`) } : {}),
    ...(over.creationFailed === true ? { creationFailed: { message: undefined } } : {}),
  };
}

const FEN = mate("acme-fen", "Fen", "olive:clover", SIGNED);
const ADA = mate("acme-ada", "Ada", "sky:flower", SIGNED);
const QUINN_FACE = "coral:gem";
/** Its stand-up asked by the harness's person, as HQ's birth record names them. */
const QUINN_ASKED: Partial<HqMate> = { standupRequestedBy: "u-harness" };

const words = (
  id: string,
  over: Partial<ZeropsAgentActivity> & Pick<ZeropsAgentActivity, "kind" | "face">,
): ZeropsAgentActivity => ({
  threadId: ThreadId.make(`thread-${id}`),
  status: null,
  subject: undefined,
  at: minutesAgo(12),
  snippet: undefined,
  unread: false,
  pausedUntil: undefined,
  threadKey: `env-${id}:thread-${id}`,
  task: undefined,
  ...over,
});

const FEN_WORDS = words("acme-fen", {
  kind: "idle",
  face: "idle",
  subject: "Tidy up the docs index",
  task: "Tidy up the docs index",
  snippet: "The index lists every page now, newest first.",
});
const ADA_WORDS = words("acme-ada", {
  kind: "working",
  face: "working",
  subject: "Add search to the docs",
  task: "Add search to the docs",
  awaitingWords: true,
  at: minutesAgo(3),
  liveStep: { words: "Build the search index" },
});
const QUINN_AT_WORK = words("acme-quinn", {
  kind: "working",
  face: "working",
  subject: "Stand up development of the project.",
  task: "Stand up development of the project.",
  awaitingWords: true,
  at: minutesAgo(1),
  liveStep: { words: "Setting up the project" },
});

/** Quinn as HQ last told it, stored while it slept: its first job asked, no words back yet. */
const QUINN_STORED = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: false, since: minutesAgo(1), overview: "stored" },
  identity: { environmentId: "env-acme-quinn", serverVersion: "0.11.90", update: null },
  main: {
    id: "thread-acme-quinn",
    title: "Stand up development of the project.",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "running", lastError: null },
    latestTurn: {
      turnId: "turn-acme-quinn",
      state: "running",
      requestedAt: minutesAgo(1),
      startedAt: minutesAgo(1),
      completedAt: null,
    },
    latestUserMessageAt: minutesAgo(1),
    updatedAt: minutesAgo(1),
    latestUserMessagePreview: { text: "Stand up development of the project." },
    latestMessagePreview: { role: "user", text: "Stand up development of the project." },
    planProgress: null,
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
  },
});

const BORN_AT = Date.now() - 90_000;

/** Quinn's birth, as this browser holds it. */
function birth(over: Partial<ZeropsPlacedBirth> = {}): ZeropsPlacedBirth {
  return {
    projectId: "acme-quinn",
    startedAt: BORN_AT,
    placement: {
      groupId: "acme",
      groupName: "Acme Docs",
      kind: "mate",
      displayName: "Quinn",
      face: { tint: "coral", shape: "gem" },
    },
    ...over,
  };
}

export interface ComingMenu {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly births: ReadonlyArray<ZeropsPlacedBirth>;
  readonly activity: (candidate: ZeropsCandidate) => ZeropsAgentActivity | undefined;
  readonly coming: (candidate: ZeropsCandidate) => MateComing | undefined;
}

/** The menu with Quinn in one of its phases. */
export function comingMenu(phase: ComingPhase): ComingMenu {
  const quinn: ZeropsCandidate | undefined = (() => {
    switch (phase) {
      case "pending":
        return undefined;
      case "coming":
      case "slow":
        return mate("acme-quinn", "Quinn", QUINN_FACE, QUINN_ASKED, {
          group: "provisioning",
          service: { status: "CREATING" },
          reached: false,
        });
      case "failed":
        return mate("acme-quinn", "Quinn", QUINN_FACE, QUINN_ASKED, {
          status: "NEW",
          group: "unavailable",
          service: null,
          reached: false,
          creationFailed: true,
        });
      case "almost":
      case "blinking":
      case "remembered":
        return mate(
          "acme-quinn",
          "Quinn",
          QUINN_FACE,
          { ...QUINN_ASKED, ...(phase === "almost" ? {} : SIGNED) },
          { group: "ready" },
        );
      case "ready":
        return mate("acme-quinn", "Quinn", QUINN_FACE, QUINN_ASKED);
      case "working":
        return mate("acme-quinn", "Quinn", QUINN_FACE, { ...QUINN_ASKED, ...SIGNED });
    }
  })();
  const births: ReadonlyArray<ZeropsPlacedBirth> =
    phase === "pending" || phase === "coming" || phase === "slow" || phase === "almost"
      ? [birth()]
      : [];
  const quinnWords =
    phase === "working" || phase === "blinking"
      ? QUINN_AT_WORK
      : phase === "remembered"
        ? overviewAgentActivity(QUINN_STORED, false, {})
        : undefined;
  return {
    candidates: [FEN, ADA, ...(quinn === undefined ? [] : [quinn])],
    births,
    activity: (candidate) =>
      candidate.project.id === "acme-fen"
        ? FEN_WORDS
        : candidate.project.id === "acme-ada"
          ? ADA_WORDS
          : candidate.project.id === "acme-quinn"
            ? quinnWords
            : undefined,
    coming: (candidate) => {
      const held = births.find((entry) => entry.projectId === candidate.project.id);
      return mateArrival({
        press: held === undefined ? undefined : { startedAt: held.startedAt, container: true },
        candidate,
      }).coming;
    },
  };
}
