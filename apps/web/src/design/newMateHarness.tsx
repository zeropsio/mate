/**
 * The New Mate dialog, open over an empty page, in each of its states.
 *
 * Served by the dev server at `/design-newmate.html` (`?theme=dark`,
 * `?state=<id>`: `recipe` — the group repo read, a tier on main; `reading` —
 * the repo still being read; `none` — no recipe merged on main; `stage` — the
 * stage form, which keeps its own fields; `&name=<name>` proposes another
 * name; `&resolves=none` has a `reading` repo find no recipe; and the project
 * taking no Mate (`newMateDoor`): `waiting` — the recipe in Fen's change, `writer` — Fen still to
 * write it, `mates` — one of three to, `unreadable` — the read failed; `&resolves=<one of them>`
 * has a `reading` repo shut the door, to watch nothing move). The dialog ends with what happens
 * next (board D1): up, signed in, development set up with the project's code for `recipe` and
 * `reading`; up, signed in, told what to build for `none` — `&resolves=none` turns one into the
 * other in place, to watch nothing move. The die at the name's end rolls another name. A press on
 * Add gives way to the new Mate's page at once, the steps this tab runs advancing under its copy
 * (`pressPage.tsx`, `&fail=` stops one). Open it at the owner's 1786 × 1000. The account holds three Mates —
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
import {
  newMateDoor,
  proposedEnvironmentName,
} from "~/components/zerops/ZeropsEnvironmentCreationDialog.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

import { beginHarnessPress, HarnessPressPage } from "./pressPage";

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
};
const SERVICES = ["db", "redis", "storage", "search", "mailpit", "appdev"];

function mate(bot: string): ZeropsCandidate {
  const id = `acme-docs-${bot.toLowerCase()}`;
  return {
    key: `${id}:zcp`,
    group: "ready",
    project: {
      id,
      name: bot,
      status: "ACTIVE",
      tagList: ["mate"],
      hq: { appId: "acme", appName: "Acme Docs", kind: "mate", mate: { face: "" } },
    },
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  };
}

const MATES = [mate("Fen"), mate("Ada"), mate("Nova")];
/** What the die rolls, in turn: never the name it was rolled from. */
const ROLLS = ["Wren", "Milo", "Iris"];
const TAKEN = ["Acme Docs - Fen", "Acme Docs - Ada", "Acme Docs - Nova", "Acme Docs - stage"];

/** The project taking no Mate, as the door says it for each. */
const FEN = { projectId: "acme-docs-fen", name: "Fen" };
const door = (input: Partial<Parameters<typeof newMateDoor>[0]>) =>
  newMateDoor({
    groupName: "Acme Docs",
    recipe: "absent",
    mates: [FEN],
    change: undefined,
    rereading: false,
    ...input,
  });
const SHUT: Readonly<Record<string, ReturnType<typeof newMateDoor>>> = {
  waiting: door({ change: { number: 11, mate: "Fen" } }),
  writer: door({}),
  mates: door({
    mates: [
      FEN,
      { projectId: "acme-docs-ada", name: "Ada" },
      { projectId: "acme-docs-nova", name: "Nova" },
    ],
  }),
  unreadable: door({ recipe: "unreadable" }),
};
const SHUTS = SHUT[STATE] ?? SHUT[params.get("resolves") ?? ""];

declare global {
  interface Window {
    __newMateHarness?: { readonly read: () => void; readonly created: ReadonlyArray<unknown> };
  }
}

const created: Array<unknown> = [];

function Harness() {
  const [open, setOpen] = useState(true);
  const role = STATE === "stage" ? "stage" : "dev";
  const [read, setRead] = useState(STATE !== "reading");
  // Add pressed: the dialog gives way to the new Mate's page, at once.
  const [page, setPage] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    window.__newMateHarness = {
      read: () => {
        setRead(true);
      },
      created,
    };
  }, []);
  const loaded = read && RESOLVES === "recipe" && SHUTS === undefined;
  if (page !== null) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <HarnessPressPage birthId={page} />
      </div>
    );
  }
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
        closed={read && SHUTS?.kind === "closed" ? SHUTS : undefined}
        defaultName={
          role === "dev"
            ? NAME
            : proposedEnvironmentName({ groupName: "Acme Docs", roleLabel: role, taken: TAKEN })
        }
        defaultTintFor={(name) => newMateTint(MATES, name)}
        defaultWithAgent={role === "dev"}
        groupName="Acme Docs"
        // As the app's host: Add lands on the new Mate's page, which takes the focus.
        landsElsewhere
        onCancel={() => setOpen(false)}
        onCreate={(choice) => {
          created.push(choice);
          setPage(
            beginHarnessPress({
              flow: "add",
              project: "Acme Docs",
              botName: choice.name,
            }),
          );
        }}
        onDoorAction={(action) => {
          if (action.kind === "retry") return;
          setLanded(
            action.kind === "change"
              ? `/change/acme/group/${String(action.number)}`
              : `/mate/${action.projectId}`,
          );
        }}
        onOpenChange={setOpen}
        open={open}
        proposeAnotherName={(current) => ROLLS.find((name) => name !== current) ?? current}
        role={role}
        takenBotNames={{ names: ["Fen", "Ada", "Nova"], complete: true }}
        tier={loaded ? TIER : undefined}
        recipe={!read ? "reading" : loaded ? "present" : "absent"}
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
