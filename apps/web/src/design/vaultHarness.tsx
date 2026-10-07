/**
 * The Vault tab in the right panel as the app lays it out at the owner's size: 1786 wide, the
 * left menu at 435 (`?menu=` for another), the panel at its default 540 beside the conversation.
 *
 * The real `VaultPanelBody` in the real `RightPanelTabs`, over the fixture view
 * (`vaultFixture.ts`). `?state=` — `ready` (the default), `unread`, `failed`, `live` (nothing
 * waits). `?actor=environment` draws it without a Mate (restart buttons). Writes answer after
 * 600 ms; `?fail=1` refuses each with `projectEnvDuplicateKey`. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-vault.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import type { VaultView } from "@t3tools/client-runtime/data";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RightPanelTabs } from "~/components/RightPanelTabs";
import { VaultPanelBody } from "~/components/zerops/vault/VaultPanel";
import { VAULT_FIXTURE, vaultFixtureImpact } from "~/components/zerops/vault/vaultFixture";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "ready";
const ACTOR = params.get("actor") === "environment" ? "environment" : "mate";
const FAIL = params.get("fail") === "1";
const MENU = Number(params.get("menu") ?? 435);
const noop = () => {};

const VIEWS: Record<string, VaultView> = {
  ready: VAULT_FIXTURE,
  unread: { status: "unread", scopes: [], notLive: [] },
  failed: { ...VAULT_FIXTURE, status: "failed" },
  live: { ...VAULT_FIXTURE, notLive: [] },
};
const VIEW = VIEWS[STATE] ?? VAULT_FIXTURE;

function Harness() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1" />
      <RightPanelTabs
        activeSurfaceId="vault"
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: "applied",
        })}
        defaultWidth={540}
        liveAgentCount={0}
        maximized={false}
        mode="inline"
        onActivate={noop}
        onAdd={noop}
        onAddTerminal={noop}
        onCloseAllSurfaces={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurface={noop}
        onCloseSurfacesToRight={noop}
        onCopyFilePath={noop}
        pendingSurfaceIds={new Set()}
        surfaces={[
          { id: "zerops", kind: "zerops" },
          { id: "vault", kind: "vault" },
        ]}
        terminalLabelsById={new Map()}
        widthStorageKey="mate:design-vault:panel-width"
      >
        <VaultPanelBody
          actor={ACTOR}
          impactOf={(scope, write) => vaultFixtureImpact(VIEW, scope, write)}
          onRestart={() => new Promise((resolve) => setTimeout(resolve, 1200))}
          onWrite={async () => {
            await new Promise((resolve) => setTimeout(resolve, 600));
            return FAIL
              ? { ok: false, code: "projectEnvDuplicateKey", message: null }
              : { ok: true };
          }}
          pending={new Map()}
          restarting={new Set()}
          view={VIEW}
          who={
            ACTOR === "mate"
              ? { kind: "mate", name: "Fen", tint: "olive" }
              : { kind: "environment", name: "prod" }
          }
        />
      </RightPanelTabs>
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
