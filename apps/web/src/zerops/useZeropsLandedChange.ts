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
 * on open, with each answer published at once. Only Read again asks another time. A change the
 * flow already has never gets here. Nothing is read until the organization's official HQ is known.
 */
import { flowChange, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { useCallback, useEffect, useState } from "react";

import { useOfficialHq } from "./accountHq";

export type ZeropsLandedChangeState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly pull: FlowPullRequest }
  | { readonly kind: "gone" }
  | { readonly kind: "refused" | "unavailable"; readonly reason: string };

/**
 * One read of the change as the person: HQ's 404 is a change not there; a refusal ends it.
 * An open change no push reached is drawn nowhere (SPEC §3.2a), here neither.
 */
async function readChange(
  hq: { readonly address: string; readonly api: Pick<HqApi, "change"> },
  link: ChangeLink,
  signal: AbortSignal,
): Promise<Exclude<ZeropsLandedChangeState, { kind: "idle" | "reading" }>> {
  try {
    const { change } = await hq.api.change(link, signal);
    if (change.state === "open" && change.head === null) return { kind: "gone" };
    return { kind: "read", pull: flowChange(change, hq.address) };
  } catch (cause) {
    if (cause instanceof HqError && cause.kind === "refused") {
      return cause.status === 404
        ? { kind: "gone" }
        : { kind: "refused", reason: zeropsErrorMessage(cause) };
    }
    return { kind: "unavailable", reason: zeropsErrorMessage(cause) };
  }
}

export function useZeropsLandedChange(link: ChangeLink | null): ZeropsLandedChangeState & {
  readonly readAgain?: () => void;
} {
  // Keyed on it, so a link drawn before the anchor is resolved is read once it is.
  const hq = useOfficialHq();
  const appId = link?.appId;
  const repo = link?.repo;
  const number = link?.number;
  const [attempt, setAttempt] = useState(0);
  const readAgain = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const key =
    hq === null || link === null
      ? null
      : `${hq.address}|${link.appId}/${link.repo}#${String(link.number)}`;
  const initial = (): ZeropsLandedChangeState =>
    key === null ? { kind: "idle" } : { kind: "reading" };
  const [held, setHeld] = useState({ key, hq, attempt, state: initial() });
  let state = held.state;
  if (held.key !== key || held.hq !== hq || held.attempt !== attempt) {
    state = initial();
    setHeld({ key, hq, attempt, state });
  }
  const reading = state.kind === "reading";

  useEffect(() => {
    if (
      !reading ||
      hq === null ||
      key === null ||
      appId === undefined ||
      repo === undefined ||
      number === undefined
    )
      return;
    const asked = { appId, repo, number };
    const stop = new AbortController();
    void readChange(hq, asked, stop.signal).then((answer) => {
      if (stop.signal.aborted) return;
      setHeld((current) =>
        current.key === key && current.hq === hq && current.attempt === attempt
          ? { ...current, state: answer }
          : current,
      );
    });
    return () => {
      stop.abort();
    };
  }, [appId, attempt, hq, key, number, reading, repo]);

  return {
    ...state,
    ...(state.kind === "gone" || state.kind === "unavailable" ? { readAgain } : {}),
  };
}
