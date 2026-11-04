/**
 * What a Chief proposes, as its cards stand in its conversation at the owner's size (1786
 * wide, the left menu at 435, `?menu=` for another): a restart, a secret value, a service's plain
 * value, a message with an attachment to another Mate, and each outcome — running, done, failed,
 * declined, and an approval a reload interrupted. Below them, a project's Mate asking the person's
 * Chief: with a Chief, without one (*Set up Chief*), sent, and refused by HQ. Then the Chief
 * putting production on the person's domain: undecided, with another change waiting, and approved
 * at each step its domain goes through. First, the Chief proposing who has access to an
 * application: undecided, held for a name nobody in the organization has, and done. Every face is
 * the mark there; the receiving Mate keeps its own. The secret and the domain act on production.
 * The main press answers after 900 ms; `?fail=1` refuses it. `?theme=dark` for dark. At the top,
 * a Mate proposing to show the person a production secret, in each of its states — the first one
 * live: Reveal shows an example value for half a minute; `?only=reveal` draws those alone. Then a
 * Mate proposing an MCP server for its agents: with a key to type, proposed for the whole project,
 * waiting for a sign-in and its paste fallback, connected, and failed; `?only=mcp` shows those
 * alone.
 *
 * Served by the dev server at `/design-proposal.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { ProviderDriverKind } from "@t3tools/contracts";
import { McpProposalCard } from "~/components/zerops/proposal/McpProposalCard";
import {
  mcpAskFace,
  mcpProgress,
  mcpProposalView,
  type McpProposal,
  type McpProposalStatus,
  type McpSigning,
} from "~/components/zerops/proposal/mcpProposal.logic";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { recordsOf } from "~/components/zerops/addresses/addresses.logic";
import { MateFace, MateFaceAsMark } from "~/components/zerops/primitives";
import { Button } from "~/components/ui/button";
import {
  ProposalCard,
  type ProposalCardProps,
  type ProposalRecipient,
} from "~/components/zerops/proposal/ProposalCard";
import type { ProposalStage } from "~/components/zerops/proposal/proposal.logic";
import { RevealAskCard } from "~/components/zerops/proposal/RevealAskCard";
import {
  revealAskState,
  type RevealAuthority,
  type RevealPhase,
} from "~/components/zerops/proposal/reveal.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const FAIL = params.get("fail") === "1";
const MENU = Number(params.get("menu") ?? 435);
const ONLY_MCP = params.get("only") === "mcp";

const LINEAR: McpProposal = {
  id: "mcp-linear",
  kind: "mcp.add",
  summary: "Set up Linear",
  reason: "So I can read the issues you link and move them along as the work lands.",
  projectId: "p-juno",
  params: {
    scope: "mate",
    server: {
      name: "linear",
      title: "Linear",
      transport: { type: "http", url: "https://mcp.linear.app/mcp" },
      auth: { kind: "oauth" },
    },
    credentials: [],
  },
};

const SENTRY: McpProposal = {
  ...LINEAR,
  id: "mcp-sentry",
  summary: "Set up Sentry",
  reason: "To read production's errors myself instead of asking you to paste them.",
  params: {
    scope: "mate",
    server: {
      name: "sentry",
      title: "Sentry",
      transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      auth: { kind: "header" },
    },
    credentials: [
      {
        key: "SENTRY_TOKEN",
        label: "Sentry auth token",
        placement: "header",
        headerName: "Authorization",
        prefix: "Bearer ",
      },
    ],
  },
};

const MCP_CARDS: ReadonlyArray<{
  readonly id: string;
  readonly proposal: McpProposal;
  readonly status: McpProposalStatus;
  readonly signing?: McpSigning;
}> = [
  { id: "sentry-proposed", proposal: SENTRY, status: { kind: "proposed" } },
  {
    id: "sse-proposed",
    proposal: {
      ...LINEAR,
      id: "mcp-sse",
      params: {
        ...LINEAR.params,
        server: {
          ...LINEAR.params.server,
          transport: { type: "sse", url: "https://mcp.linear.app/sse" },
        },
      },
    },
    status: { kind: "proposed" },
  },
  {
    id: "own-app-proposed",
    proposal: {
      ...LINEAR,
      id: "mcp-own-app",
      params: {
        ...LINEAR.params,
        server: { ...LINEAR.params.server, auth: { kind: "oauth-app", scopes: ["read"] } },
      },
    },
    status: { kind: "proposed" },
  },
  { id: "linear-adding", proposal: LINEAR, status: { kind: "adding" } },
  {
    id: "linear-project",
    proposal: { ...LINEAR, params: { ...LINEAR.params, scope: "project" } },
    status: { kind: "proposed" },
  },
  { id: "linear-sign-in", proposal: LINEAR, status: { kind: "needs-sign-in", agent: "Claude" } },
  {
    id: "linear-signing",
    proposal: LINEAR,
    status: { kind: "needs-sign-in", agent: "Claude" },
    signing: { phase: "mate", url: "https://linear.app/oauth/authorize" },
  },
  {
    id: "linear-paste",
    proposal: LINEAR,
    status: { kind: "needs-sign-in", agent: "Codex" },
    signing: { phase: "paste", url: "https://linear.app/oauth/authorize", finishing: false },
  },
  {
    id: "linear-connected",
    proposal: LINEAR,
    status: { kind: "connected", tools: 23, agents: ["Claude", "Codex"] },
  },
  {
    id: "sentry-failed",
    proposal: SENTRY,
    status: { kind: "failed", words: "HTTP 401: Invalid token", agent: "Codex" },
  },
  { id: "linear-declined", proposal: LINEAR, status: { kind: "declined" } },
];

/** The Mate's installed agents in the harness: who an added server is written for. */
const MCP_AGENTS = [
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
  ProviderDriverKind.make("opencode"),
];
const MCP_DENSITY = params.get("density") === "compact" ? "compact" : "full";

function McpCard(card: (typeof MCP_CARDS)[number]) {
  const signing = card.signing ?? { phase: "idle" as const };
  const view = mcpProposalView({
    proposal: card.proposal,
    mateName: "Juno",
    status: card.status,
    signing,
    approveBlocked: undefined,
    agents: MCP_AGENTS,
  });
  const auth = card.proposal.params.server.auth.kind;
  const drawn = (
    <McpProposalCard
      askId={card.proposal.id}
      density={MCP_DENSITY}
      face={mcpAskFace({
        view,
        status: card.status,
        signing,
        busy: false,
        title: card.proposal.params.server.title,
        signsIn: auth === "oauth" || auth === "oauth-app",
        keyed: card.proposal.params.credentials.length > 0,
        by: "Aleš",
        at: "15:20",
      })}
      mateFace={<MateFace size={24} state="needs" tint="sky" />}
      onAdd={() => undefined}
      onChangeKey={async () => true}
      onTryAgain={() => undefined}
      onDecline={() => undefined}
      onFinishSignIn={() => undefined}
      onOpenAgain={() => undefined}
      onSignIn={() => undefined}
      onShowInConversation={MCP_DENSITY === "compact" ? () => undefined : undefined}
      progress={mcpProgress(
        card.proposal,
        card.status,
        card.status.kind === "needs-sign-in" ? card.status.agent : null,
      )}
      signing={signing}
      view={view}
    />
  );
  return MCP_DENSITY === "compact" ? (
    <div className="w-full overflow-hidden rounded-3xl border border-border bg-card">
      {drawn}
      <div className="px-4 pt-3 pb-8 text-placeholder text-sm">Ask anything...</div>
    </div>
  ) : (
    drawn
  );
}

const ONLY_REVEAL = params.get("only") === "reveal";

const RESTART: ZeropsProposal = {
  id: "restart",
  kind: "service.restart",
  summary: "Restart medusa in Contoso",
  reason: "Its memory has climbed for an hour and it stopped answering health checks at 10:42.",
  projectId: "p-contoso",
  projectName: "Contoso",
  serviceId: "s-medusa",
  serviceName: "medusa",
};

const SECRET: ZeropsProposal = {
  id: "secret",
  kind: "env.set",
  summary: "Set STRIPE_SECRET_KEY for every app in Contoso",
  reason: "Checkout fails with an expired key; you pasted the new one above.",
  projectId: "p-contoso",
  projectName: "Contoso",
  params: { scope: "project", key: "STRIPE_SECRET_KEY", value: "sk_live_51Hx", secret: true },
};

const PLAIN: ZeropsProposal = {
  id: "plain",
  kind: "env.set",
  summary: "Turn debug logging on for api in Shop",
  projectId: "p-shop",
  projectName: "Shop",
  serviceId: "s-api",
  serviceName: "api",
  params: { scope: "service", key: "LOG_LEVEL", value: "debug", secret: false },
};

const MESSAGE: ZeropsProposal = {
  id: "message",
  kind: "mate.message",
  summary: "Ask Rossy to debug the checkout errors in prod",
  reason: "Rossy built the checkout and its prod logs show 500s since the 10:30 release.",
  projectId: "p-shop",
  projectName: "Shop",
  params: {
    to: { projectId: "p-shop", mateName: "Rossy" },
    words:
      "Prod's checkout has answered 500 since the 10:30 release. The excerpt below is the api's log around the first failure. Please find out why and fix it.",
    attachment: {
      title: "prod · api · 10:29–10:33",
      text: [
        "10:29:58 INFO  POST /checkout 200 182ms",
        "10:30:41 INFO  release v1.18.0 active",
        "10:31:02 ERROR POST /checkout 500 TypeError: Cannot read properties of undefined (reading 'currency')",
        "10:31:02 ERROR     at priceOf (/app/dist/cart.js:88:31)",
        "10:31:07 ERROR POST /checkout 500 TypeError: Cannot read properties of undefined (reading 'currency')",
        "10:33:12 WARN  stripe webhook retry 3/5",
      ].join("\n"),
    },
  },
};

const ASK_CHIEF: ZeropsProposal = {
  id: "ask-chief",
  kind: "chief.message",
  summary: "Ask your Chief which project owns the orders table",
  reason: "Shop and Contoso both write to it, and I should not change its schema alone.",
  projectId: "p-shop",
  projectName: "Shop",
  params: {
    words:
      "Shop and Contoso both write the orders table. Which project owns its schema, and who should approve the migration below?",
    attachment: {
      title: "migration · 0042_orders_currency.sql",
      text: "ALTER TABLE orders ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR';",
    },
  },
};

const DOMAIN: ZeropsProposal = {
  id: "domain",
  kind: "domain.add",
  summary: "Put Contoso - production on contoso.com and www.contoso.com",
  reason: "The shop passed its stage checks; it is ready for its own name.",
  projectId: "p-contoso-prod",
  projectName: "Contoso - production",
  serviceId: "s-medusa",
  serviceName: "medusa",
  params: { domains: ["contoso.com", "www.contoso.com"], port: 9000 },
};

const ROSSY: ProposalRecipient = { name: "Rossy", tint: "coral", shape: "gem" };

const STOP: ZeropsProposal = {
  ...RESTART,
  id: "stop",
  kind: "service.stop",
  summary: "Stop worker in Contoso",
  reason: "It retries a dead queue and fills the log.",
  serviceName: "worker",
};

const ACCESS: ZeropsProposal = {
  id: "access",
  kind: "access.set",
  summary: "Access to Shop Front: Dana full access, Greta read only",
  reason: "Dana starts on the app today; Greta reviews it.",
  projectId: "p-prod",
  projectName: "Shop Front",
  params: {
    projects: [
      { id: "p-prod", name: "Shop Front - production" },
      { id: "p-stage", name: "Shop Front - stage" },
      { id: "p-alba", name: "Shop Front - Alba" },
    ],
    people: [
      { person: "Dana", level: "full" },
      { person: "Greta", level: "read" },
    ],
  },
};

const CARDS: ReadonlyArray<{
  readonly proposal: ZeropsProposal;
  readonly stage: ProposalStage;
  readonly failure?: string;
  /** `chief.message`: the person has no Chief, so setting one up stands in for Approve. */
  readonly chiefTarget?: ProposalCardProps["chiefTarget"];
  /** HQ did not keep the person's last decision. */
  readonly refusal?: string;
  readonly readOnlyReason?: string;
  readonly domainAlso?: string;
  readonly domainState?: ProposalCardProps["domainState"];
  readonly domainRecords?: ProposalCardProps["domainRecords"];
  readonly approveBlocked?: string;
}> = [
  { proposal: ACCESS, stage: "open" },
  {
    proposal: { ...ACCESS, id: "access-unknown" },
    stage: "open",
    approveBlocked: "No one in your organization is Greta. Invite them from Team, then ask again.",
  },
  { proposal: { ...ACCESS, id: "access-done" }, stage: "done" },
  { proposal: RESTART, stage: "open" },
  { proposal: SECRET, stage: "open" },
  { proposal: PLAIN, stage: "open" },
  { proposal: MESSAGE, stage: "open" },
  { proposal: { ...RESTART, id: "r2" }, stage: "running" },
  { proposal: { ...MESSAGE, id: "m2" }, stage: "done" },
  { proposal: { ...PLAIN, id: "p2" }, stage: "done" },
  {
    proposal: STOP,
    stage: "failed",
    failure: "Service stack is in a state that does not allow this action.",
  },
  { proposal: { ...SECRET, id: "s2" }, stage: "declined" },
  { proposal: { ...RESTART, id: "r3" }, stage: "unseen" },
  { proposal: ASK_CHIEF, stage: "open", chiefTarget: { kind: "chief", projectId: "p-chief" } },
  {
    proposal: { ...ASK_CHIEF, id: "ask-reader" },
    stage: "open",
    readOnlyReason: "Only this Mate's person can ask their Chief.",
    chiefTarget: { kind: "chief", projectId: "p-chief" },
  },
  {
    proposal: { ...ASK_CHIEF, id: "ask-reading" },
    stage: "open",
    readOnlyReason: "Finding this Mate's Chief…",
  },
  { proposal: { ...ASK_CHIEF, id: "ask-none" }, stage: "open", chiefTarget: { kind: "none" } },
  { proposal: { ...ASK_CHIEF, id: "ask-sent" }, stage: "done" },
  {
    proposal: { ...ASK_CHIEF, id: "ask-refused" },
    stage: "open",
    refusal: "HQ could not keep your decision, so nothing ran. Try again.",
    chiefTarget: { kind: "chief", projectId: "p-chief" },
  },
  { proposal: DOMAIN, stage: "open" },
  {
    proposal: { ...DOMAIN, id: "domain-also" },
    stage: "open",
    domainAlso: "Approving also puts in place: Removing api.contoso.com.",
  },
  { proposal: { ...DOMAIN, id: "domain-running" }, stage: "running" },
  {
    proposal: { ...DOMAIN, id: "domain-dns" },
    stage: "done",
    domainState: {
      tone: "waiting",
      words: "Waiting for your DNS. Add contoso.com's records at your DNS provider.",
    },
    // A project whose zone leaves the shared IPv4 out, as most do: the CNAME waits on it.
    domainRecords: recordsOf([{ domainName: "contoso.com" }, { domainName: "www.contoso.com" }], {
      v6: "2001:db8:4a7:1d::1",
      sharedV4: "93.185.106.128",
      zone: "k3f9x2.prg1-zerops.zone",
      zoneHasSharedV4: false,
    }),
  },
  {
    proposal: { ...DOMAIN, id: "domain-elsewhere" },
    stage: "done",
    domainState: {
      tone: "problem",
      words: "contoso.com points elsewhere. Change its records at your DNS provider.",
    },
  },
  {
    proposal: { ...DOMAIN, id: "domain-certificate" },
    stage: "done",
    domainState: {
      tone: "working",
      words: "Your DNS is right. contoso.com's certificate is on its way…",
    },
  },
  {
    proposal: { ...DOMAIN, id: "domain-live" },
    stage: "done",
    domainState: { tone: "live", words: "contoso.com and www.contoso.com are live." },
  },
];

function Card(card: (typeof CARDS)[number]) {
  const [stage, setStage] = useState<ProposalStage>(card.stage);
  const [failure, setFailure] = useState(card.failure);
  return (
    <ProposalCard
      approveBlocked={card.approveBlocked}
      chiefTarget={card.chiefTarget}
      decidedAt={stage === "open" ? null : "15:02"}
      decidedBy={stage === "open" ? null : "Aleš"}
      domainAlso={card.domainAlso}
      domainState={card.domainState}
      domainRecords={card.domainRecords}
      failure={failure}
      onOpenAddresses={card.proposal.kind === "domain.add" ? () => undefined : undefined}
      readOnlyReason={card.readOnlyReason}
      mateName="Fen"
      onApprove={() => {
        setStage("running");
        setTimeout(() => {
          if (FAIL) {
            setFailure("Zerops refused it: the service is not running.");
            setStage("failed");
          } else setStage("done");
        }, 900);
      }}
      onDecline={() => setStage("declined")}
      onOpenRecipient={() => undefined}
      onSetUpChief={card.chiefTarget?.kind === "none" ? () => undefined : undefined}
      proposal={card.proposal}
      recipient={card.proposal.kind === "mate.message" ? ROSSY : undefined}
      refusal={card.refusal}
      stage={stage}
      // The secret and the domain act on Contoso's production: its chip and press are red.
      tier={
        card.proposal.id === "secret" || card.proposal.kind === "domain.add" ? "production" : null
      }
    />
  );
}

// ── reveal ───────────────────────────────────────────────────────────────────────────────────

const REVEAL: Extract<ZeropsProposal, { kind: "env.reveal" }> = {
  id: "reveal",
  kind: "env.reveal",
  summary: "Show DATABASE_PASSWORD from Production",
  reason: "You asked for it to connect from your laptop. I can't see it; only you can.",
  projectId: "p-prod",
  projectName: "Production",
  serviceId: "s-db",
  serviceName: "db",
  params: { scope: "service", key: "DATABASE_PASSWORD" },
};
/** An example value, never a real one. */
const EXAMPLE = ["Hk7q", "2mVz", "example", "only"].join("-");
const MAY: RevealAuthority = { kind: "may" };
const REVEALED = { state: "running", at: "2026-11-04T15:32:00.000Z" } as const;

const REVEALS: ReadonlyArray<{
  readonly name: string;
  readonly phase: RevealPhase;
  readonly decided?: "revealed" | "notNow";
  readonly authority?: RevealAuthority;
}> = [
  { name: "waiting", phase: { kind: "idle" } },
  { name: "revealing", phase: { kind: "revealing" } },
  { name: "confirm", phase: { kind: "confirming" } },
  { name: "hidden", phase: { kind: "idle" }, decided: "revealed" },
  { name: "failed", phase: { kind: "failed", words: "Couldn't show it. Try again." } },
  {
    name: "refused",
    phase: { kind: "refused", words: "Your role in this organization can't show secrets." },
  },
  { name: "notNow", phase: { kind: "idle" }, decided: "notNow" },
  {
    name: "others",
    phase: { kind: "idle" },
    authority: {
      kind: "others",
      rule: "Only people with production access can reveal this.",
      names: ["Petr"],
    },
  },
];

function Reveal(fixture: (typeof REVEALS)[number]) {
  const [phase, setPhase] = useState(fixture.phase);
  const [decided, setDecided] = useState(fixture.decided);
  const decision =
    decided === "revealed"
      ? REVEALED
      : decided === "notNow"
        ? ({ state: "declined", at: REVEALED.at } as const)
        : undefined;
  const state = revealAskState({
    phase,
    decision,
    by: decision === undefined ? null : "Aleš",
    at: decision === undefined ? null : "15:32",
    authority: fixture.authority ?? MAY,
  });
  return (
    <RevealAskCard
      confirm={
        <Button onClick={() => setPhase({ kind: "shown" })} size="sm" variant="secondary">
          Confirm in Zerops
        </Button>
      }
      homeProjectId="p-mate"
      mateName="Juno"
      mayReveal={(fixture.authority ?? MAY).kind === "may"}
      mayRetry={phase.kind !== "stuck"}
      onHide={() => setPhase({ kind: "idle" })}
      onNotNow={() => setDecided("notNow")}
      onReveal={() => {
        setPhase({ kind: "revealing" });
        setTimeout(() => {
          setDecided("revealed");
          setPhase({ kind: "shown" });
        }, 900);
      }}
      proposal={{ ...REVEAL, id: `reveal-${fixture.name}` }}
      state={state}
      tier="production"
      value={phase.kind === "shown" ? EXAMPLE : null}
    />
  );
}

function Harness() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-8">
        <MateFaceAsMark value>
          <div className="mx-auto grid w-full max-w-3xl gap-3">
            {(ONLY_MCP ? [] : REVEALS).map((fixture) => (
              <div
                className="min-w-0 px-1 py-0.5"
                data-harness-state={`reveal:${fixture.name}`}
                key={fixture.name}
              >
                <Reveal {...fixture} />
              </div>
            ))}
            {(ONLY_REVEAL ? [] : MCP_CARDS).map((card) => (
              <div className="min-w-0 px-1 py-0.5" data-harness-state={card.id} key={card.id}>
                <McpCard {...card} />
              </div>
            ))}
            {(ONLY_MCP || ONLY_REVEAL ? [] : CARDS).map((card) => (
              <div
                className="min-w-0 px-1 py-0.5"
                data-harness-state={`${card.proposal.id}:${card.stage}`}
                key={card.proposal.id}
              >
                <Card {...card} />
              </div>
            ))}
          </div>
        </MateFaceAsMark>
      </div>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
