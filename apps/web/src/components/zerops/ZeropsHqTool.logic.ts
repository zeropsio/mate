/**
 * The organization's HQ on the projects page's Tools row, where Gitea and *Add Gitea* stood
 * (SPEC §3.1, §4, §6.2): healthy; unavailable since when, the rest of the page still drawn from
 * what was read last; for an owner or an admin of an organization with none, *Set up HQ*; for
 * anybody else there, whom to ask.
 *
 * Pure: the words; `ZeropsHqTool.tsx` draws them.
 */
import { HQ_UNCLEAR } from "@t3tools/client-runtime/zerops";
import type { OfficialHq } from "@t3tools/client-runtime/zerops/hq";
import { mateMemberName, type MateOwnerCandidate } from "@t3tools/client-runtime/zerops/mateAccess";

import type { AccountHq, HqStanding } from "~/zerops/accountHq";

/** An HQ's birth from this tab, as the row draws it. */
export type HqBirthView =
  | { readonly kind: "running"; readonly doing: string }
  | { readonly kind: "failed"; readonly reason: string; readonly tryAgain: boolean };

export interface HqToolInput {
  readonly status: AccountHq["status"];
  readonly hq: OfficialHq;
  readonly standing: HqStanding;
  readonly birth: HqBirthView | undefined;
  /** The viewer is an org owner or admin: who sets an HQ up. */
  readonly mayBear: boolean;
  readonly admins: ReadonlyArray<MateOwnerCandidate>;
}

export type HqToolLine =
  /** Nothing to say yet. */
  | { readonly kind: "none" }
  | { readonly kind: "healthy" }
  | { readonly kind: "unavailable"; readonly since: number }
  | { readonly kind: "set-up" }
  | { readonly kind: "ask"; readonly line: string }
  | { readonly kind: "setting-up"; readonly doing: string }
  | { readonly kind: "failed"; readonly reason: string; readonly tryAgain: boolean }
  | { readonly kind: "unclear"; readonly line: string };

export function hqToolLine(input: HqToolInput): HqToolLine {
  if (input.hq.kind === "official") {
    switch (input.standing.kind) {
      case "unknown":
        return { kind: "none" };
      case "healthy":
        return { kind: "healthy" };
      case "unavailable":
        return { kind: "unavailable", since: input.standing.since };
    }
  }
  if (input.hq.kind === "unclear") return { kind: "unclear", line: HQ_UNCLEAR };
  if (input.birth?.kind === "running") return { kind: "setting-up", doing: input.birth.doing };
  if (input.birth?.kind === "failed") {
    return { kind: "failed", reason: input.birth.reason, tryAgain: input.birth.tryAgain };
  }
  if (input.status !== "ready") return { kind: "none" };
  if (input.mayBear) return { kind: "set-up" };
  const names = input.admins.flatMap((admin) => mateMemberName(admin) ?? []);
  const who = names.length === 0 ? "an owner or admin" : names.join(" or ");
  return { kind: "ask", line: `No HQ yet. Ask ${who} to set it up.` };
}
