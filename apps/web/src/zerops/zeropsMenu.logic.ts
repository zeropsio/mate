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
 * HQ, and for an official one while its link reads its navigation for the first time, until it is
 * read, refused or catching up after a failed attempt. Until then the menu says it is loading,
 * never a row placed or ordered on a guess.
 */
export function menuSourcesSettled(input: {
  readonly projects: Pick<OrganizationProjects, "read" | "reconnecting" | "unavailableReason">;
  readonly hq: Pick<HqNavigationRead, "read" | "refusal" | "capped" | "reconnecting">;
  readonly verdict: HqVerdict;
}): boolean {
  const { projects, hq } = input;
  const listed =
    projects.read === "read" || projects.reconnecting || projects.unavailableReason !== undefined;
  const hqReading = hq.read !== "read" && hq.refusal === null && !hq.capped && !hq.reconnecting;
  const placed =
    input.verdict === "none" ||
    input.verdict === "unreadable" ||
    (input.verdict === "official" && !hqReading);
  return listed && placed;
}
