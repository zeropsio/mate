import type { HqGitOptions, Principal, RefDecision, RefUpdate, Repo } from "./api.ts";

/** Whether git takes `ref` as a full ref name. */
export const validRef = (ref: string) =>
  !Array.from(ref).some(
    (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || "~^:?*[\\".includes(char),
  ) &&
  !ref.includes("..") &&
  !ref.includes("@{") &&
  !ref.endsWith(".") &&
  ref.split("/").length >= 2 &&
  ref.split("/").every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
const refuse = (reason: string): RefDecision => ({ allowed: false, reason });
/** HQ's namespace: the branch of a change opened without naming one, `mate/<mateId>/<number>`. */
export const allocated = (branch: string) => branch === "mate" || branch.startsWith("mate/");

/** Built-in policy the handler applies to every update; Core's port only answers change records. */
export const allowRefUpdate = async (
  principal: Principal,
  repo: Repo,
  update: RefUpdate,
  lookupChange: HqGitOptions["lookupChange"],
): Promise<RefDecision> => {
  if (principal.kind === "reader") return refuse("read_only");
  if ((principal.kind === "mate" || principal.kind === "person") && principal.appId !== repo.appId)
    return refuse("not_your_ref");
  if (!validRef(update.ref)) return refuse("invalid_ref");
  if (/^(?:0{40}|0{64})$/.test(update.newSha)) return refuse("deletion");
  if (principal.kind === "core") {
    if (
      update.ref.startsWith("refs/tags/") &&
      !/^(?:0{40}|0{64})$/.test(update.oldSha) &&
      update.oldSha !== update.newSha
    )
      return refuse("tag_immutable");
    return { allowed: true };
  }
  // `main` moves only by a merge, and every ref but a branch is HQ's: nobody's to push.
  if (!update.ref.startsWith("refs/heads/") || update.ref === "refs/heads/main")
    return refuse("protected_ref");
  const branch = update.ref.slice("refs/heads/".length);
  if (principal.kind === "person") {
    // HQ owns main, tags and the namespace of changes opened without a branch; a branch an open
    // change is on is its Mate's. People own every other branch.
    if (allocated(branch)) return refuse("protected_ref");
    return (await lookupChange(repo, branch))?.open === true
      ? refuse("protected_ref")
      : { allowed: true };
  }
  // A Mate names its own branches: none another Mate's open change is on, and in HQ's namespace
  // only its own open change's. A settled change leaves its named branch to whoever pushes next.
  const change = await lookupChange(repo, branch);
  if (change === null) return allocated(branch) ? refuse("unknown_change") : { allowed: true };
  if (change.open)
    return change.mateId === principal.mateId ? { allowed: true } : refuse("not_your_ref");
  return allocated(branch) ? refuse("change_closed") : { allowed: true };
};
