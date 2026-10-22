/**
 * What a browse page's `rev` names, read once: every later read of the page takes the commit it
 * answers, so a branch that moves meanwhile never mixes two commits on one page.
 *
 * @module browse/resolve
 */
import type { GitRunner } from "../git.ts";

/** The namespaces a person browses, in the order a bare name is looked up in. */
const NAMESPACES = [
  { prefix: "refs/heads/", kind: "branch" },
  { prefix: "refs/tags/", kind: "tag" },
  { prefix: "refs/github/heads/", kind: "github-branch" },
  { prefix: "refs/github/tags/", kind: "github-tag" },
] as const;

export type RefKind = "branch" | "tag" | "change" | "github-branch" | "github-tag" | "commit";

/**
 * A ref by its full name: the kind a person reads it as, and the name the picker shows. A branch a
 * change is bound to is Core's to mark (`change`), from its record, never from the name.
 */
export const refOf = (ref: string): { readonly name: string; readonly kind: RefKind } | null => {
  const namespace = NAMESPACES.find(({ prefix }) => ref.startsWith(prefix));
  if (namespace === undefined) return null;
  return { name: ref.slice(namespace.prefix.length), kind: namespace.kind };
};

export type Resolved =
  | {
      readonly kind: "commit";
      readonly sha: string;
      readonly ref: { readonly name: string; readonly kind: RefKind };
    }
  /** `main` before its first commit, asked for by default or by name. */
  | { readonly kind: "unborn" }
  | { readonly kind: "missing" };

const MAIN = "refs/heads/main";

export const resolveRevision = async (
  git: GitRunner,
  dir: string,
  rev: string | undefined,
  signal: AbortSignal,
): Promise<Resolved> => {
  const asked = rev ?? MAIN;
  if (asked === "" || asked.startsWith("-") || asked.includes("\0") || asked.length > 1024)
    return { kind: "missing" };
  const candidates = asked.startsWith("refs/")
    ? NAMESPACES.some(({ prefix }) => asked.startsWith(prefix))
      ? [asked]
      : []
    : NAMESPACES.map(({ prefix }) => `${prefix}${asked}`);
  if (candidates.length > 0) {
    // Patterns match by prefix and glob: only an exact name counts, in lookup order.
    const lines = (
      await git.run(
        [
          "-C",
          dir,
          "for-each-ref",
          "--format=%(refname)%1f%(objecttype)%1f%(objectname)%1f%(*objecttype)%1f%(*objectname)",
          "--",
          ...candidates,
        ],
        { signal },
      )
    )
      .toString()
      .split("\n");
    for (const candidate of candidates) {
      const [, type, object, peeledType, peeled] =
        lines.find((line) => line.startsWith(`${candidate}\x1f`))?.split("\x1f") ?? [];
      const sha = type === "commit" ? object : peeledType === "commit" ? peeled : undefined;
      const ref = refOf(candidate);
      if (sha !== undefined && ref !== null) return { kind: "commit", sha, ref };
    }
  }
  // A typed commit id, in either case.
  if (/^[0-9a-f]{7,40}$/iu.test(asked)) {
    const found = await git.exec(
      [
        "-C",
        dir,
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        `${asked.toLowerCase()}^{commit}`,
      ],
      // 1: no such commit; 128: a prefix more than one object starts with.
      { signal, acceptExitCodes: [1, 128] },
    );
    const sha = found.stdout.toString().trim();
    if (found.code === 0 && /^[0-9a-f]{40}$/u.test(sha))
      return { kind: "commit", sha, ref: { name: sha, kind: "commit" } };
  }
  return asked === MAIN || asked === "main" ? { kind: "unborn" } : { kind: "missing" };
};
