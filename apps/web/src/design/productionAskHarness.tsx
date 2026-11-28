/**
 * Release offer states and how a conversation shows the outcome of a release.
 * The proposal harness draws these fixtures at `/design-proposal.html?only=production`.
 */
import type { ReleaseEndedEvent } from "@t3tools/client-runtime/zerops";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { ReactNode } from "react";

import { EventLine } from "~/components/chat/ConversationRows";
import { MateFace } from "~/components/zerops/primitives";
import {
  releaseOfferView,
  type ReleaseOfferLive,
} from "~/components/zerops/proposal/productionAsk.logic";
import { ReleaseOfferAskCard } from "~/components/zerops/proposal/ProductionAskCards";
import type { ProposalDecision } from "~/zerops/proposalRecord";

const HEAD = "4f".repeat(20);
const MOVED = "9c".repeat(20);
const ASKED_AT = "2026-11-08T14:00:00.000Z";

const OFFER: Extract<ZeropsProposal, { kind: "release.offer" }> = {
  id: "offer",
  kind: "release.offer",
  summary: "Release v0.1.6 to production",
  reason: "The three changes you asked for are merged and the tests pass.",
  projectId: "p-juno",
  projectName: "Tea Shop",
  params: { head: HEAD, suggestion: "v0.1.6" },
};

const LIVE: ReleaseOfferLive = {
  head: HEAD,
  suggestion: "v0.1.6",
  gate: { allowed: true },
  permission: { allowed: true },
  inFlight: undefined,
  waiting: 3,
};

const face = (tint: "sky" | "coral"): ReactNode => <MateFace size={16} state="idle" tint={tint} />;
const CHANGES = [
  { key: "1", title: "Steer a bot while it answers", face: face("sky") },
  {
    key: "2",
    title: "Connect the calendar, the notes and the board in one step",
    face: face("sky"),
  },
  { key: "3", title: "A hidden browser for web work", face: face("coral") },
];
const FOURTH = { key: "4", title: "Invite people by a link", face: face("coral") };

const RELEASED = [{ tag: "v0.1.6", taggedAt: "2026-11-08T14:30:00.000Z" }];
const ended = (outcome: "live" | "failed", cause?: string): ReadonlyArray<ReleaseEndedEvent> => [
  {
    key: `release-ended:v0.1.6:${outcome}`,
    tag: "v0.1.6",
    outcome,
    taggedAt: "2026-11-08T14:30:00.000Z",
    endedAt: "2026-11-08T14:34:00.000Z",
    cause,
    stillRuns: outcome === "failed" ? "v0.1.3" : undefined,
  },
];

const OFFERS: ReadonlyArray<{
  readonly name: string;
  readonly live?: ReleaseOfferLive;
  readonly ended?: ReadonlyArray<ReleaseEndedEvent>;
  readonly releases?: typeof RELEASED;
  readonly newerAsk?: boolean;
  readonly decision?: ProposalDecision;
  readonly creates?: ReadonlyArray<string>;
  readonly changes?: typeof CHANGES;
}> = [
  { name: "waiting", creates: ["db"] },
  {
    name: "moved",
    live: { ...LIVE, head: MOVED, suggestion: "v0.1.6", waiting: 4 },
    changes: [FOURTH, ...CHANGES],
  },
  { name: "working", releases: RELEASED, live: { ...LIVE, inFlight: "v0.1.6", waiting: 0 } },
  {
    name: "failed",
    releases: RELEASED,
    ended: ended("failed", "db could not be created"),
  },
  {
    name: "done",
    releases: RELEASED,
    ended: ended("live"),
    live: {
      ...LIVE,
      gate: { allowed: false, reason: "Nothing waits for production." },
      waiting: 0,
    },
  },
  { name: "replaced", newerAsk: true },
  {
    name: "others",
    live: {
      ...LIVE,
      permission: { allowed: false, reason: "Only an owner or an admin can release Tea Shop." },
    },
  },
  { name: "notNow", decision: { state: "declined", at: "2026-11-08T14:05:00.000Z" } },
];

function Offer(fixture: (typeof OFFERS)[number]) {
  const proposal = { ...OFFER, id: `offer-${fixture.name}` };
  const decided = fixture.decision !== undefined;
  const view = releaseOfferView({
    params: proposal.params,
    askedAt: ASKED_AT,
    live: fixture.live ?? LIVE,
    ended: fixture.ended ?? [],
    releases: fixture.releases ?? [],
    newerAsk: fixture.newerAsk ?? false,
    decision: fixture.decision,
    decisionKnown: true,
    address: "https://tea.example.com",
    by: decided ? "Dana" : null,
    at: decided ? "15:05" : null,
  });
  const listed = view.state.kind === "waiting" || view.state.kind === "othersToAnswer";
  return (
    <ReleaseOfferAskCard
      changes={listed ? (fixture.changes ?? CHANGES) : []}
      creates={view.state.kind === "waiting" ? (fixture.creates ?? []) : []}
      mateName="Juno"
      // As the container counts: what is not listed is still counted.
      more={listed ? 0 : (fixture.changes ?? CHANGES).length}
      now={view.state.kind === "done" ? undefined : { tag: "v0.1.3" }}
      onNotNow={() => undefined}
      onReview={() => undefined}
      proposal={proposal}
      view={view}
    />
  );
}

const SPEAKER = { name: "Juno", tint: "sky" } as const;

const LINES: ReadonlyArray<ReleaseEndedEvent> = [
  {
    key: "release-ended:v0.1.5:failed",
    tag: "v0.1.5",
    outcome: "failed",
    taggedAt: "2026-11-08T13:10:00.000Z",
    endedAt: "2026-11-08T13:12:00.000Z",
    cause: "db could not be created",
    stillRuns: "v0.1.3",
  },
  {
    key: "release-ended:v0.1.5b:failed",
    tag: "v0.1.5",
    outcome: "failed",
    taggedAt: "2026-11-08T13:10:00.000Z",
    endedAt: "2026-11-08T13:12:00.000Z",
    cause: undefined,
    stillRuns: "v0.1.3",
  },
  {
    key: "release-ended:v0.1.6:live",
    tag: "v0.1.6",
    outcome: "live",
    taggedAt: "2026-11-08T14:30:00.000Z",
    endedAt: "2026-11-08T14:34:00.000Z",
    cause: undefined,
    stillRuns: undefined,
  },
];

/** The conversation hearing how a release ended, the Mate's answer under the first line. */
function Conversation() {
  return (
    <div
      className="grid min-w-0 gap-2 rounded-card border border-border px-4 py-3"
      data-harness-state="conversation:release-ended"
    >
      {LINES.map((event, index) => (
        <div className="grid min-w-0 gap-2" key={event.key}>
          <EventLine
            at={event.endedAt}
            event={{ type: "release", event }}
            speaker={SPEAKER}
            timestampFormat="locale"
          />
          {index !== 0 ? null : (
            <p className="text-body text-foreground">
              <span className="font-medium">Juno</span> · Production still runs v0.1.3 and nothing
              of yours is lost. The database is the only thing missing.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3">
      <h2 className="text-caption font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function ProductionAsks() {
  return (
    <>
      <Section title="Release, asked where the work ends">
        {OFFERS.map((fixture) => (
          <div
            className="min-w-0 px-1 py-0.5"
            data-harness-state={`offer:${fixture.name}`}
            key={fixture.name}
          >
            <Offer {...fixture} />
          </div>
        ))}
      </Section>
      <Section title="The conversation hears how a release ended">
        <Conversation />
      </Section>
    </>
  );
}
