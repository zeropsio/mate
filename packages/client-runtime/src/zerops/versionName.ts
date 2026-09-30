/**
 * The commit an app version's name spells, the one reading of it (the broker's
 * `docs/group-repo.md`, "What is deployed, and how the broker names it").
 *
 * The name is the platform's evidence of what a service runs, and a service
 * keeps whatever name it was deployed under, so every name the broker has ever
 * written is read:
 *
 * - **now** — exactly two tokens, a label and the commit's short sha: a stage's
 *   `main 7e2d4c1`, production's `v0.1.0 7e2d4c1`. Branches and tags hold no
 *   space, so the label is always one token;
 * - **before 2026-09-30** — a stage's bare 40-hex sha, and production's
 *   `{sha} {tag} {tagger}`, the sha first.
 *
 * zcp names its own pushes the same way, `{branch} {short sha}`, and a push of a
 * working tree with uncommitted changes `{branch} {short sha}-dirty`: that one
 * was built from no commit, and reads as named by hand. Anything else was named
 * by hand (`zcli` with a name somebody typed) and names no commit.
 *
 * A short sha never equals a full one, so a commit is compared with
 * {@link sameCommit}, and where a full sha is needed as a key it is found among
 * the commits already known ({@link resolveCommit}).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module versionName
 */

/** The fewest hex characters a sha is spelled with: what git and every row here show. */
export const SHORT_SHA_LENGTH = 7;

const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA = /^[0-9a-f]{7,40}$/u;

/** What an app version's name says, where one of ours named it. */
export interface ParsedVersionName {
  /** The commit, lower case, whole in an old name and short in a new one. */
  readonly sha: string;
  /** The tag or the branch the name carries; absent from an old stage name. */
  readonly label?: string;
  /** Who tagged the release, which only an old production name says. */
  readonly taggedBy?: string;
}

export function parseVersionName(name: string | undefined): ParsedVersionName | undefined {
  const tokens = (name ?? "")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const [first, second, ...rest] = tokens;
  if (first === undefined) return undefined;
  const firstSha = first.toLowerCase();
  if (second === undefined) return FULL_SHA.test(firstSha) ? { sha: firstSha } : undefined;
  const secondSha = second.toLowerCase();
  if (rest.length === 0 && SHA.test(secondSha)) return { sha: secondSha, label: first };
  if (!FULL_SHA.test(firstSha)) return undefined;
  return rest.length === 0
    ? { sha: firstSha, label: second }
    : { sha: firstSha, label: second, taggedBy: rest.join(" ") };
}

/**
 * Whether the commit a version's name spells (`named`, whole or short) is
 * `commit`, a whole sha: equal, or a hex prefix of it at least
 * {@link SHORT_SHA_LENGTH} long. Only the named side may be short — a short
 * `commit` is a spelling nothing can check, and a dirty tree's `-dirty` token
 * is not hex, so neither is ever the commit. Nothing is never a commit.
 */
export function sameCommit(named: string | undefined, commit: string | undefined): boolean {
  if (named === undefined || commit === undefined) return false;
  const token = named.toLowerCase();
  const sha = commit.toLowerCase();
  if (token.length === 0 || sha.length === 0) return false;
  if (token === sha) return true;
  return SHA.test(token) && FULL_SHA.test(sha) && sha.startsWith(token);
}

/**
 * The full sha a name's commit is, among commits already known: itself when it
 * is whole, else the one known full sha it begins. Two known commits it begins
 * — or none — are no answer: a commit that cannot be told reads as unknown,
 * never as a wrong one.
 */
export function resolveCommit(
  token: string | undefined,
  known: Iterable<string | undefined>,
): string | undefined {
  if (token === undefined) return undefined;
  const sha = token.toLowerCase();
  if (FULL_SHA.test(sha)) return sha;
  let found: string | undefined;
  for (const candidate of known) {
    if (candidate === undefined) continue;
    const full = candidate.toLowerCase();
    if (!FULL_SHA.test(full) || !sameCommit(sha, full)) continue;
    if (found !== undefined && found !== full) return undefined;
    found = full;
  }
  return found;
}
