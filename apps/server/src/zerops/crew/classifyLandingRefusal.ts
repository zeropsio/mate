/**
 * What a refused landing means, read from git's stderr (CONCEPT §3.2).
 *
 * A landing fast-forwards the person's tree (`git merge --ff-only <S>` in
 * `/var/www`), a two-way checkout that leaves unrelated edits alone and
 * refuses when one is in the way. Nothing repeats a refused landing on its
 * own: `crewLanding.ts` holds the task with the refusal's reason, and the
 * person continues it when ready, or it parks:
 *
 * | Refusal                      | Action                                             |
 * |------------------------------|----------------------------------------------------|
 * | a tracked path is dirty      | `wait`: held on the person's tree, paths named     |
 * | an untracked file in the way | `wait`                                             |
 * | not a fast-forward           | `redo`: held, the tree moved during the landing    |
 * | `index.lock` present         | `backoff`: held and refused; never delete the lock |
 * | ENOSPC                       | `park` and name the disk                           |
 * | missing object               | `retry`: held, an object was missing               |
 * | anything else                | `park` with git's first error line                 |
 *
 * Every crew git line runs under `LC_ALL=C`, so these are git's own words.
 *
 * @module classifyLandingRefusal
 */

export type LandingRefusal =
  | {
      readonly kind: "dirty" | "untracked";
      readonly action: "wait";
      readonly paths: ReadonlyArray<string>;
    }
  | { readonly kind: "not-fast-forward"; readonly action: "redo" }
  | { readonly kind: "index-lock"; readonly action: "backoff" }
  | { readonly kind: "no-space"; readonly action: "park" }
  | { readonly kind: "missing-object"; readonly action: "retry" }
  | { readonly kind: "unknown"; readonly action: "park"; readonly detail: string };

/** The tab-indented paths git lists under a refusal's header line. */
const listedPaths = (lines: ReadonlyArray<string>, header: number): ReadonlyArray<string> => {
  const paths: Array<string> = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.startsWith("\t")) break;
    paths.push(line.slice(1));
  }
  return paths;
};

const MISSING_OBJECT =
  /not something we can merge|unable to read (sha1 file|tree)|bad object|Could not read [0-9a-f]{7,}|missing (blob|tree|commit)/;

export const classifyLandingRefusal = (stderr: string): LandingRefusal => {
  const lines = stderr.split("\n");
  const dirty = lines.findIndex((line) =>
    line.includes("Your local changes to the following files would be overwritten"),
  );
  if (dirty !== -1) {
    return { kind: "dirty", action: "wait", paths: listedPaths(lines, dirty) };
  }
  const untracked = lines.findIndex((line) =>
    line.includes("untracked working tree files would be overwritten"),
  );
  if (untracked !== -1) {
    return { kind: "untracked", action: "wait", paths: listedPaths(lines, untracked) };
  }
  if (stderr.includes("No space left on device")) {
    return { kind: "no-space", action: "park" };
  }
  if (/index\.lock'?: File exists/.test(stderr)) {
    return { kind: "index-lock", action: "backoff" };
  }
  if (stderr.includes("Not possible to fast-forward")) {
    return { kind: "not-fast-forward", action: "redo" };
  }
  if (MISSING_OBJECT.test(stderr)) {
    return { kind: "missing-object", action: "retry" };
  }
  const first =
    lines.find((line) => /^(fatal|error):/.test(line)) ??
    lines.find((line) => line.trim().length > 0) ??
    "git refused the landing";
  return { kind: "unknown", action: "park", detail: first.trim() };
};
