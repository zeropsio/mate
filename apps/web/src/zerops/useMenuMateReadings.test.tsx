import { RegistryContext } from "@effect/atom-react";
import { MateAttention } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mateRowReading } from "~/components/zerops/SidebarMateRow.logic";

import { zeropsSessionAtom } from "../state/zerops";
import { COMING_UP_LINE } from "~/components/zerops/ZeropsProjectRow.logic";

import { mateComing } from "./mateComing";
import {
  useComingClock,
  useMateConversationsRead,
  useMateRowActivity,
  useLastKnownMateWords,
} from "./useMenuMateReadings";
import { useMatesActivity } from "./useZeropsAgentActivity";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

const AT = "2026-10-03T09:00:00.000Z";

/** Vera, online, at work on her main chat. */
const VERA = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: true, since: AT, overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: {
    id: "t1",
    title: "Add a login page",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "running", lastError: null },
    latestTurn: {
      turnId: "turn-1",
      state: "running",
      requestedAt: AT,
      startedAt: AT,
      completedAt: null,
    },
    latestUserMessageAt: AT,
    updatedAt: AT,
    latestUserMessagePreview: { text: "Add a login page" },
    latestMessagePreview: null,
    planProgress: null,
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
  },
  threads: { list: [], omitted: 0 },
  logins: {},
  crew: { status: "off" },
});

/** Vera's project, listed and not connected: this page holds no socket to her. */
const UNOPENED = {
  key: "p-vera:zcp",
  project: { id: "p-vera", name: "Acme - Vera", status: "ACTIVE", tagList: ["mate"] },
  group: "ready",
  service: { id: "zcp", name: "zcp", status: "ACTIVE" },
} as unknown as ZeropsCandidate;

const mounted: Array<ReactTestRenderer> = [];

afterEach(() => {
  act(() => {
    for (const renderer of mounted.splice(0)) renderer.unmount();
  });
});

/** `hook`'s answer, mounted over `registry`. */
function mountedOver<T>(registry: AtomRegistry.AtomRegistry, hook: () => T): T {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let answer: { readonly value: T } | undefined;
  function Probe() {
    answer = { value: hook() };
    return null;
  }
  act(() => {
    mounted.push(
      create(
        <RegistryContext.Provider value={registry}>
          <Probe />
        </RegistryContext.Provider>,
      ),
    );
  });
  return answer!.value;
}

/** A registry with the session's organization and HQ's word of Vera, `view`. */
function told(view: MateLiveView): AtomRegistry.AtomRegistry {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: "org-acme" },
  } as never);
  mountHqNavigation(registry, "org-acme", { mates: Object.fromEntries([["p-vera", view]]) });
  return registry;
}

describe("useMenuMateReadings — a Mate HQ tells of, no socket to it", () => {
  it("a Mate HQ holds online is not asleep without a socket", () => {
    const read = mountedOver(told(VERA), () => useMateRowActivity(useMatesActivity()))(UNOPENED);
    expect(read).toMatchObject({ threadId: "t1", kind: "working" });
    expect(mateRowReading({ connected: false, activity: read, mine: false }).face).toBe("working");
  });

  it("an unreachable Mate keeps HQ's attention alongside the dated overview", () => {
    const registry = AtomRegistry.make();
    const { store } = mountHqNavigation(registry, "org-acme", { mates: { "p-vera": VERA } });
    const attention = Schema.decodeUnknownSync(MateAttention)({
      source: { environmentId: "env-vera", incarnation: "run-1", revision: 1 },
      mainThreadId: "t1",
      lastThreadId: "t1",
      working: 0,
      waiting: 1,
      results: [],
      questions: [{ threadId: "t1", turnId: "turn-1", kind: "approval" }],
      truncated: false,
    });
    const scope = "hq:org-acme:mate-attention:p-vera";
    store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: 1 }],
      reset: true,
      rows: [
        {
          family: "mateAttention",
          id: "p-vera",
          value: attention,
          revision: { kind: "mate-attention", ...attention.source, live: false },
        },
      ],
      removals: [],
    });
    const words = mountedOver(registry, () => useLastKnownMateWords("p-vera", "Vera"));
    expect(words).toContain("Last known");
    expect(words).toContain("Vera was waiting for approval.");
    expect(words).not.toContain("Vera was working.");
  });

  it("a Mate HQ told of has its conversations read without a socket", () => {
    const read = mountedOver(told({ ...VERA, main: null }), useMateConversationsRead);
    expect(read(UNOPENED)).toBe(true);
  });
});

/** What the menu's getter asks of an arriving Mate, as it asks it: now, at the call. */
function lineAt(candidate: ZeropsCandidate, wokeAt: number): string | undefined {
  const nowMs = Math.max(Date.now(), wokeAt);
  return mateComing({ press: undefined, candidate, answerAwaited: true, nowMs })?.line;
}

describe("useComingClock — a coming-up line moves on at its deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("redraws a Mate whose arrival window ends at T, at T, with nothing else changing", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-07T09:00:00.000Z"));
    const until = Date.now() + 90_000;
    const arriving = { ...UNOPENED, arriving: { until } } as ZeropsCandidate;
    const candidates = [arriving];
    const lines: Array<string | undefined> = [];
    function Row() {
      lines.push(lineAt(arriving, useComingClock(candidates)));
      return null;
    }
    act(() => {
      mounted.push(create(<Row />));
    });
    expect(lines.at(-1)).toBe(COMING_UP_LINE);
    act(() => {
      vi.advanceTimersByTime(89_999);
    });
    expect(lines.at(-1)).toBe(COMING_UP_LINE);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(lines.at(-1)).toBeUndefined();
  });
});
