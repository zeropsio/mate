/** The repository page's answer, from the facts already held for it. */
export function repositoryPage(input: {
  readonly appsKnown: boolean;
  readonly appListed: boolean;
  readonly repositories: ReadonlyArray<string> | undefined;
  readonly repo: string;
  readonly allowed: boolean | undefined;
  readonly accessReason: string | undefined;
  readonly withheld: boolean;
  readonly homeRefusal: string | undefined;
}):
  | { readonly kind: "reading" }
  | { readonly kind: "gone" }
  | { readonly kind: "open" }
  | { readonly kind: "no-access"; readonly reason: string } {
  if (!input.appsKnown) return { kind: "reading" };
  if (!input.appListed) return { kind: "gone" };
  if (input.allowed === false)
    return {
      kind: "no-access",
      reason: input.accessReason ?? "You do not have access to this repository.",
    };
  if (
    input.withheld ||
    input.homeRefusal === "repo_not_found" ||
    input.homeRefusal === "app_not_found"
  )
    return { kind: "gone" };
  if (input.allowed === undefined) return { kind: "reading" };
  if (input.repositories !== undefined && !input.repositories.includes(input.repo))
    return { kind: "gone" };
  return { kind: "open" };
}
