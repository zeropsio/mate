/**
 * What a Mastermate proposes, as its cards stand in its conversation at the owner's size (1786
 * wide, the left menu at 435, `?menu=` for another): a restart, a secret value, a service's plain
 * value, a message with an attachment to another Mate, and each outcome — running, done, failed,
 * declined, and an approval a reload interrupted. Every face is the mark there; the receiving Mate
 * keeps its own. Approve answers after 900 ms; `?fail=1` refuses it. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-proposal.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { MateFaceAsMark } from "~/components/zerops/primitives";
import { ProposalCard, type ProposalRecipient } from "~/components/zerops/proposal/ProposalCard";
import type { ProposalStage } from "~/components/zerops/proposal/proposal.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const FAIL = params.get("fail") === "1";
const MENU = Number(params.get("menu") ?? 435);

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

const ROSSY: ProposalRecipient = { name: "Rossy", tint: "coral", shape: "gem" };

const STOP: ZeropsProposal = {
  ...RESTART,
  id: "stop",
  kind: "service.stop",
  summary: "Stop worker in Contoso",
  reason: "It retries a dead queue and fills the log.",
  serviceName: "worker",
};

const CARDS: ReadonlyArray<{
  readonly proposal: ZeropsProposal;
  readonly stage: ProposalStage;
  readonly failure?: string;
}> = [
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
];

function Card(card: (typeof CARDS)[number]) {
  const [stage, setStage] = useState<ProposalStage>(card.stage);
  const [failure, setFailure] = useState(card.failure);
  return (
    <ProposalCard
      failure={failure}
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
      proposal={card.proposal}
      recipient={card.proposal.kind === "mate.message" ? ROSSY : undefined}
      stage={stage}
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
            {CARDS.map((card) => (
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
