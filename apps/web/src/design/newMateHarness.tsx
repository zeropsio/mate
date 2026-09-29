/**
 * The New Mate dialog, open over an empty page, in each of its states.
 *
 * Served by the dev server at `/design-newmate.html` (`?theme=dark`,
 * `?state=<id>`: `recipe` — the group repo read, a tier on main; `reading` —
 * the repo still being read; `none` — no recipe merged on main; `stage` — the
 * stage form, which keeps its own fields; `&name=<name>` proposes another
 * name; `&resolves=none` has a `reading` repo find no recipe; `adding` — Add pressed, the
 * platform taking the Mate's project; `refused` — the platform refused it before). A press on Add
 * goes busy for a second, as the platform takes the project, and then the dialog closes where
 * the person lands on the new Mate. Open it at the owner's 1786 × 1000. The account holds three Mates —
 * Fen, Ada and Nova — so the proposed face walks past the tints they wear.
 * `window.__newMateHarness.read()` answers the recipe the moment it is asked
 * to, so a press made while it was being read can be watched going through.
 *
 * Fixtures only. Nothing here ships — `design-newmate.html` is not
 * `index.html`, and no route imports this module.
 */
import { newMateTint } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { ZeropsEnvironmentCreationDialog } from "~/components/zerops/ZeropsEnvironmentCreationDialog";
import { proposedEnvironmentName } from "~/components/zerops/ZeropsEnvironmentCreationDialog.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "recipe";
const NAME = params.get("name") ?? "Quinn";
/** What the repo holds once read: its recipe, or none. */
const RESOLVES = STATE === "none" || params.get("resolves") === "none" ? "none" : "recipe";

const TIER = {
  kind: "tier" as const,
  tier: "mate" as const,
  yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
  sources: { app: { repository: "https://gitea.test/acme/app", setup: "app" } },
};
const SERVICES = ["db", "redis", "storage", "search", "mailpit", "appdev"];

function mate(bot: string): ZeropsCandidate {
  const id = `acme-docs-${bot.toLowerCase()}`;
  return {
    key: `${id}:zcp`,
    group: "ready",
    project: {
      id,
      name: `Acme Docs - ${bot}`,
      status: "ACTIVE",
      tagList: ["mate", "mate:g:acme", "mate:role:dev", `mate:bot:${bot}`],
    },
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  };
}

const MATES = [mate("Fen"), mate("Ada"), mate("Nova")];
const TAKEN = ["Acme Docs - Fen", "Acme Docs - Ada", "Acme Docs - Nova", "Acme Docs - stage"];

declare global {
  interface Window {
    __newMateHarness?: { readonly read: () => void; readonly created: ReadonlyArray<unknown> };
  }
}

const created: Array<unknown> = [];

function Harness() {
  const role = STATE === "stage" ? "stage" : "dev";
  const [read, setRead] = useState(STATE !== "reading");
  const [adding, setAdding] = useState(STATE === "adding");
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    window.__newMateHarness = {
      read: () => {
        setRead(true);
      },
      created,
    };
  }, []);
  const loaded = read && RESOLVES === "recipe";
  if (landed !== null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground" data-harness-landed>
          Landed on {landed}
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ZeropsEnvironmentCreationDialog
        addError={
          STATE === "refused" && !adding
            ? "Your organization has reached its limit of projects."
            : undefined
        }
        adding={adding}
        defaultBotName={NAME}
        defaultName={role === "dev" ? `Acme Docs - ${NAME}` : "Acme Docs - stage"}
        defaultTintFor={(name) => newMateTint(MATES, name)}
        defaultWithAgent={role === "dev"}
        groupName="Acme Docs"
        onCancel={() => {}}
        onCreate={(choice) => {
          created.push(choice);
          // The platform takes the Mate's project in about a second; then the person lands on it.
          setAdding(true);
          setTimeout(() => {
            setLanded(`/mate/acme-docs-${(choice.botName ?? "mate").toLowerCase()}`);
          }, 1200);
        }}
        onOpenChange={() => {}}
        open
        proposeName={(botName) =>
          proposedEnvironmentName({
            groupName: "Acme Docs",
            roleLabel: role,
            botName: role === "dev" ? botName : undefined,
            taken: TAKEN,
          })
        }
        role={role}
        takenBotNames={{ names: ["Fen", "Ada", "Nova"], complete: true }}
        tier={loaded ? TIER : undefined}
        tierLoading={!read}
        tierServices={loaded ? SERVICES : []}
      />
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
