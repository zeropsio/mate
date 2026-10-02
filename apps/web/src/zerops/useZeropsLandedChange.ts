/**
 * A change the flow does not carry, read from HQ on its own.
 *
 * Every surface reads changes from `projectFlow`, which holds what HQ's stream carries of each
 * application: its open changes and its newest landed and closed ones. A change somebody links to
 * is usually among them; one older than that, or in an application the registry does not name
 * yet, would leave its page answering "This change is not open any more" — a worse destination
 * than the link itself (the owner, 2026-09-19).
 *
 * So the one change asked for is read from HQ, and only that one: no listing, no poll — one read
 * on open, asked again a few times while HQ does not find it or does not answer. A change the flow
 * already has never gets here. Nothing is read until the organization's official HQ is known.
 */
import { flowChange, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { useEffect, useState } from "react";

import { useOfficialHq } from "./accountHq";

export type ZeropsLandedChangeState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly pull: FlowPullRequest }
  | { readonly kind: "gone" }
  | { readonly kind: "failed"; readonly reason: string };

/** How long after each read that did not find the change it is read again. */
export const LANDED_CHANGE_RETRY_MS: ReadonlyArray<number> = [2_000, 5_000, 10_000];

/** One read of the change as the person: HQ's 404 is a change not there, any other no a failure. */
async function readChange(
  hq: { readonly address: string; readonly api: Pick<HqApi, "change"> },
  link: ChangeLink,
  signal: AbortSignal,
): Promise<Exclude<ZeropsLandedChangeState, { kind: "idle" | "reading" }>> {
  try {
    const detail = await hq.api.change(link, signal);
    return { kind: "read", pull: flowChange(detail.change, hq.address) };
  } catch (cause) {
    return cause instanceof HqError && cause.kind === "refused" && cause.status === 404
      ? { kind: "gone" }
      : { kind: "failed", reason: zeropsErrorMessage(cause) };
  }
}

export function useZeropsLandedChange(link: ChangeLink | null): ZeropsLandedChangeState {
  // Keyed on it, so a link drawn before the anchor is resolved is read once it is.
  const hq = useOfficialHq();
  const appId = link?.appId;
  const repo = link?.repo;
  const number = link?.number;
  const [state, setState] = useState<ZeropsLandedChangeState>({ kind: "idle" });

  useEffect(() => {
    if (hq === null || appId === undefined || repo === undefined || number === undefined) {
      setState({ kind: "idle" });
      return;
    }
    const asked = { appId, repo, number };
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: () => void = () => undefined;
    setState({ kind: "reading" });
    void (async () => {
      let answer = await readChange(hq, asked, stop.signal);
      // A change is linked the moment it is opened, so a first "not there" or a read that
      // failed is asked again a few times before it stands: a message is frozen once
      // written, and nothing else would ever read its link again.
      for (const delayMs of LANDED_CHANGE_RETRY_MS) {
        if (stop.signal.aborted || answer.kind === "read") break;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, delayMs);
        });
        if (stop.signal.aborted) return;
        answer = await readChange(hq, asked, stop.signal);
      }
      if (!stop.signal.aborted) setState(answer);
    })();
    return () => {
      stop.abort();
      clearTimeout(timer);
      wake();
    };
  }, [appId, hq, number, repo]);

  return state;
}
