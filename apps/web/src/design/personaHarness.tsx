/**
 * The Persona page in the right panel as the app lays it out at the owner's size: 1786 wide, the
 * left menu at 435 (`?menu=` for another), the panel at its default 540.
 *
 * The real `PersonaPanelBody` over the real `personaPage` model, fed by fixtures. `?persona=` —
 * `none` (the default), `premade` (an unedited Zerops copy), `older` (a copy of an older revision),
 * `org` (an unedited org copy), `custom` (written by hand). `?org=` — `ready` (the default),
 * `stale`, `empty`, `loading`, `unavailable`, `failed`. `?mate=update` for a Mate whose server takes no
 * persona, `?mate=loading` for one not yet read. `?write=1` makes the person an Owner or Admin.
 * Writes answer after 600 ms; `?fail=1` makes them fail. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-persona.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import type { MatePersona } from "@t3tools/contracts";
import { PREMADE_PERSONA_TEMPLATES, type PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { PersonaPanelBody, type OrgSaveView } from "~/components/persona/PersonaPanel";
import {
  personaFromTemplate,
  personaPage,
  type OrgPersonaTemplatesInput,
} from "~/components/persona/PersonaPanel.logic";
import { RightPanelPage } from "~/components/RightPanelPage";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const PERSONA = params.get("persona") ?? "none";
const ORG = params.get("org") ?? "ready";
const MATE_STATE = params.get("mate") ?? "ready";
const MAY_WRITE = params.get("write") === "1";
const FAIL = params.get("fail") === "1";
const MENU = Number(params.get("menu") ?? 435);
const noop = () => {};

const ORG_TEMPLATES: readonly PersonaTemplate[] = [
  {
    id: "acme-house",
    name: "Acme house style",
    description: "How Acme writes and ships client work.",
    revision: 3,
    instructions: `Work the way Acme's team does.
- Write commit messages and change titles in plain English, present tense.
- Keep pull requests small; one concern each.
- Before calling something done, check it on the preview at phone and desktop widths.
- Ask before adding a new dependency.`,
  },
  {
    id: "support-desk",
    name: "Support desk",
    description: "Answers customers' questions about their projects, kindly.",
    revision: 1,
    instructions: "Explain what you find in the customer's own terms, and never change Production.",
  },
];

const reviewer = PREMADE_PERSONA_TEMPLATES.find((template) => template.id === "reviewer")!;
const START: Record<string, MatePersona | null> = {
  none: null,
  premade: personaFromTemplate("premade", reviewer),
  older: {
    ...personaFromTemplate("premade", reviewer),
    instructions: "Find problems before they ship.",
    template: { source: "premade", id: "reviewer", revision: 0 },
  },
  org: personaFromTemplate("org", ORG_TEMPLATES[0]!),
  custom: {
    name: "Terse",
    instructions: `Answer in as few words as will do.
- One line for a yes or no.
- Code before prose.
- No summaries at the end.
- Say when you are unsure, in one sentence.
- Name the file and line when you point at code.
- Never apologise.
- Ask at most one question at a time.`,
  },
};

const ORG_INPUT: Record<string, OrgPersonaTemplatesInput> = {
  ready: {
    state: "ready",
    templates: ORG_TEMPLATES,
    orgName: "Acme",
    mayWrite: MAY_WRITE,
    failure: null,
  },
  stale: {
    state: "ready",
    templates: ORG_TEMPLATES,
    orgName: "Acme",
    mayWrite: MAY_WRITE,
    failure: "HQ stopped answering.",
  },
  empty: { state: "ready", templates: [], orgName: "Acme", mayWrite: MAY_WRITE, failure: null },
  loading: { state: "loading", templates: [], orgName: "Acme", mayWrite: false, failure: null },
  unavailable: {
    state: "unavailable",
    templates: [],
    orgName: null,
    mayWrite: false,
    failure: null,
  },
  failed: {
    state: "failed",
    failure: "HQ did not answer in time.",
    templates: [],
    orgName: "Acme",
    mayWrite: false,
  },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

function Page() {
  const [persona, setPersona] = useState<MatePersona | null>(START[PERSONA] ?? null);
  const [orgSave, setOrgSave] = useState<OrgSaveView>({ stage: "idle" });
  const org = ORG_INPUT[ORG] ?? ORG_INPUT.ready!;
  const model = personaPage({
    mate: "Nova",
    capability: MATE_STATE === "update" ? false : MATE_STATE === "loading" ? null : true,
    settingsLoaded: true,
    persona,
    premade: PREMADE_PERSONA_TEMPLATES,
    org,
  });
  return (
    <RightPanelPage kind="persona" mate="Nova">
      <PersonaPanelBody
        mate="Nova"
        model={model}
        orgName={org.orgName}
        persona={persona}
        onReadOrgAgain={noop}
        onSaveAsOrg={() => {
          setOrgSave({ stage: "pending" });
          void settle().then(() =>
            setOrgSave(
              FAIL
                ? {
                    stage: "failed",
                    message: "HQ refused it: you need to be an Admin.",
                    retry: noop,
                  }
                : { stage: "saved" },
            ),
          );
        }}
        orgSave={orgSave}
        write={async (next) => {
          await settle();
          if (FAIL) return "Nova did not answer.";
          setPersona(next);
          return null;
        }}
      />
    </RightPanelPage>
  );
}

function Harness() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1" />
      <RightPanelTabs
        activeSurfaceId="persona"
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: "applied",
          matePersona: MATE_STATE !== "update",
        })}
        defaultWidth={540}
        liveAgentCount={0}
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
          { id: "persona", kind: "persona" },
        ]}
        terminalLabelsById={new Map()}
        widthStorageKey="mate:design-persona:panel-width"
      >
        <Page />
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
