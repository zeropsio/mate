/**
 * The lane bar under a crewmate's header (PRD §4.5, §5.2, §5.7): its copy of
 * the code against your tree — the branch, how far ahead, its change, its
 * check — what that copy needs said, its own app on its crew port, and the
 * presses: *Ask … to resolve / fix*, *Show on dev*, *Land*.
 *
 * Every press maps to one `CrewCommand`, or — for what only the Mate can do,
 * *Commit my edit* — to the ask it confirms; a person-started Show on dev has
 * no command yet, so it is not offered. `null` for a crewmate without a copy —
 * a reader or the lead.
 *
 * Pure: no clock, no I/O. Every word comes from the crew phrases.
 */
import type { CrewmateView } from "@t3tools/client-runtime/zerops/projections/crew";
import {
  CREW_ATTENTION_VERBS,
  CREW_LANE_VERBS,
  crewAheadWord,
  crewAppWord,
  crewAskToFixWord,
  crewAskToResolveWord,
  crewAttentionSentence,
  crewCheckWord,
  crewCommitEditAsk,
  crewConflictWord,
  crewDiffStatWord,
  crewLandedAsWord,
  crewLaneWord,
  crewTaskWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewCheck, CrewSnapshot } from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

export interface CrewLaneBarModel {
  /** `crew/<handle>`. */
  readonly branch: string;
  /** "3 changes ahead of your tree"; `null` while level with it. */
  readonly ahead: string | null;
  /** "+214 −12"; `null` while level with your tree. */
  readonly diffStat: string | null;
  readonly check: {
    readonly word: string;
    readonly tone: ServiceStatusToneId;
    readonly pulse: boolean;
  } | null;
  /** What the copy's state needs said, or its last landing while level with your tree. */
  readonly note: { readonly text: string; readonly tone: "muted" | "attention" | "failed" } | null;
  /** One turn as you, back to the crewmate: a merge-in conflict or a failed check. */
  readonly ask: {
    readonly kind: "askResolve" | "askFix";
    readonly taskId: string;
    readonly label: string;
  } | null;
  readonly app:
    | { readonly kind: "running"; readonly label: string; readonly url: string | null }
    | { readonly kind: "stopped"; readonly label: string }
    | { readonly kind: "no-crew-ports"; readonly label: string; readonly host: string }
    | { readonly kind: "no-free-port"; readonly label: string }
    | null;
  /**
   * *Commit my edit*: its landing waits on your tree, so the Mate is asked to
   * commit your edit there; `what` is the waiting's sentence the ask confirms.
   */
  readonly commitEdit: {
    readonly label: string;
    readonly ask: string;
    readonly what: string;
  } | null;
  readonly showOnDev: {
    readonly kind: "claimGrant" | "claimRelease";
    readonly host: string;
    readonly label: string;
  } | null;
  /** The blue Pill: *Land* on a ready task, *Land now* on work never reported. */
  readonly land: {
    readonly kind: "land" | "landNow";
    readonly taskId: string | null;
    readonly label: string;
    readonly enabled: boolean;
  };
}

/** The dot a check's word wears; the word is `crewCheckWord`'s. */
const CHECK_TONE: Readonly<Record<CrewCheck["state"], ServiceStatusToneId>> = {
  running: "busy",
  passed: "ok",
  failed: "failed",
};

export function crewLaneBarModel(
  snapshot: Pick<CrewSnapshot, "hosts" | "board" | "attention" | "crewmates">,
  row: Pick<CrewmateView, "crewmate" | "openTask" | "working">,
): CrewLaneBarModel | null {
  const { crewmate, openTask } = row;
  const lane = crewmate.lane;
  if (lane === null) return null;
  const host = snapshot.hosts.find((candidate) => candidate.host === crewmate.host);
  const ahead = lane.ahead === 0 ? null : lane.ahead;

  const note = ((): CrewLaneBarModel["note"] => {
    switch (lane.state) {
      case "creating":
      case "setting-up":
      case "frozen":
        return { text: crewLaneWord(lane) ?? "", tone: "muted" };
      case "missing":
      case "failed":
        return { text: crewLaneWord(lane) ?? "", tone: "failed" };
      case "conflicts": {
        const conflict = snapshot.attention.find(
          (item) => item.kind === "conflict" && item.handle === crewmate.handle,
        );
        return { text: crewConflictWord(conflict?.paths ?? []), tone: "attention" };
      }
      case "ready":
        break;
    }
    if (openTask?.state === "waiting-on-you") {
      return {
        text: crewTaskWord(openTask, {
          tasks: snapshot.board.tasks,
          hasLead: false,
          threadStatusWord: "",
        }),
        tone: "attention",
      };
    }
    if (openTask !== null || ahead !== null) return null;
    const landed = snapshot.board.tasks
      .filter((task) => task.owner === crewmate.handle && task.landedCommit !== null)
      .toSorted((left, right) => right.number - left.number)[0];
    return landed?.landedCommit == null
      ? null
      : {
          text: crewLandedAsWord({ number: landed.number, landedCommit: landed.landedCommit }),
          tone: "muted",
        };
  })();

  const ask: CrewLaneBarModel["ask"] =
    openTask === null
      ? null
      : lane.state === "conflicts"
        ? {
            kind: "askResolve",
            taskId: openTask.id,
            label: crewAskToResolveWord(crewmate.displayName),
          }
        : lane.check?.state === "failed"
          ? {
              kind: "askFix",
              taskId: openTask.id,
              label: crewAskToFixWord(crewmate.displayName),
            }
          : null;

  const app = ((): CrewLaneBarModel["app"] => {
    if (crewmate.host === null) return null;
    if (host === undefined || host.crewPorts.length === 0) {
      const where = { kind: "no-crew-ports", host: crewmate.host } as const;
      return { ...where, label: crewAppWord(where) };
    }
    if (crewmate.app === null) return null;
    if (crewmate.app.port === null) {
      return { kind: "no-free-port", label: crewAppWord({ kind: "no-free-port" }) };
    }
    switch (crewmate.app.state) {
      case "running":
        return {
          kind: "running",
          label: crewAppWord({ kind: "running", port: crewmate.app.port }),
          url: crewmate.app.url,
        };
      case "stopped":
        return { kind: "stopped", label: crewAppWord({ kind: "stopped" }) };
      case "none":
        return null;
    }
  })();

  const landingWait = snapshot.attention.find(
    (item) => item.kind === "landing-wait" && item.handle === crewmate.handle,
  );
  const commitEdit: CrewLaneBarModel["commitEdit"] =
    landingWait === undefined || landingWait.paths.length === 0
      ? null
      : {
          label: CREW_ATTENTION_VERBS.commitEdit,
          ask: crewCommitEditAsk(landingWait.paths),
          what: crewAttentionSentence(landingWait, snapshot),
        };

  const claim = host?.claim;
  const showOnDev: CrewLaneBarModel["showOnDev"] =
    host === undefined || claim?.handle !== crewmate.handle
      ? null
      : claim.state === "requested"
        ? { kind: "claimGrant", host: host.host, label: CREW_LANE_VERBS.showOnDev }
        : claim.state === "starting" || claim.state === "held"
          ? { kind: "claimRelease", host: host.host, label: CREW_LANE_VERBS.backToTree }
          : null;

  const taskId = openTask?.id ?? null;
  const land: CrewLaneBarModel["land"] =
    openTask?.state === "ready"
      ? { kind: "land", taskId, label: CREW_ATTENTION_VERBS.land, enabled: true }
      : (openTask?.state === "working" || openTask?.state === "rework") &&
          !row.working &&
          ahead !== null
        ? { kind: "landNow", taskId, label: CREW_LANE_VERBS.landNow, enabled: true }
        : { kind: "land", taskId, label: CREW_ATTENTION_VERBS.land, enabled: false };

  return {
    branch: lane.branch,
    ahead: crewAheadWord(lane.ahead),
    diffStat: ahead === null ? null : crewDiffStatWord(lane),
    check:
      lane.check === null
        ? null
        : {
            word: crewCheckWord(lane.check),
            tone: CHECK_TONE[lane.check.state],
            pulse: lane.check.state === "running",
          },
    note,
    ask,
    app,
    commitEdit,
    showOnDev,
    land,
  };
}
