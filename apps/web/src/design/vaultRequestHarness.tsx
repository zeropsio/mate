/**
 * The card a Mate's request for a vault value draws in its conversation, in the conversation's
 * column at the owner's size (1786 wide, the left menu at 435, `?menu=` for another): a Shared
 * secret, a service's plain value, one given since, one set aside. Puts answer after 600 ms;
 * `?fail=1` refuses each. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-vault-request.html`. Fixtures only: nothing here ships, and
 * no route imports this module.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

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
const MENU = Number(params.get("menu") ?? 435);
const ASKED = new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString();

const ASKS: ReadonlyArray<{ readonly ask: VaultAsk; readonly said: VaultAskSaid | null }> = [
  {
    ask: {
      key: "OPENAI_API_KEY",
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

function Harness() {
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
