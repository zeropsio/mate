/**
 * A code repository the agent asks the person to connect to GitHub, read off zcp's answer to
 * `zerops_mirror action=request`: the HQ repository's name and one line of why. zcp writes nothing
 * and answers at once; the engine opens the ask on that call and the person picks the GitHub
 * repository on its card, which their client connects in HQ itself. No token crosses this answer.
 *
 * @module engine/pump/mirrorAsk
 */
import type { ItemBody, RequestAsk } from "@t3tools/contracts";

import { isRecord, zcpAnswerOfCall } from "./vaultAsk.ts";

/** zcp's tool that asks (`action=request`) and withdraws (`action=withdraw`). */
export const MIRROR_REQUEST_TOOL = "zerops_mirror";

/** A name HQ keeps a repository under (as an origin ask's). */
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
/** The longest why a person is shown (as a vault ask's). */
const REASON_MAX = 280;

/** The repository `said` names under `mirror.repo`; `null` for none or a malformed one. */
const mirrorRepo = (said: unknown): string | null => {
  const mirror = isRecord(said) ? said.mirror : undefined;
  const repo = isRecord(mirror) ? mirror.repo : undefined;
  return typeof repo === "string" && REPO_NAME.test(repo) ? repo : null;
};

/** The ask a closed call made of the person; `null` for every other call, or a malformed answer. */
export function mirrorAskOfCall(body: ItemBody): Extract<RequestAsk, { kind: "mirror" }> | null {
  const requested = zcpAnswerOfCall(body, MIRROR_REQUEST_TOOL)?.requested;
  const repo = mirrorRepo(requested);
  const why =
    repo !== null && isRecord(requested) && isRecord(requested.mirror)
      ? requested.mirror.why
      : undefined;
  if (repo === null) return null;
  const reason = typeof why === "string" ? why.trim().slice(0, REASON_MAX) : "";
  return { kind: "mirror", repo, reason: reason === "" ? null : reason };
}

/**
 * A repository the person was asked to connect that needs them no more, read off zcp's answer to
 * `zerops_mirror`: `connected`, HQ already shows its GitHub remote; `withdrawn`
 * (`action=withdraw`), the agent no longer needs it. `null` for every other call, or a malformed
 * answer.
 */
export function mirrorSettledOfCall(body: ItemBody): {
  readonly repo: string;
  readonly how: "connected" | "withdrawn";
} | null {
  const answer = zcpAnswerOfCall(body, MIRROR_REQUEST_TOOL);
  if (answer === null || answer.requested !== undefined) return null;
  const how = isRecord(answer.connected)
    ? ("connected" as const)
    : isRecord(answer.withdrawn)
      ? ("withdrawn" as const)
      : null;
  if (how === null) return null;
  const repo = mirrorRepo(answer[how]);
  return repo === null ? null : { repo, how };
}
