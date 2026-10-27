/** HQ alone opens and closes the question about a removed project's Git. */
import { KeptGitQuestion } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqKeptGit: KeptGitQuestion;
  }
}
const decode = Schema.decodeUnknownOption(KeptGitQuestion);
export const hqKeptGitFamily: FamilySpec<"hqKeptGit"> = {
  family: "hqKeptGit",
  authority: "hq",
  scope: { source: "hq", suffix: "kept-git", leaving: "removed", demand: "navigation" },
  hq: {
    scope: "navigation",
    idOf: (key) => (key.startsWith("keptGit:") ? key.slice("keptGit:".length) : null),
    keyOf: (id) => `keptGit:${id}`,
    decode: (raw) => Option.getOrNull(decode(raw)),
  },
};
export const hqKeptGitScope = (orgId: string): ScopeKey => scopeOf(hqKeptGitFamily, orgId);
export const keptGitRequestId = (orgId: string, question: KeptGitQuestion, attempt: number) =>
  `kept-git/${encodeURIComponent(orgId)}/${encodeURIComponent(question.appId)}/${encodeURIComponent(question.askedAt)}/${attempt}`;
