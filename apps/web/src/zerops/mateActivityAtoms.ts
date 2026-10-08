/** Keyed row activity; list consumers compose the same readers without owning list-key caches. */
import {
  accountReadsAtom,
  hqMateOverviewAtom,
  hqMatePresenceAtom,
  mateAttentionAtom,
  shownAttentionProjectsAtom,
} from "@t3tools/client-runtime/data";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Atom } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { environmentThreadShells } from "../state/threads";
import { zeropsEnvironmentsAtom } from "../state/zerops";
import { useUiStateStore } from "../uiStateStore";
import { matesActivityOf } from "./mateActivity";
import type { ZeropsAgentActivity } from "./agentActivity";

const visitsAtom = Atom.make((get) => {
  get.addFinalizer(
    useUiStateStore.subscribe((state, previous) => {
      if (state.threadLastVisitedAtById !== previous.threadLastVisitedAtById)
        get.setSelf(state.threadLastVisitedAtById);
    }),
  );
  return useUiStateStore.getState().threadLastVisitedAtById;
});
const visitOfThreadAtom = Atom.family((key: string) => Atom.make((get) => get(visitsAtom)[key]));
const environmentOfProjectAtom = Atom.family((projectId: string) =>
  Atom.make((get) => {
    const environment = get(zeropsEnvironmentsAtom).find(
      (entry) => entry.zeropsProjectId === projectId,
    );
    return environment === undefined
      ? null
      : {
          id: environment.environmentId,
          standing:
            environment.connection.phase === "connected" ||
            environment.connection.phase === "reconnecting",
        };
  }).pipe(
    Atom.withEquality(
      (a: { readonly id: EnvironmentId; readonly standing: boolean } | null, b) =>
        a?.id === b?.id && a?.standing === b?.standing,
    ),
  ),
);

export function sameActivity(
  a: ZeropsAgentActivity | undefined,
  b: ZeropsAgentActivity | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // A timestamp-only delivery has no new menu fact. Real words/state still carry their source date.
  const before = { ...a, at: "" };
  return shareEqual(before, { ...b, at: "" }) === before;
}

export const mateActivityAtom = Atom.family((projectId: string) =>
  Atom.make((get) => {
    const account = get(accountReadsAtom);
    if (account?.orgId == null) return undefined;
    const overview = get(hqMateOverviewAtom(projectId));
    const presence = get(hqMatePresenceAtom(projectId));
    const attention = get(mateAttentionAtom(projectId));
    const socket = get(environmentOfProjectAtom(projectId));
    const environmentId =
      attention.attention?.source.environmentId ?? overview?.identity?.environmentId ?? socket?.id;
    const threadId = attention.attention?.mainThreadId ?? attention.attention?.lastThreadId;
    const refs =
      environmentId === undefined
        ? []
        : threadId == null
          ? get(environmentThreadShells.environmentThreadRefsAtom(environmentId))
          : [{ environmentId, threadId }];
    const threads = refs.flatMap((ref) => {
      const shell = get(environmentThreadShells.threadShellAtom(ref));
      return shell === null ? [] : [shell];
    });
    const keys = new Set(
      threads.map((thread) =>
        scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      ),
    );
    // The chat the attention names: read off an engine Mate's row where this page holds no shell.
    if (environmentId !== undefined && threadId != null)
      keys.add(scopedThreadKey({ environmentId, threadId }));
    if (overview?.identity !== undefined && overview.main)
      keys.add(
        scopedThreadKey({
          environmentId: overview.identity.environmentId,
          threadId: overview.main.id,
        }),
      );
    const visits = Object.fromEntries(
      [...keys].flatMap((key) => {
        const at = get(visitOfThreadAtom(key));
        return at === undefined ? [] : [[key, at]];
      }),
    );
    const activity = matesActivityOf({
      projectIds: [projectId],
      attention: { [projectId]: attention },
      overviews: overview === null ? null : new Map([[projectId, overview]]),
      hqCurrent: presence.live,
      threads,
      sockets: socket === null ? new Map() : new Map([[projectId, socket.id]]),
      standing: socket?.standing ? new Set([socket.id]) : new Set<EnvironmentId>(),
      lastVisitedAtById: visits,
    }).get(projectId);
    // The wake only invalidates the projection. The source deadline and current clock decide
    // whether this refusal still applies, including a tab that wakes after the deadline.
    const resetsAt = activity?.pausedUntil;
    if (resetsAt !== undefined && Date.parse(resetsAt) > Date.now()) {
      // Browser timers use a signed 32-bit millisecond delay. A distant provider deadline
      // can request another derivation at that bound; it cannot become an early reset.
      const delay = Math.min(Date.parse(resetsAt) - Date.now(), 2 ** 31 - 1);
      const timer = setTimeout(() => get.refreshSelf(), delay);
      const wake = () => get.refreshSelf();
      window.addEventListener("focus", wake);
      get.addFinalizer(() => {
        clearTimeout(timer);
        window.removeEventListener("focus", wake);
      });
    }
    return activity;
  }).pipe(Atom.withEquality(sameActivity)),
);

/** The tree reads only state, order, quiet membership and counts; row text has its own demand. */
export const mateMenuActivityAtom = Atom.family((projectId: string) =>
  Atom.make((get) => {
    const activity = get(mateActivityAtom(projectId));
    if (activity === undefined) return undefined;
    const {
      subject: _subject,
      snippet: _snippet,
      liveStep: _step,
      question: _question,
      errorLine: _error,
      ...facts
    } = activity;
    return { ...facts, subject: undefined, snippet: undefined };
  }).pipe(Atom.withEquality((a, b) => a === b || shareEqual(a, b) === a)),
);

export const matesMenuActivityAtom = Atom.make(
  (get) =>
    new Map(
      get(shownAttentionProjectsAtom).flatMap((id) => {
        const activity = get(mateMenuActivityAtom(id));
        return activity === undefined ? [] : [[id, activity] as const];
      }),
    ),
).pipe(
  Atom.withEquality(
    (a: ReadonlyMap<string, ZeropsAgentActivity>, b) =>
      a.size === b.size && [...a].every(([id, value]) => b.get(id) === value),
  ),
);

export const matesActivityAtom = Atom.make(
  (get) =>
    new Map(
      get(shownAttentionProjectsAtom).flatMap((id) => {
        const activity = get(mateActivityAtom(id));
        return activity === undefined ? [] : [[id, activity] as const];
      }),
    ),
).pipe(
  Atom.withEquality(
    (a: ReadonlyMap<string, ZeropsAgentActivity>, b) =>
      a.size === b.size && [...a].every(([id, value]) => b.get(id) === value),
  ),
);
