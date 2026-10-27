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
 * `zerops_origin`: `connected`, the address already is the origin of a repository in HQ — `repo`
 * names the one holding it, and every ask naming the address is settled, as zcp would ask none of
 * them now; `withdrawn` (`action=withdraw`), the agent no longer needs the pick — of the one
 * repository `repo` names, else of every repository asked about the address. `null` for every
 * other call, or a malformed answer.
 */
export function originSettledOfCall(body: ItemBody): {
  readonly url: string;
  readonly how: "connected" | "withdrawn";
  readonly repo?: string;
} | null {
  const answer = zcpAnswerOfCall(body, ORIGIN_REQUEST_TOOL);
  if (answer === null || answer.requested !== undefined) return null;
  const settled = isRecord(answer.connected)
    ? { how: "connected" as const, said: answer.connected, repo: answer.connected.repo }
    : isRecord(answer.withdrawn)
      ? { how: "withdrawn" as const, said: answer.withdrawn, repo: undefined }
      : null;
  const origin = settled !== null && isRecord(settled.said.origin) ? settled.said.origin : null;
  const url = originAddress(origin?.url);
  if (settled === null || origin === null || url === null) return null;
  const repo = settled.how === "connected" ? settled.repo : origin.repo;
  return {
    url,
    how: settled.how,
    ...(typeof repo === "string" && REPO_NAME.test(repo) ? { repo } : {}),
  };
}
