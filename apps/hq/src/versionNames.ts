/**
 * What HQ names an app version, and which commit a version's name spells (main B16): the label a
 * person reads it by — a stage's branch, a production's release tag — and the commit's short sha,
 * "main 7e2d4c1". The platform keeps the name only in the service's own variables (`appVersionName`),
 * so what a service runs is read back from it. Main's broker wrote older shapes too; every one of
 * them is read, and anything named by hand spells no commit.
 *
 * @module versionNames
 */

/** The seven hex a new name carries, as git and the client show them. */
const SHORT = 7;

const isHex = (text: string) => /^[0-9a-f]+$/u.test(text);
const isWholeSha = (text: string) => (text.length === 40 || text.length === 64) && isHex(text);

export const versionName = (label: string, sha: string): string =>
  `${label} ${sha.slice(0, SHORT)}`;

/**
 * The commit a version's name spells, whole or short; none for a name not HQ's or main's:
 *
 * - one token: an old stage deploy's bare whole sha;
 * - three or more: an old production deploy, "{sha} {tag} {tagger}";
 * - two: a new name, "{label} {short sha}", or an old production one whose tagger was empty.
 */
export const versionSha = (name: string): string => {
  const tokens = name.split(" ");
  if (tokens.length >= 3) return isWholeSha(tokens[0] ?? "") ? (tokens[0] ?? "") : "";
  if (tokens.some((token) => token === "")) return "";
  const [first = "", second] = tokens;
  if (second === undefined) return isWholeSha(first) ? first : "";
  if (second.length === SHORT && isHex(second)) return second;
  return isWholeSha(first) ? first : "";
};

/**
 * Whether the sha a name spells is the commit `sha`: equal, or a hex prefix of at least seven of a
 * whole sha. A shorter or non-hex token never matches a commit it only begins like.
 */
export const sameCommit = (token: string, sha: string): boolean =>
  token !== "" &&
  (token === sha ||
    (token.length >= SHORT && isHex(token) && isWholeSha(sha) && sha.startsWith(token)));
