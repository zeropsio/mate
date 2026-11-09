/**
 * A Mate's two asks about its application's production, in each state the cards stand in —
 * waiting, working, failed, done, replaced, someone else's, Not now — and the conversation
 * hearing how a release ended. Every state is read through the cards' own logic
 * (`productionAsk.logic`) from made-up sources: HQ's plan, the flow's releases, the decision
 * record. Drawn by the proposal harness (`/design-proposal.html?only=production`). Fixtures only:
 * nothing here ships.
 */
import type { ReleaseEndedEvent } from "@t3tools/client-runtime/zerops";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import type { ReactNode } from "react";

import { EventLine } from "~/components/chat/ConversationRows";
import { MateFace } from "~/components/zerops/primitives";
import {
  askedCreations,
  releaseOfferView,
  serviceCreateView,
  type ReleaseOfferLive,
  type ServiceCreatePlan,
  type ServiceCreateRun,
} from "~/components/zerops/proposal/productionAsk.logic";
import {
  ReleaseOfferAskCard,
  ServiceCreateAskCard,
} from "~/components/zerops/proposal/ProductionAskCards";
import type { ProposalDecision } from "~/components/zerops/proposal/proposal.logic";
import { servicePlanImportYaml } from "~/zerops/releaseImport.logic";

const HEAD = "4f".repeat(20);
const MOVED = "9c".repeat(20);
const ASKED_AT = "2026-11-08T14:00:00.000Z";
const NOW_MS = Date.parse("2026-11-08T14:21:40.000Z");

const CREATE: Extract<ZeropsProposal, { kind: "service.create" }> = {
  id: "create",
  kind: "service.create",
  summary: "Create db in Production",
  reason:
    "The People change keeps invitations in a database. Production has none yet, so the next release needs it first.",
  projectId: "p-prod",
  projectName: "Production",
  params: { services: ["db"], recipeHead: HEAD },
};

const CREATE_TWO = {
  ...CREATE,
  params: { services: ["db", "cache"], recipeHead: HEAD },
};

const DB = {
  kind: "create" as const,
  service: "db",
  settings: { hostname: "db", type: "postgresql@18", mode: "HA" },
  cost: "Adds one billed service.",
};
const CACHE = {
  kind: "create" as const,
  service: "cache",
  settings: { hostname: "cache", type: "valkey@7.2", mode: "NON_HA" },
  cost: "Adds one billed service.",
};
const DEPLOY = { kind: "deploy" as const, service: "app", sha: "1a".repeat(20) };

const planOf = (...creations: ReadonlyArray<typeof DB | typeof CACHE>): ServiceCreatePlan => ({
  kind: "ready",
  plan: { hash: "0".repeat(64), operations: [...creations, DEPLOY] } satisfies ReleaseServicePlan,
});

const MAY = { allowed: true } as const;
const APPROVED: ProposalDecision = { state: "running", at: "2026-11-08T14:20:00.000Z" };

const CREATES: ReadonlyArray<{
  readonly name: string;
  readonly proposal?: typeof CREATE;
  readonly plan: ServiceCreatePlan;
  readonly run?: ServiceCreateRun;
  readonly decision?: ProposalDecision;
  readonly permission?: { readonly allowed: boolean; readonly reason?: string };
}> = [
  { name: "waiting", plan: planOf(DB) },
  { name: "waiting-two", proposal: CREATE_TWO, plan: planOf(DB, CACHE) },
  { name: "reading", plan: { kind: "reading" } },
  {
    name: "working",
    plan: planOf(DB),
    decision: APPROVED,
    run: { kind: "working", sinceMs: NOW_MS - 100_000 },
  },
  {
    name: "failed",
    plan: planOf(DB),
    decision: APPROVED,
    run: {
      kind: "failed",
      words:
        "Zerops could not create db: the hardware of this region has no room for a highly available PostgreSQL right now.",
    },
  },
  { name: "done", plan: planOf(), decision: { ...APPROVED, state: "done" } },
  { name: "exists", plan: planOf() },
  {
    name: "others",
    plan: { kind: "reading" },
    permission: { allowed: false, reason: "Only an owner or an admin can release Tea Shop." },
  },
  { name: "notNow", plan: planOf(DB), decision: { ...APPROVED, state: "declined" } },
];

function Create(fixture: (typeof CREATES)[number]) {
  const proposal = { ...(fixture.proposal ?? CREATE), id: `create-${fixture.name}` };
  const decided = fixture.decision !== undefined;
  const view = serviceCreateView({
    services: proposal.params.services,
    plan: fixture.plan,
    permission: fixture.permission ?? MAY,
    decision: fixture.decision,
    decisionKnown: true,
    run: fixture.run ?? { kind: "none" },
    nowMs: NOW_MS,
    liveTag: "v0.1.3",
    by: decided ? "Dana" : null,
    at: decided ? "15:20" : null,
  });
  return (
    <ServiceCreateAskCard
      mateName="Juno"
      onCreate={() => undefined}
      onNotNow={() => undefined}
      proposal={proposal}
      view={view}
      yaml={
        fixture.plan.kind === "ready"
          ? servicePlanImportYaml(askedCreations(fixture.plan.plan, proposal.params.services))
          : undefined
      }
    />
  );
}

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
  permission: MAY,
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
      more={0}
      now={view.state.kind === "done" ? undefined : { tag: "v0.1.3", since: "Nov 1" }}
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
      className="grid min-w-0 gap-2 rounded-xl border border-border px-4 py-3"
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
              of yours is lost. The database is the only thing missing: press Try again on the card
              above.
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
      <Section title="Create what production lacks">
        {CREATES.map((fixture) => (
          <div
            className="min-w-0 px-1 py-0.5"
            data-harness-state={`create:${fixture.name}`}
            key={fixture.name}
          >
            <Create {...fixture} />
          </div>
        ))}
      </Section>
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
