import {
  reachabilityPhrase,
  type ContainerReachability,
  type Reachability,
} from "@t3tools/client-runtime/zerops/environments";
import {
  mateOnlyOwnerOpensIt,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";

import type { MobileCandidate } from "./candidate-listing";

/** Where the picker lists a row: by what it offers now. */
export type CandidateSection = "connected" | "ready" | "waiting" | "unavailable";

export const CANDIDATE_SECTIONS: ReadonlyArray<CandidateSection> = [
  "connected",
  "ready",
  "waiting",
  "unavailable",
];

export const CANDIDATE_SECTION_LABELS: Record<CandidateSection, string> = {
  connected: "Connected",
  ready: "Ready",
  waiting: "Coming up",
  unavailable: "Unavailable",
};

type Tone = "ok" | "busy" | "attention" | "off";

export interface ZeropsCandidatePresentation {
  readonly label: string;
  readonly tone: Tone;
  /** The status dot pulses while the row waits on something that is on its way. */
  readonly pulsing: boolean;
  readonly action: string | null;
  /** One line in place of the verb, when there is no verb to offer. */
  readonly notice?: string;
  readonly section: CandidateSection;
}

const MATE_NAME = "This Mate";

/** The container levels that are a verdict of their own, in the row's words. */
const CONTAINER_STATUS: Record<
  ContainerReachability["level"],
  { readonly label: string; readonly waiting: boolean }
> = {
  creating: { label: "Starting", waiting: true },
  provisioning: { label: "Starting", waiting: true },
  booting: { label: "Starting", waiting: true },
  restarting: { label: "Restarting", waiting: true },
  updating: { label: "Updating", waiting: true },
  "needs-enable": { label: "Unavailable", waiting: false },
  "needs-update": { label: "Unavailable", waiting: false },
  "not-yet-available": { label: "Unavailable", waiting: false },
  inactive: { label: "Not running", waiting: false },
};

/** The verdict's cause, as the reachability copy words it (§4.4). */
const phraseOf = (verdict: Reachability, nowMs: number): string | undefined =>
  reachabilityPhrase(verdict, { nowMs, mateName: MATE_NAME }).text ?? undefined;

const withNotice = (
  presentation: Omit<ZeropsCandidatePresentation, "notice">,
  notice: string | undefined,
): ZeropsCandidatePresentation =>
  notice === undefined ? presentation : { ...presentation, notice };

const CHECKING: ZeropsCandidatePresentation = {
  label: "Checking",
  tone: "attention",
  pulsing: true,
  action: null,
  section: "waiting",
};

/** A ready Mate's row, by where the account's machine has it (§4.4). */
function mateState(candidate: MobileCandidate, nowMs: number): ZeropsCandidatePresentation {
  if (candidate.connectable) {
    return { label: "Ready", tone: "busy", pulsing: false, action: "Connect", section: "ready" };
  }
  const verdict = candidate.reachability;
  if (verdict === null) return CHECKING;
  const notice = phraseOf(verdict, nowMs);
  switch (verdict.kind) {
    case "connecting":
    case "resolving":
    case "reconnecting":
    case "waiting-for-zerops":
      return withNotice(
        { label: "Connecting", tone: "attention", pulsing: true, action: null, section: "waiting" },
        notice,
      );
    case "retrying":
      return withNotice(
        {
          label: "Connecting",
          tone: "attention",
          pulsing: false,
          action: "Try now",
          section: "waiting",
        },
        notice,
      );
    case "refused-configuration":
      return withNotice(
        {
          label: "Unavailable",
          tone: "off",
          pulsing: false,
          action: "Try now",
          section: "unavailable",
        },
        notice,
      );
    case "ready":
      return withNotice(
        { label: "Connected", tone: "ok", pulsing: false, action: "Open", section: "connected" },
        notice,
      );
    case "container":
    case "gone":
    case "replaced":
    case "refused-role":
    case "update-required":
    case "update-unavailable":
    case "no-address":
      return withNotice(
        {
          label: "Unavailable",
          tone: "off",
          pulsing: false,
          action: null,
          section: "unavailable",
        },
        notice,
      );
  }
}

function stateOf(candidate: MobileCandidate, nowMs: number): ZeropsCandidatePresentation {
  // The inventory has not read whether a container is there: nothing negative is said of it.
  if (candidate.presence === "unknown") {
    return { label: "Checking", tone: "off", pulsing: true, action: null, section: "waiting" };
  }
  const verdict = candidate.reachability;
  if (candidate.group === "connected") {
    // A live link keeps showing that the container restarts or updates under it (§4.4 row 5).
    return withNotice(
      { label: "Connected", tone: "ok", pulsing: false, action: "Open", section: "connected" },
      verdict === null ? undefined : phraseOf(verdict, nowMs),
    );
  }
  // The container's verdict outranks the platform's statuses and any probe's silence.
  if (candidate.service !== undefined && verdict?.kind === "container") {
    const { container } = verdict;
    const status = CONTAINER_STATUS[container.level];
    const overdue = "overdue" in container && container.overdue;
    return withNotice(
      {
        label: status.label,
        tone: status.waiting ? "attention" : "off",
        pulsing: status.waiting && !overdue,
        action: null,
        section: status.waiting ? "waiting" : "unavailable",
      },
      phraseOf(verdict, nowMs),
    );
  }
  switch (candidate.group) {
    case "ready":
      return mateState(candidate, nowMs);
    case "provisioning":
      return withNotice(
        { label: "Starting", tone: "attention", pulsing: true, action: null, section: "waiting" },
        candidate.reason,
      );
    case "unavailable":
      return withNotice(
        { label: "Unavailable", tone: "off", pulsing: false, action: null, section: "unavailable" },
        candidate.reason,
      );
  }
}

/**
 * What a row says and offers.
 *
 * Whose Mate it is outranks whatever its container is doing (D5): a person who
 * cannot open it is not waiting for it to start, and "Ready · Connect" would
 * be an invitation the door refuses. So a `listed` Mate keeps its place in the
 * list and says whose it is instead.
 */
export function zeropsCandidatePresentation(
  candidate: MobileCandidate,
  /** The moment a retry's countdown is worded at. */
  nowMs: number,
  options: {
    readonly visibility?: RoleMateVisibility | undefined;
    readonly ownerName?: string | undefined;
  } = {},
): ZeropsCandidatePresentation {
  const state = stateOf(candidate, nowMs);
  if (options.visibility === "listed") {
    return {
      label: "Not yours",
      tone: "off",
      pulsing: false,
      action: null,
      notice: mateOnlyOwnerOpensIt(options.ownerName),
      section: state.section,
    };
  }
  return state;
}
