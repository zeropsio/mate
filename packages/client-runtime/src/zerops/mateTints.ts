/**
 * Which colour each Mate wears.
 *
 * A Mate is somebody, and a menu of six of them should read as six people
 * rather than six copies of the logo — so each gets one of the eight tints in
 * `MATE_TINTS` (shared/brand.ts). A Mate whose person picked its face when
 * they made it (`mate:face:`, `groups.ts`) wears the tint they picked. Every
 * other Mate's is deterministic from the name, so a Mate keeps its colour
 * across reloads and across the places it appears: the left menu and the
 * projects screen both derive from the same account-wide list and so agree.
 * A derived name walks past the picked tints, and two names that hash to one
 * tint are told apart by walking to the next free one, in name order so the
 * result does not depend on the order the API listed the projects in. Past
 * eight Mates the tints repeat, which is what a palette of eight means.
 *
 * @module mateTints
 */

import {
  MATE_SHAPE_OF_TINT,
  MATE_TINT_IDS,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";

import { botDisplayName } from "./bots.ts";
import type { ZeropsCandidate } from "./candidates.ts";
import { readZeropsGroupTags } from "./groups.ts";
import { selectMateEnvironments } from "./mateEnvironments.ts";

/** FNV-1a over the name's code units — small, stable, and even over eight buckets. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/** The tint a name asks for on its own, before any clash is resolved. */
export function preferredMateTint(name: string): MateTintId {
  return MATE_TINT_IDS[hashName(normalize(name)) % MATE_TINT_IDS.length]!;
}

/**
 * One tint per distinct name (case-insensitively), walking past `reserved` —
 * the tints Mates picked for themselves — as it walks past each other. Blank
 * names get nothing.
 */
export function assignMateTints(
  names: ReadonlyArray<string>,
  reserved: ReadonlyArray<MateTintId> = [],
): ReadonlyMap<string, MateTintId> {
  // The first spelling of a name wins; a later "fen" is the same Mate as "Fen".
  const seen = new Set<string>();
  const distinct = names
    .filter((name) => {
      const key = normalize(name);
      if (key.length === 0 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => normalize(left).localeCompare(normalize(right), "en"));
  const count = MATE_TINT_IDS.length;
  const taken = new Set(reserved.map((tint) => MATE_TINT_IDS.indexOf(tint)));
  const tints = new Map<string, MateTintId>();
  for (const name of distinct) {
    let index = hashName(normalize(name)) % count;
    if (taken.size < count) {
      while (taken.has(index)) index = (index + 1) % count;
    }
    taken.add(index);
    tints.set(name, MATE_TINT_IDS[index]!);
  }
  return tints;
}

/**
 * The account's Mates, each with its tint, keyed by the project it lives in.
 * Membership is `selectMateEnvironments` — the project has a Mate container —
 * and the name is what the menu calls the row (`botDisplayName`), so a Mate
 * named by its project falls back the same way everywhere. A Mate that picked
 * its tint wears it; the rest are derived around those.
 */
export function assignCandidateMateTints(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, MateTintId> {
  const mates = selectMateEnvironments(candidates);
  const byProject = new Map<string, MateTintId>();
  const nameByProject = new Map<string, string>();
  for (const mate of mates) {
    const tags = readZeropsGroupTags(mate.project.tagList);
    const picked = tags.face?.tint;
    if (picked !== undefined) {
      byProject.set(mate.project.id, picked);
      continue;
    }
    nameByProject.set(
      mate.project.id,
      botDisplayName({ bot: tags.bot, projectName: mate.project.name }),
    );
  }
  const byName = assignMateTints([...nameByProject.values()], [...byProject.values()]);
  for (const [projectId, name] of nameByProject) {
    const tint = byName.get(name);
    if (tint !== undefined) byProject.set(projectId, tint);
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
  let index = hashName(normalize(name)) % count;
  if (worn.size < count) {
    while (worn.has(MATE_TINT_IDS[index]!)) index = (index + 1) % count;
  }
  return MATE_TINT_IDS[index]!;
}

/**
 * The shape a Mate wears: the one its person picked (`mate:face:`), else its
 * tint's own (`MATE_SHAPE_OF_TINT`) — which is every Mate's shape from before
 * a face could be picked.
 */
export function mateShapeOf(
  tagList: ReadonlyArray<string> | undefined,
  tint: MateTintId,
): MateShapeId {
  return readZeropsGroupTags(tagList).face?.shape ?? MATE_SHAPE_OF_TINT[tint];
}
