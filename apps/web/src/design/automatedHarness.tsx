/**
 * What sets up and shows automated Mates outside the menu, in each of its states: Settings ›
 * Zerops › HQ's organization API key and Tasks from GitHub, and a task's first message drawn as
 * its issue's card.
 *
 * Served by the dev server at `/design-automated.html` (`?theme=dark`). Open it at the owner's
 * 1786 × 1000. The menu's automated rows are the sidebar harness's Tea Shop; the New Mate
 * dialog's choice is `/design-newmate.html?automated=missing`.
 *
 * Fixtures only. Nothing here ships — `design-automated.html` is not `index.html`, and no route
 * imports this module.
 */
import type { AppIntakeRead, OrgAiKeysRead } from "@t3tools/client-runtime/data";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { AppIntakeView, OrganizationKeyView } from "~/components/settings/AutomatedMatesSettings";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { MateTaskCard } from "~/components/zerops/MateTaskCard";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const NEBIUS = OPENCODE_KEY_PROVIDERS[0]!;
// Built from parts: never a whole secret-shaped literal in the source.
const SECRET = ["whsec", "3f9a", "tea", "shop", "c1d2"].join("_");

const KEY_UNSET: OrgAiKeysRead = {
  keys: { state: "known", keys: [{ provider: "nebius", set: false, setAt: null }], stale: false },
  action: { kind: "idle" },
};
const KEY_SET: OrgAiKeysRead = {
  keys: {
    state: "known",
    keys: [{ provider: "nebius", set: true, setAt: "2026-10-17T09:00:00.000Z" }],
    stale: false,
  },
  action: { kind: "idle" },
};
const NONE: AppIntakeRead = { intake: null, action: { kind: "idle" }, answer: null };
const TAKING: AppIntakeRead = {
  intake: { repo: "acme/tea-shop", label: "mate", waiting: 3 },
  action: { kind: "done", verb: "set" },
  answer: null,
};
const PASTE: AppIntakeRead = {
  ...TAKING,
  answer: {
    appId: "tea-shop",
    repo: "acme/tea-shop",
    label: "mate",
    webhookUrl: "https://hq-acme.zerops.app/api/github/webhook",
    hook: {
      kind: "paste",
      secret: SECRET,
      why: "Mate's token for acme/tea-shop may not make webhooks, so paste this one into the repository's settings.",
    },
  },
};
const MADE: AppIntakeRead = {
  ...TAKING,
  answer: { ...PASTE.answer!, hook: { kind: "made" } },
};

const nothing = () => {};

function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-xs font-medium text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Harness() {
  return (
    <div className="grid min-h-screen grid-cols-2 gap-8 bg-background p-8 text-foreground">
      <div className="grid content-start gap-6">
        <Panel title="Settings › Zerops › HQ">
          <SettingsSection title="HQ">
            <OrganizationKeyView
              onAgain={nothing}
              onRemove={nothing}
              onSet={nothing}
              provider={NEBIUS}
              read={KEY_UNSET}
            />
            <OrganizationKeyView
              onAgain={nothing}
              onRemove={nothing}
              onSet={nothing}
              provider={NEBIUS}
              read={KEY_SET}
            />
            <ul className="grid gap-4 px-3 pb-3 sm:px-4">
              <AppIntakeView
                appId="tea-shop"
                choices={["acme/tea-shop"]}
                name="Tea Shop"
                onSet={nothing}
                onStop={nothing}
                read={NONE}
                reposRead
              />
              <AppIntakeView
                appId="tea-shop-paste"
                choices={["acme/tea-shop"]}
                name="Tea Shop — set, to paste"
                onSet={nothing}
                onStop={nothing}
                read={PASTE}
                reposRead
              />
              <AppIntakeView
                appId="tea-shop-made"
                choices={["acme/tea-shop"]}
                name="Tea Shop — set, webhook made"
                onSet={nothing}
                onStop={nothing}
                read={MADE}
                reposRead
              />
              <AppIntakeView
                appId="notes"
                choices={[]}
                name="Notes — no GitHub mirror"
                onSet={nothing}
                onStop={nothing}
                read={NONE}
                reposRead
              />
            </ul>
          </SettingsSection>
        </Panel>
      </div>
      <div className="grid content-start gap-6">
        <Panel title="A task's first message">
          <div className="max-w-2xl">
            <MateTaskCard
              task={{
                kind: "github-issue",
                repo: "acme/tea-shop",
                number: 12,
                url: "https://github.com/acme/tea-shop/issues/12",
                title: "Fix the checkout total",
                author: "nova-dev",
              }}
            />
          </div>
        </Panel>
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
