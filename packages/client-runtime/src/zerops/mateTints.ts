/**
 * Which colour each Mate wears.
 *
 * A Mate is somebody, and a menu of six of them should read as six people
 * rather than six copies of the logo — so each gets one of the eight tints in
 * `MATE_TINTS` (shared/brand.ts). A Mate whose person picked its face when
 * they made it (HQ's record, `groups.ts`) wears the tint they picked. Every
 * other Mate's is deterministic from the name, so a Mate keeps its colour
 * across reloads and across the places it appears: the left menu and the
 * projects screen both derive from the same account-wide list and so agree.
 * The derived names share their tints among themselves alone: a pick never
 * recolours anybody else, and a Mate that picked a tint another wears is told
 * apart by its shape. Two derived names that hash to one tint are told apart
 * by walking to the next free one, in name order so the result does not depend
 * on the order the API listed the projects in. Past eight Mates the tints
 * repeat, which is what a palette of eight means.
 *
 * @module mateTints
 */

import {
  MATE_SHAPE_OF_TINT,
  MATE_TINT_IDS,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";

import { assignMateTints, preferredMateTint } from "@t3tools/shared/mateFaces";

import type { ZeropsCandidate } from "./candidates.ts";
import { projectNameInApp, readZeropsMembership } from "./groups.ts";
import { selectMateEnvironments } from "./mateEnvironments.ts";

export { assignMateTints, preferredMateTint } from "@t3tools/shared/mateFaces";

/**
 * The account's Mates, each with its tint, keyed by the project it lives in.
 * Membership is `selectMateEnvironments` — the project has a Mate container —
 * and the name is its project's in Zerops under its application (`projectNameInApp`), what the menu
 * calls the row.
 * A Mate that picked its tint wears it. The rest share the tints their names
 * give them among themselves alone, exactly as before any Mate could pick: a
 * pick — even of a tint another Mate wears — never recolours anybody else. Two
 * Mates may then wear one tint, which their shapes tell apart. A Mate that
 * wore its name's tint and then had its face changed keeps its name among them
 * (`named`): it wears its pick, and the tint its name held stays held, so the
 * change moves nobody else along.
 */
export function assignCandidateMateTints(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, MateTintId> {
  const mates = selectMateEnvironments(candidates);
  const byProject = new Map<string, MateTintId>();
  const nameByProject = new Map<string, string>();
  for (const mate of mates) {
    const tags = readZeropsMembership(mate.project);
    const picked = tags.face?.tint;
    if (picked !== undefined) byProject.set(mate.project.id, picked);
    if (picked !== undefined && tags.face?.named !== true) continue;
    nameByProject.set(mate.project.id, projectNameInApp(mate.project));
  }
  const byName = assignMateTints([...nameByProject.values()]);
  for (const [projectId, name] of nameByProject) {
    const tint = byName.get(name);
    if (tint !== undefined && !byProject.has(projectId)) byProject.set(projectId, tint);
  }
  return byProject;
}

/**
 * The tint a new Mate called `name` is offered first: its own, walking past
 * every tint a Mate on the account already wears, the way a clash always
 * walks. So adding a Mate never recolours another — a name that sorts first
 * would otherwise take a tint it hashes to from a Mate that has worn it all
 * along. Past eight Mates it is the name's own again.
 */
export function newMateTint(candidates: ReadonlyArray<ZeropsCandidate>, name: string): MateTintId {
  const worn = new Set(assignCandidateMateTints(candidates).values());
  const count = MATE_TINT_IDS.length;
  let index = MATE_TINT_IDS.indexOf(preferredMateTint(name));
  if (worn.size < count) {
    while (worn.has(MATE_TINT_IDS[index]!)) index = (index + 1) % count;
  }
  return MATE_TINT_IDS[index]!;
}

/**
 * The shape a Mate wears: the one its person picked (its face in HQ), else its
 * tint's own (`MATE_SHAPE_OF_TINT`) — which is every Mate's shape from before
 * a face could be picked.
 */
export function mateShapeOf(
  project: Parameters<typeof readZeropsMembership>[0],
  tint: MateTintId,
): MateShapeId {
  return readZeropsMembership(project).face?.shape ?? MATE_SHAPE_OF_TINT[tint];
}
