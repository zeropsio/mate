/**
 * The menu's rows: every row HQ places, as HQ places it, then every project only Zerops lists so
 * far — a project created a moment ago anywhere, ungrouped until somebody places it. A row never
 * waits on HQ; a project its owner proved deleted is drawn no more.
 */
import type {
  HqNavigationRead,
  HqVerdict,
  OrganizationProjects,
} from "@t3tools/client-runtime/data";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";

export function menuRows<Row extends CandidateRow>(input: {
  /** HQ's rows, each with where HQ places its project (`placedMenuRows`). */
  readonly placed: ReadonlyArray<Row | CandidateRow>;
  /** The organization's listing, where nothing places a project yet. */
  readonly candidates: ReadonlyArray<Row>;
  /** Projects their owner proved deleted. */
  readonly gone: ReadonlySet<string>;
}): ReadonlyArray<Row | CandidateRow> {
  const placed = new Set(input.placed.map((row) => row.project.id));
  return [
    ...input.placed,
    ...input.candidates.filter(
      (row) => !placed.has(row.project.id) && !input.gone.has(row.project.id),
    ),
  ];
}

/**
 * Whether the menu may draw its rows: each source it draws them from answered, or stopped
 * answering. The project listing holds each project's name, state and creation — what the one
 * order is decided over — so nothing is drawn before its baseline. HQ places the rows in their
 * applications: the menu waits until the account decided whether the organization has an official
 * HQ, and for an official one until its navigation is read or refused. A source whose first read
 * failed is retried within a second, so the menu holds on until it answers; only once the wait
 * ran out (`waitedOut`) does one still catching up count as stopped answering, and the rows stand
 * without it — names alone, not ordered on a guess and taken back a moment later; an HQ slow on a
 * connection that holds stands so past the wait too, while it works on. HQ read, the menu
 * waits too for each Mate's last words HQ relays (`matesAnswered`), so a row paints with its time
 * and its words; past the wait, a row whose words are late paints without them, and they follow.
 */
export function menuSourcesSettled(input: {
  readonly projects: Pick<OrganizationProjects, "read" | "reconnecting" | "unavailableReason">;
  readonly hq: Pick<HqNavigationRead, "read" | "refusal" | "capped" | "reconnecting" | "slow">;
  readonly verdict: HqVerdict;
  /** HQ answered for every Mate it places: each one's last words (`hqMatesAnswered`). */
  readonly matesAnswered: boolean;
  /** The menu waited its patience (`MENU_SOURCES_PATIENCE_MS`) for its sources' first answers. */
  readonly waitedOut: boolean;
}): boolean {
  const { projects, hq, waitedOut } = input;
  const listed =
    projects.read === "read" ||
    projects.unavailableReason !== undefined ||
    (waitedOut && projects.reconnecting);
  const hqAnswered =
    (hq.read === "read" && (input.matesAnswered || waitedOut)) ||
    hq.refusal !== null ||
    hq.capped ||
    (waitedOut && (hq.reconnecting || hq.slow));
  return listed && input.verdict === "official" && hqAnswered;
}
