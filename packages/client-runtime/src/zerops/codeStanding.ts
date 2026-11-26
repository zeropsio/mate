/** The standing of an application's code, from HQ's current facts. */
export type CodeStanding =
  | { readonly kind: "unread" }
  | { readonly kind: "in-use"; readonly mate: boolean; readonly leaving: boolean }
  | { readonly kind: "asked" }
  | { readonly kind: "kept"; readonly holds: "code" | "setup" }
  | {
      readonly kind: "deleting";
      readonly placed: boolean;
      readonly phase: "going" | "needs" | "waiting" | "failed";
    };

export function codeStanding(facts: {
  readonly placed: number;
  readonly mates: number;
  readonly contents:
    | { readonly empty: boolean; readonly deletingProjectIds: ReadonlyArray<string> }
    | undefined;
  readonly asked: boolean;
  readonly deletion: "none" | "going" | "needs" | "waiting" | "failed";
}): CodeStanding {
  if (facts.deletion !== "none")
    return { kind: "deleting", placed: facts.placed > 0, phase: facts.deletion };
  const leaving = (facts.contents?.deletingProjectIds.length ?? 0) > 0;
  if (facts.placed > 0 || leaving) return { kind: "in-use", mate: facts.mates > 0, leaving };
  if (facts.asked) return { kind: "asked" };
  if (facts.contents === undefined) return { kind: "unread" };
  return { kind: "kept", holds: facts.contents.empty ? "setup" : "code" };
}

export type CodeStandingOffers = {
  readonly addMate: "offered" | "off" | "none";
  readonly delete: "offered" | "waits" | "owner" | "none";
  readonly answer: boolean;
  readonly review: boolean;
};

/** The sentence shared by a project's code page and each repository in it. */
export function codeStandingSentence(name: string, standing: CodeStanding): string | undefined {
  switch (standing.kind) {
    case "kept":
      return standing.holds === "code"
        ? `${name} has no Mate. Its code is kept and billed as storage.`
        : `${name} has no Mate. Only its setup is kept.`;
    case "asked":
      return `${name} has no Mate. HQ asks whether to keep its code.`;
    case "deleting":
      return `${name} is being deleted.`;
    case "in-use":
    case "unread":
      return undefined;
  }
}

export function codeStandingOffers(
  standing: CodeStanding,
  viewer: {
    readonly deleteApp: "allowed" | "refused" | "unknown";
    readonly addMate: "offered" | "off" | "none";
  },
): CodeStandingOffers {
  if (standing.kind === "kept")
    return {
      addMate: viewer.addMate,
      delete:
        viewer.deleteApp === "allowed"
          ? "offered"
          : viewer.deleteApp === "refused"
            ? "owner"
            : "waits",
      answer: false,
      review: false,
    };
  return {
    addMate: "none",
    delete: "none",
    answer: standing.kind === "asked",
    review: standing.kind === "deleting" && standing.phase !== "going",
  };
}

export function codeStandingLine(
  standing: CodeStanding,
): { readonly words: string; readonly notice: boolean } | undefined {
  switch (standing.kind) {
    case "unread":
      return { words: "Checking what HQ holds…", notice: false };
    case "in-use":
      if (standing.leaving) return { words: "Deletion is still in progress.", notice: true };
      return standing.mate ? undefined : { words: "No Mate yet", notice: false };
    case "asked":
      return { words: "Keep its code?", notice: true };
    case "kept":
      return { words: standing.holds === "code" ? "Code kept" : "Setup kept", notice: true };
    case "deleting":
      return {
        words:
          standing.phase === "going"
            ? "Deleting…"
            : standing.phase === "failed"
              ? "It was not deleted"
              : "Deletion waits for a person",
        notice: true,
      };
  }
}
