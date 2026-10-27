/**
 * One Git browser read as a page draws it: withheld while access is unverified or denied (by the
 * offers or by HQ), unread, known (kept through a failed read again), failed, or refused with HQ's
 * reason.
 */
import type { GitBrowseRead, GitBrowseValue } from "../../zerops/gitBrowse/reads.ts";
import {
  gitBrowseId,
  gitBrowseLink,
  gitBrowseScope,
  type GitBrowseKey,
} from "../families/hqGitBrowse.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export type GitBrowseView<V = GitBrowseValue> =
  | { readonly state: "withheld" }
  | { readonly state: "unread"; readonly busy: boolean }
  | {
      readonly state: "known";
      readonly answer: V;
      readonly busy: boolean;
      readonly failed: boolean;
    }
  | { readonly state: "failed"; readonly words: string }
  | { readonly state: "refused"; readonly reason: string; readonly words: string };

export const gitBrowse: Projection<
  GitBrowseKey<GitBrowseRead> & { readonly allowed: boolean | undefined },
  GitBrowseView
> = {
  name: "gitBrowse",
  keyOf: (key) => JSON.stringify([gitBrowseId(key), key.allowed]),
  derive: (read, key) => {
    const fact = read.fact("hqGitBrowse", gitBrowseId(key));
    const stream = read.stream(gitBrowseScope(key));
    const link = read.stream(gitBrowseLink(key)).fault;
    // HQ's denial, kept on the link, withholds the read whether or not it had answered before.
    if (
      key.allowed !== true ||
      fact.kind === "withheld" ||
      link?.outcome === "authoritative-denial"
    )
      return { state: "withheld" };
    // A refusal reaches the scope; a failure tried again (HQ busy, unreachable) stays on the link.
    const fault = stream.fault ?? link;
    const busy = stream.phase === "connecting" || stream.phase === "baselining";
    if (fact.kind === "known")
      return { state: "known", answer: fact.value, busy, failed: fault !== null };
    if (fault?.outcome === "definitive-refusal")
      return { state: "refused", reason: fault.code ?? "refused", words: fault.message };
    if (fault !== null) return { state: "failed", words: fault.message };
    return { state: "unread", busy };
  },
  equals: sameValue,
};
