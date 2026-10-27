/**
 * A repository the agent asks the person about, read off zcp's answer to `zerops_origin
 * action=request`: its address, the HQ repository the pair will wire, and one line of why. zcp
 * writes nothing and answers at once; the engine opens the ask on that call and the person picks
 * on its card where the code is kept — on GitHub, mounted through the organization's GitHub app,
 * or in Mate, GitHub only followed. No token crosses this answer. An origin already connected
 * (`connected`) leaves the person nothing to do.
 *
 * @module engine/pump/originAsk
 */
import type { ItemBody, RequestAsk } from "@t3tools/contracts";

import { isRecord, zcpAnswerOfCall } from "./vaultAsk.ts";

/** zcp's tool that asks (`action=request`). */
export const ORIGIN_REQUEST_TOOL = "zerops_origin";

/** A name HQ keeps a repository under: the pair's planned dev hostname. */
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
/** The longest why a person is shown (as a vault ask's). */
const REASON_MAX = 280;

/** An https address with no credentials in it; `null` for any other. */
const originAddress = (url: unknown): string | null => {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
      ? url
      : null;
  } catch {
    return null;
  }
};

/** The ask a closed call made of the person; `null` for every other call, or a malformed answer. */
export function originAskOfCall(body: ItemBody): Extract<RequestAsk, { kind: "origin" }> | null {
  const requested = zcpAnswerOfCall(body, ORIGIN_REQUEST_TOOL)?.requested;
  const origin = isRecord(requested) ? requested.origin : undefined;
  if (!isRecord(origin)) return null;
  const url = originAddress(origin.url);
  const { repo, why } = origin;
  if (url === null || typeof repo !== "string" || !REPO_NAME.test(repo)) return null;
  const reason = typeof why === "string" ? why.trim().slice(0, REASON_MAX) : "";
  return { kind: "origin", url, repo, reason: reason === "" ? null : reason };
}

/**
 * An origin the person was asked about that needs their pick no more, read off zcp's answer to
 * `zerops_origin`: `connected`, the address already is the origin of a repository in HQ, which
 * settles the ask of the repository that call asked about — zcp told the agent the pick of every
 * other repository would come, so those wait for their own word; `withdrawn` (`action=withdraw`),
 * the agent no longer needs the pick — of the one repository `repo` names, else of every
 * repository asked about the address. `null` for every other call, or a malformed answer.
 */
export function originSettledOfCall(body: ItemBody): {
  readonly url: string;
  readonly how: "connected" | "withdrawn";
  readonly repo?: string;
} | null {
  const answer = zcpAnswerOfCall(body, ORIGIN_REQUEST_TOOL);
  if (answer === null || answer.requested !== undefined) return null;
  const how = isRecord(answer.connected)
    ? ("connected" as const)
    : isRecord(answer.withdrawn)
      ? ("withdrawn" as const)
      : null;
  const said = how === null ? null : (answer[how] as Record<string, unknown>);
  // Both answers carry the ask as `origin`: its `repo` is the HQ repository the ask named (absent
  // from a withdrawal of every ask of the address). `connected.repo`, beside it, is another
  // thing — the repository already holding the address — and settles nothing here.
  const origin = said !== null && isRecord(said.origin) ? said.origin : null;
  const url = originAddress(origin?.url);
  if (how === null || origin === null || url === null) return null;
  const repo = typeof origin.repo === "string" && REPO_NAME.test(origin.repo) ? origin.repo : null;
  // A connected answer names the asked repository: without one it settles none.
  if (how === "connected" && repo === null) return null;
  return { url, how, ...(repo === null ? {} : { repo }) };
}
