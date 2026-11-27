import type { MateMessageNotAdmittedReason, ZeropsLoginState } from "@t3tools/contracts";

/** What the login's own state and turn admission can establish now. */
export type NoticeLogin = "ready" | "unavailable" | "unknown";

/** Reduces the login's own state and the turn admission's answer without making silence a refusal. */
export function checkNoticeLogin(input: {
  readonly state: ZeropsLoginState | "authorized-token" | undefined;
  readonly signingIn: boolean;
  readonly admission: "admit" | "refuse" | "unknown";
}): NoticeLogin {
  if (input.signingIn || input.state === undefined || input.state === "registering")
    return "unknown";
  if (input.state !== "authorized") return "unavailable";
  return input.admission === "admit"
    ? "ready"
    : input.admission === "unknown"
      ? "unknown"
      : "unavailable";
}

/** The check notice's admission, including a run held by a provider limit. */
export function checkNoticeVerdict(input: {
  /** Absent when the conversation has no agent yet. */
  readonly current: NoticeLogin | undefined;
  readonly others: ReadonlyArray<NoticeLogin>;
  readonly usageLimited: boolean;
}):
  | { readonly kind: "run" | "wait" }
  | {
      readonly kind: "end";
      readonly reason: MateMessageNotAdmittedReason;
    } {
  if (input.usageLimited) {
    return input.current === undefined ||
      input.current === "unknown" ||
      input.others.some((login) => login !== "unavailable")
      ? { kind: "wait" }
      : { kind: "end", reason: "usage-limit" };
  }
  if (input.current === "ready" || (input.current === undefined && input.others.includes("ready")))
    return { kind: "run" };
  if (input.current === "unknown" || input.others.some((login) => login !== "unavailable"))
    return { kind: "wait" };
  return { kind: "end", reason: "no-agent" };
}
