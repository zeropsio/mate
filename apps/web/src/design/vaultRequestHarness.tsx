/**
 * The card a Mate's request for a vault value draws in its conversation, in the conversation's
 * column at the owner's size (1786 wide, the left menu at 435, `?menu=` for another): a Shared
 * secret, a service's plain value, one given since, one set aside. Puts answer after 600 ms;
 * `?fail=1` refuses each. `?theme=dark` for dark. `?drawer=1`: an ask the engine keeps, at the
 * composer's top in each state, and its answer as the asking run's result rows.
 *
 * Served by the dev server at `/design-vault-request.html`. Fixtures only: nothing here ships, and
 * no route imports this module.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { TurnReport } from "~/components/chat/TurnReport";
import { ComposerVaultAsk } from "~/components/zerops/vault/ComposerVaultAsk";
import { VaultRequestCard } from "~/components/zerops/vault/VaultRequestCard";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "~/components/zerops/vault/vaultFixture";
import {
  type VaultAsk,
  type VaultAskSaid,
  vaultAskState,
} from "~/components/zerops/vault/vaultRequest.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const FAIL = params.get("fail") === "1";
const DRAWER = params.get("drawer") === "1";
const MENU = Number(params.get("menu") ?? 435);
const ASKED = new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString();

const ASKS: ReadonlyArray<{ readonly ask: VaultAsk; readonly said: VaultAskSaid | null }> = [
  {
    ask: {
      key: "OPENAI_API_KEY",
      label: null,
      scope: { kind: "shared" },
      sensitive: true,
      reason: "The chat feature calls OpenAI with it — platform.openai.com › API keys.",
      askedAt: ASKED,
    },
    said: null,
  },
  {
    ask: {
      key: "MAIL_FROM",
      label: null,
      scope: { kind: "service", hostname: "appdev" },
      sensitive: false,
      reason: "The address the shop's emails come from.",
      askedAt: ASKED,
    },
    said: null,
  },
  {
    ask: {
      key: "STRIPE_SECRET_KEY",
      label: null,
      scope: { kind: "shared" },
      sensitive: true,
      reason: null,
      askedAt: ASKED,
    },
    said: null,
  },
  {
    ask: {
      key: "SENTRY_DSN",
      label: null,
      scope: { kind: "shared" },
      sensitive: true,
      reason: null,
      askedAt: ASKED,
    },
    said: "not-now",
  },
];

function Ask({ ask, said: initial }: (typeof ASKS)[number]) {
  const [said, setSaid] = useState(initial);
  return (
    <VaultRequestCard
      ask={ask}
      mateName="Fen"
      onNotNow={() => setSaid("not-now")}
      onPut={async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (FAIL) {
          return { ok: false, code: "projectEnvDuplicateKey", message: "Zerops refused it." };
        }
        setSaid("put");
        return { ok: true };
      }}
      said={said}
      state={vaultAskState(VAULT_FIXTURE, ask)}
    />
  );
}

/** The composer's asks, one per state it can stand in. */
const DRAWER_ASKS: ReadonlyArray<{ readonly name: string; readonly ask: VaultAsk }> = [
  {
    name: "asked",
    ask: {
      key: "NEW_STRIPE_KEY",
      label: "Stripe secret key",
      scope: { kind: "shared" },
      sensitive: true,
      reason: "for the questionnaire API",
      askedAt: ASKED,
    },
  },
  {
    name: "an app's own",
    ask: {
      key: "SMTP_PASSWORD",
      label: "Mail password",
      scope: { kind: "service", hostname: "appdev" },
      sensitive: true,
      reason: "so the shop can send receipts",
      askedAt: ASKED,
    },
  },
  {
    name: "given in the Vault meanwhile",
    ask: {
      key: "STRIPE_SECRET_KEY",
      label: "Stripe secret key",
      scope: { kind: "shared" },
      sensitive: true,
      reason: "for checkout",
      askedAt: ASKED,
    },
  },
  {
    name: "a Zerops sign-in",
    ask: {
      key: "ZEROPS_TOKEN",
      label: "Zerops token",
      scope: { kind: "shared" },
      sensitive: true,
      reason: "to deploy from CI",
      askedAt: ASKED,
    },
  },
];

const ANSWERED: ReadonlyArray<{ readonly ask: VaultAsk; readonly state: "saved" | "declined" }> = [
  { ask: { ...DRAWER_ASKS[0]!.ask, key: "STRIPE_SECRET_KEY" }, state: "saved" },
  {
    ask: { ...DRAWER_ASKS[0]!.ask, key: "LOG_LEVEL", label: "Log level", sensitive: false },
    state: "saved",
  },
  { ask: { ...DRAWER_ASKS[0]!.ask, key: "SENTRY_DSN", label: "Sentry DSN" }, state: "declined" },
];

function DrawerHarness() {
  const activities = ANSWERED.map(
    ({ ask, state }, index) =>
      ({
        id: `ask-${index}`,
        kind: "vault.requested",
        tone: "info",
        summary: "Secret requested",
        turnId: null,
        createdAt: ASKED,
        payload: {
          requestId: `mate/r/1/q/${index}`,
          key: ask.key,
          label: ask.label,
          scope: ask.scope,
          sensitive: ask.sensitive,
          reason: ask.reason,
          state,
          answer: null,
        },
      }) as unknown as OrchestrationThreadActivity,
  );
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-8">
        <div className="mx-auto grid w-full max-w-3xl gap-6">
          {DRAWER_ASKS.map(({ name, ask }) => (
            <div
              className="w-full overflow-hidden rounded-3xl border border-border bg-card"
              data-chat-composer-main-surface="true"
              data-harness-state={name}
              key={name}
            >
              <ComposerVaultAsk
                ask={ask}
                mateName="Milo"
                onNotNow={() => undefined}
                onSave={async () => {
                  await new Promise((resolve) => setTimeout(resolve, 600));
                  return FAIL
                    ? { ok: false, code: "projectEnvDuplicateKey", message: "Zerops refused it." }
                    : { ok: true };
                }}
                onUseGiven={() => undefined}
                state={vaultAskState(VAULT_FIXTURE, ask)}
              />
              <div className="px-4 pt-3 pb-12 text-placeholder text-sm">Ask anything...</div>
            </div>
          ))}
          <div data-harness-state="answered">
            <TurnReport
              facts={{ asks: { activities, vault: VAULT_FIXTURE } }}
              onOpenImage={() => undefined}
              onOpenTurnDiff={() => undefined}
              outcome={{
                key: "outcome:asked",
                turnKey: "asked",
                live: [],
                landed: [],
                files: null,
                checks: null,
                pictures: [],
                created: [],
                notDone: [],
                planLeft: [],
                change: null,
                crewTask: null,
                activity: [],
                later: {
                  services: [],
                  changes: [],
                  tasks: [],
                  pages: [],
                  views: [],
                  files: [],
                  answered: false,
                },
                asks: ANSWERED.map(({ ask }) => ask),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Harness() {
  if (DRAWER) return <DrawerHarness />;
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-8">
        <div className="mx-auto grid w-full max-w-3xl gap-3">
          {ASKS.map((each) => (
            <div className="min-w-0 px-1 py-0.5" key={each.ask.key}>
              <Ask {...each} />
            </div>
          ))}
        </div>
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
