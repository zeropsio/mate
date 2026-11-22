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
 * - `remembered`: its row from HQ's last word of it, stored while it slept, its socket not open yet;
 * - `stopped`: its birth alone, its setup stopped before Zerops made its project.
 *
 * Each phase carries the menu's tree (`menuTree`) a real account would derive from HQ's word: the
 * harness seeds `menuTreeAtom` with it, so Quinn comes up from its birth as in the app.
 *
 * Fixtures only: nothing here ships, and no route imports this module.
 */
import type { ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import type { HqMate, HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId, ThreadId, ZeropsUserId } from "@t3tools/contracts";

import type { SharedBirthRow } from "~/components/zerops/SidebarComingEnds";
import { restingActivity, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import {
  MENU_LOADING,
  mateArrival,
  type MateComing,
  type MenuMate,
  type MenuTree,
} from "@t3tools/client-runtime/data";

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
  "stopped",
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
  logins: {
    "claude-code": { signedInBy: ZeropsUserId.make("u-harness"), present: true, token: false },
  },
};

function mate(
  id: string,
  bot: string,
  face: string,
  record: Partial<HqMate>,
  over: {
    readonly status?: string;
    readonly group?: CandidateRow["group"];
    /** Its container, as the platform reads it; `null` while it has none. */
    readonly service?: { readonly status: string } | null;
    /** Reachable at its origin, and connected here. */
    readonly reached?: boolean;
    readonly connected?: boolean;
    readonly creationFailed?: boolean;
  } = {},
): CandidateRow {
  const { status = "ACTIVE", group = "connected", service = { status: "ACTIVE" } } = over;
  const reached = over.reached ?? true;
  const connected = over.connected ?? group === "connected";
  return {
    key: `${id}:zcp`,
    presence: "known",
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

/** Quinn as last told, at rest while it sleeps: its first job asked, no words back yet. */
const QUINN_REMEMBERED = restingActivity(QUINN_AT_WORK);

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

const QUINN_BIRTH_ID = "birth-quinn";
const QUINN_BORN = new Date(BORN_AT).toISOString();
/** What Quinn's birth was asked to make, as HQ keeps it: a developer named Quinn, stood up. */
const QUINN_INTENT: NonNullable<MenuMate["intent"]> = {
  projectName: "Quinn",
  recipe: { kind: "none" },
  agents: ["claude-code"],
  standUp: true,
  automated: false,
  placement: { role: "dev", name: "Quinn", chief: false },
  location: null,
  userRoles: [],
};

/** Quinn's open birth as HQ's navigation sends it; its project once HQ names one. */
const quinnBirth = (projectId: string | null): NonNullable<MenuMate["birth"]> => ({
  id: QUINN_BIRTH_ID,
  face: QUINN_FACE,
  startedAt: QUINN_BORN,
  projectId,
  intent: QUINN_INTENT,
});

/** HQ's placement of a candidate's project, from its `project.hq`; a born Mate names its birth. */
function placementOf(
  candidate: CandidateRow,
  birthId?: string,
): NonNullable<MenuMate["placement"]> {
  const { id, name, created, hq } = candidate.project;
  return {
    projectId: id,
    appId: hq?.appId ?? null,
    name,
    kind: hq?.kind ?? "mate",
    mate: {
      face: hq?.mate?.face ?? "",
      madeBy: hq?.mate?.madeBy ?? null,
      standupRequestedBy: hq?.mate?.standupRequestedBy ?? null,
      ...(birthId === undefined ? { bornAt: created } : { bornAt: QUINN_BORN, birthId }),
    },
  };
}

/** A Mate HQ recorded, no birth open: keyed by its birth's id once it had one, else its project's. */
function placedMate(candidate: CandidateRow, birthId?: string): MenuMate {
  const placement = placementOf(candidate, birthId);
  return {
    kind: "mate",
    key: birthId ?? candidate.project.id,
    projectId: candidate.project.id,
    bornAt: placement.mate?.bornAt,
    birth: null,
    intent: undefined,
    placement,
  };
}

/** Quinn as the tree holds it: its birth alone, then its birth placed, then a placed Mate. */
function quinnMember(phase: ComingPhase, quinn: CandidateRow | undefined): MenuMate | undefined {
  if (phase === "pending" || phase === "stopped")
    return {
      kind: "mate",
      key: QUINN_BIRTH_ID,
      projectId: null,
      bornAt: QUINN_BORN,
      birth: quinnBirth(null),
      intent: QUINN_INTENT,
      placement: null,
    };
  if (quinn === undefined) return undefined;
  if (phase === "coming" || phase === "slow" || phase === "almost")
    return {
      kind: "mate",
      key: QUINN_BIRTH_ID,
      projectId: quinn.project.id,
      bornAt: QUINN_BORN,
      birth: quinnBirth(quinn.project.id),
      intent: QUINN_INTENT,
      placement: placementOf(quinn, QUINN_BIRTH_ID),
    };
  return placedMate(quinn, QUINN_BIRTH_ID);
}

export interface ComingMenu {
  readonly candidates: ReadonlyArray<CandidateRow>;
  readonly activity: (candidate: CandidateRow) => ZeropsAgentActivity | undefined;
  readonly coming: (candidate: CandidateRow) => MateComing | undefined;
  /** The menu's tree a real account derives from HQ's word in this phase (`menuTreeAtom`). */
  readonly tree: MenuTree;
  /** A birth's row by its id, as the menu reads it (`getBirth`): Quinn's says stopped once it did. */
  readonly getBirth: (birthId: string) => SharedBirthRow | undefined;
}

/** Quinn's birth row once its setup stopped, as `getBirth` reads it from HQ's birth. */
const QUINN_STOPPED: SharedBirthRow = {
  line: "Setup stopped while creating its project",
  attention: true,
  entries: [],
};

/** The menu with Quinn in one of its phases. */
export function comingMenu(phase: ComingPhase): ComingMenu {
  const quinn: CandidateRow | undefined = (() => {
    switch (phase) {
      case "pending":
      case "stopped":
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
        ? QUINN_REMEMBERED
        : undefined;
  const quinnInTree = quinnMember(phase, quinn);
  return {
    candidates: [FEN, ADA, ...(quinn === undefined ? [] : [quinn])],
    // Empty but for its one group (`ungrouped`, `platform`, `undrawn`, and whatever else a tree
    // with members holds as MENU_LOADING does), so the literal follows the tree's shape.
    tree: {
      ...MENU_LOADING,
      state: "known",
      groups: [
        {
          id: "acme",
          name: "Acme Docs",
          createdAt: minutesAgo(60),
          empty: false,
          hiddenEnvironments: [],
          members: [
            placedMate(FEN),
            placedMate(ADA),
            ...(quinnInTree === undefined ? [] : [quinnInTree]),
          ],
          presses: [],
        },
      ],
    },
    activity: (candidate) =>
      candidate.project.id === "acme-fen"
        ? FEN_WORDS
        : candidate.project.id === "acme-ada"
          ? ADA_WORDS
          : candidate.project.id === "acme-quinn"
            ? quinnWords
            : undefined,
    getBirth: (birthId) =>
      phase === "stopped" && birthId === QUINN_BIRTH_ID ? QUINN_STOPPED : undefined,
    coming: (candidate) => {
      const held = births.find((entry) => entry.projectId === candidate.project.id);
      return mateArrival({
        press: held === undefined ? undefined : { startedAt: held.startedAt, container: true },
        candidate,
      }).coming;
    },
  };
}
