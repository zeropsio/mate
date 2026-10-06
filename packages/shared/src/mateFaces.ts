/** The face vocabulary and name-based tint assignment, shared by clients and the HQ switch. */
import { MATE_SHAPE_IDS, MATE_TINT_IDS, type MateShapeId, type MateTintId } from "./brand.ts";

/** A Mate's face: the colour and the shape its person picked for it. */
export interface ZeropsMateFace {
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
}

/**
 * A face as HQ records it. A part this client does not know — a tint or a
 * shape a newer client added — is absent, and the face derived from the
 * Mate's name stands in for it (`mateTints.ts`).
 */
export interface ZeropsMateFaceTag {
  readonly tint: MateTintId | undefined;
  readonly shape: MateShapeId | undefined;
  /**
   * The Mate wore its name's tint before this face was picked for it, and its
   * name keeps its place among the names the tints are shared out over
   * (`<tint>:<shape>:named`, `assignCandidateMateTints`): so picking
   * it a face recoloured nobody else. Absent on a face picked at its birth.
   */
  readonly named?: true;
}

const TINT_VALUES: ReadonlySet<string> = new Set(MATE_TINT_IDS);
const SHAPE_VALUES: ReadonlySet<string> = new Set(MATE_SHAPE_IDS);

/** The part after the shape saying the Mate's name keeps its place (`ZeropsMateFaceTag.named`). */
const NAMED_FACE_PART = "named";

/** A face as HQ records it: `<tint>:<shape>`, `:named` after it where the name kept its place. */
export function readMateFace(value: string): ZeropsMateFaceTag | undefined {
  if (readFaces.has(value)) return readFaces.get(value);
  const face = readMateFaceOnce(value);
  // A handful of faces per account: emptied whole on the rare overflow.
  if (readFaces.size >= READ_FACES_HELD) readFaces.clear();
  readFaces.set(value, face);
  return face;
}

/** Faces read, by their value: every row reads its Mate's on every render, the same answer. */
const READ_FACES_HELD = 256;
const readFaces = new Map<string, ZeropsMateFaceTag | undefined>();

function readMateFaceOnce(value: string): ZeropsMateFaceTag | undefined {
  // Parts past these three are a newer client's; the ones this one knows still read.
  const [tint, shape, named] = value.split(":");
  const face = {
    tint: tint !== undefined && TINT_VALUES.has(tint) ? (tint as MateTintId) : undefined,
    shape: shape !== undefined && SHAPE_VALUES.has(shape) ? (shape as MateShapeId) : undefined,
  };
  if (face.tint === undefined && face.shape === undefined) return undefined;
  return named === NAMED_FACE_PART ? { ...face, named: true } : face;
}

/** A face in the grammar HQ records it in (`readMateFace`). */
export function formatMateFace(
  face: ZeropsMateFace,
  options: { readonly named?: boolean } = {},
): string {
  const value = `${face.tint}:${face.shape}`;
  return options.named === true ? `${value}:${NAMED_FACE_PART}` : value;
}

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
 * One tint per distinct name (case-insensitively). Blank names get nothing.
 */
export function assignMateTints(names: ReadonlyArray<string>): ReadonlyMap<string, MateTintId> {
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
  const taken = new Set<number>();
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
