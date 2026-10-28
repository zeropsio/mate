/**
 * An app's access, from a made-up organization and app — kite.works, with Production, a Stage and
 * the Mates Rhea (yours) and Otto (Karel's) — and a dozen people: an owner, you as a developer, an
 * admin lowered on production, a read-only member Production is hidden from, guests with a level
 * per place, an invitation not accepted yet and members with no access.
 *
 * Drawn as the app's page draws it: the table as an organization owner sees it (one cell saving,
 * one refused, the Stage column linked to), as a developer sees it, a place's read-only list, then
 * the chips a Mate on its own keeps — its *Access*, a new stage's draft with its creator pinned,
 * *Add access* open (`?pick`) — and the one line a refused member list leaves.
 *
 * Served by the dev server at `/design-people.html` (`?theme=dark`), beside a blank left menu at
 * the owner's 435 px; open it at 1786 × 1000, or 390 px wide for a phone (`?stacked` draws the
 * phone's rows at any width). Fixtures only: no route imports this module.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { accessTable, columnPeople } from "~/components/zerops/projects/accessTable.logic";
import { draftView } from "~/components/zerops/projects/accessDraft.logic";
import {
  AddAccessPicker,
  ProjectAccessChips,
} from "~/components/zerops/projects/ProjectAccessChips";
import {
  cellKey,
  PlaceAccessSummary,
  ProjectAccessTable,
} from "~/components/zerops/projects/ProjectAccessTable";
import {
  projectPeople,
  type ProjectPeopleInput,
} from "~/components/zerops/projects/projectPeople.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const MENU_WIDTH = 435;

const member = (
  id: string,
  fullName: string,
  roleCode: string,
  status = "ACTIVE",
): ZeropsOrganizationMember => ({ id: `cu-${id}`, status, roleCode, user: { id, fullName } });

const MEMBERS = [
  member("ada", "Ada Lovelace", "OWNER"),
  member("me", "Tomáš Beneš", "BASIC_USER"),
  member("karel", "Karel Novák", "ADMIN"),
  member("lucie", "Lucie Horáková", "READ_ONLY"),
  member("jan", "Jan Svoboda", "NO_ACCESS"),
  member("eva", "Eva Dvořáková", "NO_ACCESS"),
  member("milan", "Milan Černý", "BASIC_USER"),
  member("hana", "Hana Veselá", "NO_ACCESS"),
  member("iva", "Iva Malá", "NO_ACCESS", "WAITING_AUTHORIZATION"),
  member("filip", "Filip Marek", "NO_ACCESS"),
  member("petra", "Petra Králová", "NO_ACCESS"),
  member("ondrej", "Ondřej Procházka-Dvořák", "NO_ACCESS"),
];

const grants = (...list: ReadonlyArray<readonly [string, string]>) => ({
  status: "ready" as const,
  grants: list.map(([who, roleCode]) => ({ clientUserId: `cu-${who}`, roleCode })),
});

const APP: ProjectPeopleInput = {
  members: { known: true, status: "ready", refused: false, list: MEMBERS },
  projects: [
    { projectId: "prod", kind: "production", name: "kite-works-prod" },
    { projectId: "stage", kind: "stage", name: "kite-works-stage" },
    { projectId: "rhea", kind: "mate", name: "Rhea" },
    { projectId: "otto", kind: "mate", name: "Otto" },
  ],
  grants: {
    prod: grants(
      ["karel", "READ_ONLY"],
      ["jan", "READ_ONLY"],
      ["lucie", "NO_ACCESS"],
      ["hana", "READ_ONLY"],
      ["milan", "READ_ONLY"],
    ),
    stage: grants(["jan", "ADMIN"], ["eva", "ADMIN"], ["hana", "ADMIN"], ["iva", "READ_ONLY"]),
    rhea: grants(["eva", "READ_ONLY"], ["filip", "ADMIN"]),
    otto: grants(["jan", "ADMIN"], ["filip", "READ_ONLY"]),
  },
  owners: { rhea: "me", otto: "karel" },
  pictures: {},
  viewerUserId: "me",
};

/** `?many`: six Mates more, so the table scrolls sideways inside its card. */
const MORE_MATES = params.has("many")
  ? ["Nova", "Pike", "Wren", "Sol", "Ivo", "Mira"].map((name) => ({
      projectId: name.toLowerCase(),
      kind: "mate" as const,
      name,
    }))
  : [];

const AS_OWNER: ProjectPeopleInput = {
  ...APP,
  projects: [...APP.projects, ...MORE_MATES],
  grants: {
    ...APP.grants,
    ...Object.fromEntries(MORE_MATES.map(({ projectId }) => [projectId, grants(["jan", "ADMIN"])])),
  },
  owners: {
    ...APP.owners,
    ...Object.fromEntries(
      MORE_MATES.map(({ projectId }, index) => [projectId, index % 2 === 0 ? "milan" : "eva"]),
    ),
  },
  viewer: { roleCode: "OWNER", membershipId: "cu-ada" },
  viewerUserId: "ada",
};

const KNOWN = APP.members;
const OWNER_TABLE = accessTable(AS_OWNER);

function HarnessPage() {
  const stage = accessTable({ ...APP, projects: [APP.projects[1]!] });
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside
        className="shrink-0 border-e border-border bg-sidebar max-md:hidden"
        style={{ width: MENU_WIDTH }}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-4 pt-6 pb-12 md:px-6">
          <article className="ov-card" data-harness="owner">
            <ProjectAccessTable
              focus={params.has("focus") ? "stage" : undefined}
              onAdd={() => {}}
              onCell={() => {}}
              onEverywhere={() => {}}
              onWithdraw={() => {}}
              saving={new Set([cellKey({ key: "cu-milan" }, "stage")])}
              stacked={params.has("stacked")}
              troubles={{
                [cellKey({ key: "cu-karel" }, "prod")]:
                  "Only an organization owner can change an owner’s or admin’s access.",
              }}
              view={OWNER_TABLE}
            />
          </article>
          <article className="ov-card" data-harness="developer">
            <ProjectAccessTable
              stacked={params.has("stacked")}
              view={accessTable({
                ...APP,
                viewer: { roleCode: "BASIC_USER", membershipId: "cu-me" },
              })}
            />
          </article>
          <article className="ov-card" data-harness="place" style={{ maxWidth: 560 }}>
            <PlaceAccessSummary
              change={
                <a className="ov-acc-link" href="#access-stage">
                  Change on kite.works’s page
                </a>
              }
              line={null}
              summary={columnPeople(stage, "stage")}
            />
          </article>
          <article className="ov-card" style={{ maxWidth: 560 }}>
            <ProjectAccessChips
              onAdd={() => {}}
              onChoose={() => {}}
              view={projectPeople({
                ...AS_OWNER,
                projects: [{ projectId: "otto", kind: "mate", name: "Otto" }],
              })}
            />
          </article>
          <article className="ov-card" style={{ maxWidth: 560 }}>
            <ProjectAccessChips
              onAdd={() => {}}
              onChoose={() => {}}
              view={draftView({
                members: KNOWN,
                kind: "stage",
                app: { projects: [], grants: {}, owners: {} },
                pictures: {},
                creator: { membershipId: "cu-me", userId: "me" },
                list: [{ clientUserId: "cu-jan", roleCode: "ADMIN" }],
              })}
            />
          </article>
          {params.has("pick") ? (
            <article className="ov-card" style={{ maxWidth: 360, padding: 0 }}>
              <AddAccessPicker
                candidates={OWNER_TABLE.kind === "table" ? OWNER_TABLE.candidates : []}
                onAdd={() => {}}
              />
            </article>
          ) : null}
          <article className="ov-card" style={{ maxWidth: 560 }}>
            <ProjectAccessTable
              view={accessTable({
                ...APP,
                members: { known: false, status: "failed", refused: true, list: [] },
              })}
            />
          </article>
        </div>
      </main>
    </div>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <HarnessPage />
  </StrictMode>,
);
