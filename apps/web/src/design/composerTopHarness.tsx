/**
 * The composer's top — what waits on the person, in one look — in the composer's own frame: a
 * Mate's changes waiting for review (one change, two, three, and five: the newest three and "and 2
 * more"), and what it asks: an approval, a question and a vault value.
 *
 * Served by the dev server at `/design-composer-top.html` (`?theme=dark`; `?n=2` or `?ask=question`
 * shows one state alone). Fixtures only: nothing here ships, and no route imports this module.
 */
import { ApprovalRequestId } from "@t3tools/contracts";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ComposerPendingApprovalActions } from "~/components/chat/ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "~/components/chat/ComposerPendingApprovalPanel";
import {
  ComposerPendingUserInputPanel,
  ComposerPendingUserInputReadOnlyPanel,
} from "~/components/chat/ComposerPendingUserInputPanel";
import { MateFace } from "~/components/zerops/primitives";
import { ComposerVaultAsk } from "~/components/zerops/vault/ComposerVaultAsk";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "~/components/zerops/vault/vaultFixture";
import { vaultAskState, type VaultAsk } from "~/components/zerops/vault/vaultRequest.logic";
import {
  ZeropsNextStepStrip,
  type ZeropsNextStepStripModel,
} from "~/components/zerops/ZeropsNextStepBanner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const ONLY = params.get("n");
const ONLY_ASK = params.get("ask");

const FACE = <MateFace size="md" state="needs" tint="sky" />;
const nothing = async () => undefined;

const VAULT_ASK: VaultAsk = {
  key: "NEW_STRIPE_KEY",
  label: "Stripe secret key",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "to take card payments",
  askedAt: new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString(),
};

const QUESTION = {
  requestId: ApprovalRequestId.make("question-harness"),
  createdAt: "2026-10-12T09:00:00.000Z",
  questions: [
    {
      id: "environment",
      header: "Environment",
      question: "Which environment should I inspect first?",
      options: [
        { label: "Staging", description: "Where the new API runs since this morning" },
        { label: "Production", description: "Read-only: logs and the build version" },
      ],
      multiSelect: false,
    },
  ],
  dismissible: true,
};

const ASKS: ReadonlyArray<{ readonly name: string; readonly top: ReactNode }> = [
  {
    name: "approval",
    top: (
      <ComposerPendingApprovalPanel
        actions={
          <ComposerPendingApprovalActions
            isResponding={false}
            onRespondToApproval={nothing}
            requestId={ApprovalRequestId.make("approval-harness")}
          />
        }
        approval={{
          requestId: ApprovalRequestId.make("approval-harness"),
          requestKind: "command",
          createdAt: "2026-10-12T09:00:00.000Z",
          detail: "zcli service deploy apidev --workspace-state all",
        }}
        face={FACE}
        pendingCount={1}
        who="Wren"
      />
    ),
  },
  {
    name: "question",
    top: (
      <ComposerPendingUserInputPanel
        answers={{}}
        face={FACE}
        onAdvance={() => undefined}
        onDismiss={() => undefined}
        onToggleOption={() => undefined}
        pendingUserInputs={[QUESTION]}
        questionIndex={0}
        respondingRequestIds={[]}
        who="Wren"
      />
    ),
  },
  {
    name: "colleague",
    top: (
      <ComposerPendingUserInputReadOnlyPanel
        face={<MateFace size="md" state="needs" tint="rose" />}
        pendingUserInputs={[QUESTION]}
        waitingLabel="Waiting for Theo"
        who="Rosa"
      />
    ),
  },
  {
    name: "vault",
    top: (
      <ComposerVaultAsk
        ask={VAULT_ASK}
        face={FACE}
        mateName="Wren"
        onNotNow={() => undefined}
        onSave={async () => ({ ok: true })}
        onUseGiven={() => undefined}
        state={vaultAskState(VAULT_FIXTURE, VAULT_ASK)}
      />
    ),
  },
];

const CHANGES = [
  ["apidev", 1, "Rebuild the full API on the new schema, with the old routes kept for a week"],
  ["appdev", 1, "Build the campaign website with the signup form and the countdown"],
  ["appdev", 2, "Add a footer with the press links"],
  ["appdev", 3, "Tune the hero images for phones"],
  ["apidev", 2, "Rate-limit the signup route"],
] as const;

function stripOf(count: number): ZeropsNextStepStripModel {
  const [first] = CHANGES;
  const target = (repository: string, number: number) =>
    ({ kind: "change", groupId: "g-1", repository, number }) as const;
  return {
    title:
      count === 1
        ? "Wren is waiting for your review"
        : `Wren is waiting for your review of ${String(count)} changes`,
    detail: first[2],
    tint: "sky",
    target: target(first[0], first[1]),
    ...(count === 1
      ? {}
      : {
          lines: CHANGES.slice(0, Math.min(3, count)).map(([repository, number, title]) => ({
            label: `${repository} #${String(number)} ${title}`,
            target: target(repository, number),
          })),
          more: Math.max(0, count - 3),
        }),
  };
}

function Composer({
  name,
  state,
  top,
}: {
  readonly name: string;
  readonly state: string;
  readonly top: ReactNode;
}) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-2" data-composer-top-harness={state}>
      <span className="text-xs font-medium text-muted-foreground">{name}</span>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card"
        data-chat-composer-main-surface="true"
      >
        <div data-chat-composer-surface="true">
          {top}
          <div className="px-4 pt-3 pb-12 text-placeholder text-sm">Ask anything...</div>
        </div>
      </div>
    </section>
  );
}

function Harness() {
  const counts = ONLY_ASK !== null ? [] : ONLY === null ? [1, 2, 3, 5] : [Number(ONLY)];
  const asks =
    ONLY !== null ? [] : ASKS.filter(({ name }) => ONLY_ASK === null || name === ONLY_ASK);
  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col items-center gap-10 bg-background p-10 text-foreground">
        {counts.map((count) => (
          <Composer
            key={count}
            name={count === 1 ? "One change" : `${String(count)} changes`}
            state={String(count)}
            top={
              <ZeropsNextStepStrip onMore={() => {}} onReview={() => {}} strip={stripOf(count)} />
            }
          />
        ))}
        {asks.map(({ name, top }) => (
          <Composer key={name} name={`Asks: ${name}`} state={name} top={top} />
        ))}
      </div>
    </TooltipProvider>
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
