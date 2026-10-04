import type { HqGitOptions, Principal, RefDecision, RefUpdate, Repo } from "./api.ts";

const validRef = (ref: string) =>
  !Array.from(ref).some(
    (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || "~^:?*[\\".includes(char),
  ) &&
  !ref.includes("..") &&
  !ref.includes("@{") &&
  !ref.endsWith(".") &&
  ref.split("/").length >= 2 &&
  ref.split("/").every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
const refuse = (reason: string): RefDecision => ({ allowed: false, reason });

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
  if (principal.kind === "person") {
    // HQ owns main, tags and the allocated Mate change namespace. People own topic branches.
    return update.ref.startsWith("refs/heads/") &&
      update.ref !== "refs/heads/main" &&
      update.ref !== "refs/heads/mate" &&
      !update.ref.startsWith("refs/heads/mate/")
      ? { allowed: true }
      : refuse("protected_ref");
  }
  const match = /^refs\/heads\/mate\/([^/]+)\/([1-9][0-9]*)$/.exec(update.ref);
  if (!match || match[1] !== principal.mateId) return refuse("not_your_ref");
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number)) return refuse("not_your_ref");
  const change = await lookupChange(repo, principal.mateId, number);
  if (
    !change ||
    change.appId !== repo.appId ||
    change.mateId !== principal.mateId ||
    change.number !== number
  ) {
    return refuse("unknown_change");
  }
  return change.open ? { allowed: true } : refuse("change_closed");
};
