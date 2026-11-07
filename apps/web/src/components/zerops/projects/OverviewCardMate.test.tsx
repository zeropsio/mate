import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as menuReadings from "~/zerops/useMenuMateReadings";
import * as owners from "~/zerops/useZeropsMateOwners";
import * as deleting from "~/zerops/deletingMates";
import * as moments from "~/zerops/useMateMoments";
import * as clock from "~/zerops/useNowMs";
import * as settings from "~/hooks/useSettings";
import * as ask from "~/zerops/useAskMate";
import * as fix from "~/zerops/fixRequest";
import * as review from "~/zerops/review";
import * as agentActivity from "~/zerops/useZeropsAgentActivity";
import * as sessionProvider from "~/zerops/ZeropsSessionProvider";
import * as mateWrite from "~/zerops/useMateWrite";

const linked = vi.hoisted(() => ({ value: false }));
// Whose Mate it is, as HQ's people name it, and who is looking.
const people = vi.hoisted(() => ({
  value: { waitsOnViewer: true, owner: null } as {
    waitsOnViewer: boolean | undefined;
    everSignedIn?: Readonly<Record<string, string>>;
    owner: { userId: string; name: string; avatarUrl: string | null } | null;
  },
}));
const session = vi.hoisted(() => ({ value: null as { user: { id: string } } | null }));

const activityReading = vi.hoisted(() => ({
  value: undefined as import("~/zerops/agentActivity").ZeropsAgentActivity | undefined,
}));

// The menu row's own reads, as a card reads them for the same Mate.
beforeEach(() => {
  vi.spyOn(menuReadings, "useMateLinkedInHq").mockImplementation(() => linked.value);
  vi.spyOn(menuReadings, "useMateOverviewInHq").mockReturnValue("live");
  vi.spyOn(menuReadings, "useMateOfflineSince").mockReturnValue(undefined);
  vi.spyOn(menuReadings, "useMateAwayNow").mockReturnValue(0);
  vi.spyOn(owners, "useHqProjectPerson").mockImplementation(
    () => people.value as unknown as ReturnType<typeof owners.useHqProjectPerson>,
  );
  vi.spyOn(deleting, "useDeletingMates").mockReturnValue(new Set());
  vi.spyOn(deleting, "mateDeleting").mockReturnValue(false);
  vi.spyOn(moments, "useMateFaceWatch").mockReturnValue({
    restarting: false,
    updating: false,
    watched: { backs: 0, moved: undefined, arrived: undefined },
  });
  vi.spyOn(clock, "useNowMs").mockReturnValue(0);
  vi.spyOn(clock, "useSecondsNowMs").mockReturnValue(0);
  vi.spyOn(settings, "useClientSettings").mockImplementation(((
    select: (settings: { timestampFormat: string }) => unknown,
  ) => select({ timestampFormat: "locale" })) as unknown as typeof settings.useClientSettings);
  vi.spyOn(ask, "useAskMate").mockReturnValue(() => {});
  vi.spyOn(fix, "useAskMateToFix").mockReturnValue(() => {});
  vi.spyOn(review, "useOpenReview").mockReturnValue(() => {});
  vi.spyOn(agentActivity, "useProjectMateActivity").mockImplementation(() => activityReading.value);
  vi.spyOn(sessionProvider, "useZeropsSessionOptional").mockImplementation(
    () => session.value as ReturnType<typeof sessionProvider.useZeropsSessionOptional>,
  );
  vi.spyOn(mateWrite, "useMateWrite").mockReturnValue({ requests: {} } as ReturnType<
    typeof mateWrite.useMateWrite
  >);
});
afterEach(() => {
  linked.value = false;
  people.value = { waitsOnViewer: true, owner: null };
  session.value = null;
  activityReading.value = undefined;
  vi.restoreAllMocks();
});

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { overviewAgentActivity } from "~/zerops/agentActivity";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";

import { pull } from "./flowTestFixtures";
import { OverviewCardMate } from "./OverviewCardMate";

function ada(group: ZeropsCandidate["group"]): ZeropsCandidate {
  return {
    key: "ada:zcp",
    group,
    project: { id: "ada", name: "Ada", status: "ACTIVE", tagList: [] },
  } as ZeropsCandidate;
}

const decodeMateView = Schema.decodeUnknownSync(MateLiveView);

const faceOf = (markup: string) => /data-mate-face-state="([^"]+)"/u.exec(markup)?.[1];

describe("a Mate on its card", () => {
  // One Mate wears one face: the card reads it as the menu row does (`mateAwake`, `mateFace`).
  it.each([
    { case: "HQ holds its link open", group: "unavailable", hq: true, face: "idle" },
    { case: "its container runs", group: "ready", hq: false, face: "idle" },
    { case: "neither", group: "unavailable", hq: false, face: "sleep" },
  ] as const)("wears the face its menu row wears: $case", ({ group, hq, face }) => {
    linked.value = hq;
    const markup = renderToStaticMarkup(
      <OverviewCardMate
        candidate={ada(group)}
        change={undefined}
        containerActions={null}
        containerLine={undefined}
        conversationsRead
        flow={undefined}
        groupId="shop"
        name="Ada"
        onOpen={undefined}
        outsideHq={false}
        shape={undefined}
        tint="sky"
      />,
    );
    expect(faceOf(markup)).toBe(face);
    expect(markup).toContain("Nothing asked yet");
  });

  // One state, one word (run 2): a container's own line said "Almost there." on the card while
  // the menu said "Coming up" for the same Mate on the same screen.
  it("says a Mate coming up in its menu row's words, whatever its container says", () => {
    linked.value = false;
    const markup = renderToStaticMarkup(
      <OverviewCardMate
        candidate={ada("provisioning")}
        change={undefined}
        coming={{ kind: "coming", line: "Coming up. A few minutes." }}
        containerActions={null}
        containerLine={<span>Almost there.</span>}
        conversationsRead
        flow={undefined}
        groupId="shop"
        name="Ada"
        onOpen={undefined}
        outsideHq={false}
        shape={undefined}
        tint="sky"
      />,
    );
    expect(markup).toContain("Coming up");
    expect(markup).not.toContain("Almost there.");
  });

  // A card says of its Mate what its menu row says: the corner of its face, its change, the place
  // its time stands in — so the two never disagree (live run, 2026-10-11).
  const card = (change: ReturnType<typeof pull> | undefined) =>
    renderToStaticMarkup(
      <OverviewCardMate
        candidate={
          {
            ...ada("ready"),
            service: { id: "zcp", name: "zcp", status: "ACTIVE" },
          } as ZeropsCandidate
        }
        change={change}
        containerActions={null}
        containerLine={undefined}
        conversationsRead
        flow={undefined}
        groupId="shop"
        name="Ada"
        onOpen={undefined}
        outsideHq={false}
        shape={undefined}
        tint="sky"
      />,
    );
  describe("Projects source states", () => {
    it("Projects shows the Mate's limit, latest outcome and missing sign-in from its records", () => {
      linked.value = true;
      session.value = { user: { id: "me" } };
      people.value = { waitsOnViewer: true, owner: null, everSignedIn: {} };
      const main = {
        id: "thread-Ada",
        title: "Redesign checkout",
        interactionMode: "default",
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        backgroundLiveness: null,
        planProgress: null,
        pendingQuestion: null,
        usagePause: null,
        liveStep: null,
        latestUserMessageAt: "2026-10-06T12:00:00Z",
        updatedAt: "2026-10-06T12:00:00Z",
        latestUserMessagePreview: { text: "Redesign checkout" },
        latestMessagePreview: null,
        latestTurn: {
          turnId: "limited",
          state: "error",
          requestedAt: "2026-10-06T12:00:00Z",
          startedAt: "2026-10-06T12:00:00Z",
          completedAt: "2026-10-06T12:01:00Z",
          assistantMessageId: null,
        },
        session: { status: "error", lastError: "Claude usage limit reached" },
      };
      const record = (patch: object) =>
        decodeMateView({
          presence: { online: true, since: "2026-10-06T12:00:00Z", overview: "live" },
          identity: { environmentId: "env-Ada", serverVersion: "0.14.35", update: null },
          main: { ...main, ...patch },
        });
      try {
        activityReading.value = overviewAgentActivity(record({}), false, {});
        let markup = card(undefined);
        expect(markup).toContain("Ada hit the Claude limit.");
        activityReading.value = overviewAgentActivity(
          record({
            session: { status: "ready", lastError: null },
            latestTurn: { ...main.latestTurn, turnId: "finished", state: "completed" },
            latestMessagePreview: {
              role: "assistant",
              text: "Checkout is redesigned and verified.",
            },
          }),
          false,
          {},
        );
        markup = card(undefined);
        expect(markup).toContain("Checkout is redesigned and verified.");
        expect(markup).not.toContain("Ada hit the Claude limit.");
        activityReading.value = undefined;
        const candidate = {
          ...ada("ready"),
          service: { id: "zcp", name: "zcp", status: "ACTIVE" },
          project: {
            ...ada("ready").project,
            hq: {
              appId: "shop",
              appName: "Shop",
              kind: "mate" as const,
              mate: {
                face: "",
                madeBy: "me",
                logins: { "claude-code": { present: false, signedInBy: null, token: false } },
              },
            },
          },
        } satisfies ZeropsCandidate;
        markup = renderToStaticMarkup(
          <OverviewCardMate
            candidate={candidate}
            change={undefined}
            containerActions={null}
            containerLine={undefined}
            conversationsRead
            flow={undefined}
            groupId="shop"
            name="Ada"
            onOpen={undefined}
            outsideHq={false}
            shape={undefined}
            tint="sky"
          />,
        );
        expect(markup).toContain("Waiting for your sign-in");
        expect(markup).not.toContain("Ada hit the Claude limit.");
        expect(markup).not.toContain("Checkout is redesigned and verified.");
      } finally {
        activityReading.value = undefined;
        session.value = null;
        linked.value = false;
      }
    });
  });

  const KAREL = { userId: "karel", name: "Alex Novak", avatarUrl: null };

  it.each([
    { case: "the viewer's own", owner: { ...KAREL, userId: "me" }, waits: false, mark: false },
    { case: "a colleague's", owner: KAREL, waits: false, mark: true },
  ])("wears its owner's mark as its menu row does: none on $case", ({ owner, waits, mark }) => {
    linked.value = false;
    session.value = { user: { id: "me" } };
    people.value = { waitsOnViewer: waits, owner };
    expect(card(undefined).includes('data-zerops-surface="sidebar-mate-owner"')).toBe(mark);
  });

  it("names a colleague's change with its Review at the change's end, its time in its place, as its row does", () => {
    linked.value = false;
    session.value = { user: { id: "me" } };
    people.value = { waitsOnViewer: false, owner: KAREL };
    const markup = card(pull({ title: "Formbox: drag and drop" }));
    const change = markup.indexOf('data-zerops-surface="card-mate-change"');
    expect(change).toBeGreaterThan(-1);
    expect(markup.indexOf("Formbox: drag and drop · in review")).toBeGreaterThan(change);
    expect(markup.indexOf('data-zerops-surface="card-mate-review"')).toBeGreaterThan(change);
    expect(markup).toContain('data-zerops-surface="card-mate-time"');
  });

  it("names the viewer's change it lifts, with one Review: no time beside it", () => {
    linked.value = false;
    session.value = { user: { id: "me" } };
    people.value = { waitsOnViewer: true, owner: { ...KAREL, userId: "me" } };
    const markup = card(pull({ title: "Build a reading list" }));
    expect(markup).toContain("Build a reading list");
    expect(markup).toContain('data-lift="review"');
    expect(markup).not.toContain('data-zerops-surface="card-mate-review"');
  });

  // The card read the Mate as if nothing waited in its composer, while its menu row led with the
  // draft (round 5's follow-ups, 2026-10-11).
  it("says the draft waiting in its Mate's composer, as its menu row does", () => {
    linked.value = false;
    session.value = { user: { id: "me" } };
    people.value = { waitsOnViewer: true, owner: { ...KAREL, userId: "me" } };
    const draft = DraftId.make("draft-ada");
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(
      scopeProjectRef(EnvironmentId.make("env-ada"), ProjectId.make("project-ada")),
      draft,
      { threadId: ThreadId.make("thread-new"), createdAt: new Date().toISOString() },
    );
    store.setPrompt(draft, "set up a staging");
    try {
      // Mounted: the composer's store is the browser's, which a static render never reads.
      let tree: ReactTestRenderer | undefined;
      act(() => {
        tree = create(
          <OverviewCardMate
            candidate={
              {
                ...ada("ready"),
                environmentId: "env-ada",
                service: { id: "zcp", name: "zcp", status: "ACTIVE" },
              } as ZeropsCandidate
            }
            change={undefined}
            containerActions={null}
            containerLine={undefined}
            conversationsRead
            flow={undefined}
            groupId="shop"
            name="Ada"
            onOpen={undefined}
            outsideHq={false}
            shape={undefined}
            tint="sky"
          />,
        );
      });
      const said = JSON.stringify(tree?.toJSON());
      tree?.unmount();
      expect(said).toContain("Draft: set up a staging");
      expect(said).not.toContain("Nothing asked yet");
    } finally {
      store.setPrompt(draft, "");
      store.clearDraftThread(draft);
    }
  });
});
