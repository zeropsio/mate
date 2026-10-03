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
 * - `remembered`: its row from this browser's memory, its socket not open yet.
 *
 * Fixtures only: nothing here ships, and no route imports this module.
 */
import type { ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { mateComing, type MateComing } from "~/zerops/mateComing";
import { activityFromMemory } from "~/zerops/menuMemory";

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

const ACME = ["mate", "mate:g:acme", "mate:name:Acme Docs", "mate:role:dev"];
const SIGNED = "mate:signer:claude-code:u-harness";

function mate(
  id: string,
  bot: string,
  tags: ReadonlyArray<string>,
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
      name: `Acme Docs - ${bot}`,
      status,
      // Made minutes ago: an unsigned one is still arriving (`mateArrivingUntil`).
      created: minutesAgo(3),
      tagList: [...ACME, `mate:bot:${bot}`, ...tags],
    },
    group,
    ...(service === null ? {} : { service: { id: "zcp", name: "zcp", status: service.status } }),
    ...(reached ? { containerOrigin: `https://zcp-${id}.example.test` } : {}),
    ...(connected ? { environmentId: EnvironmentId.make(`env-${id}`) } : {}),
    ...(over.creationFailed === true ? { creationFailed: { message: undefined } } : {}),
  };
}

const FEN = mate("acme-fen", "Fen", [SIGNED, "mate:face:olive:clover"]);
const ADA = mate("acme-ada", "Ada", [SIGNED, "mate:face:sky:flower"]);
const QUINN_TAGS = ["mate:face:coral:gem", "mate:standup:u-harness"];

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
  liveStep: { words: "Build the search index", code: "pnpm build:search" },
});
const QUINN_AT_WORK = words("acme-quinn", {
  kind: "working",
  face: "working",
  subject: "Stand up development of the project.",
  task: "Stand up development of the project.",
  awaitingWords: true,
  at: minutesAgo(1),
  liveStep: { words: "Setting up the project", code: undefined },
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
      displayName: "Acme Docs - Quinn",
      botName: "Quinn",
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
        return mate("acme-quinn", "Quinn", QUINN_TAGS, {
          group: "provisioning",
          service: { status: "CREATING" },
          reached: false,
        });
      case "failed":
        return mate("acme-quinn", "Quinn", QUINN_TAGS, {
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
          [...QUINN_TAGS, ...(phase === "almost" ? [] : [SIGNED])],
          { group: "ready" },
        );
      case "ready":
        return mate("acme-quinn", "Quinn", QUINN_TAGS);
      case "working":
        return mate("acme-quinn", "Quinn", [...QUINN_TAGS, SIGNED]);
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
        ? activityFromMemory({
            subject: "Stand up development of the project.",
            task: "Stand up development of the project.",
            awaitingWords: true,
            at: minutesAgo(1),
            unread: false,
            threadId: "thread-acme-quinn",
            threadKey: "env-acme-quinn:thread-acme-quinn",
          })
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
      return mateComing({
        press: held === undefined ? undefined : { startedAt: held.startedAt, container: true },
        candidate,
      });
    },
  };
}
