/**
 * People chips (`ProjectAccessChips`), from a made-up organization: an owner, you as a developer
 * with two Mates, an admin lowered on production, an admin the app is hidden from, a guest with a
 * grant per place, an invitation not accepted yet and two members with no access — an app's People as you see them, then as an
 * organization owner (a ⋮ per person, one change saving, one refused, *Add access* last), one
 * environment's *Project access*, a new stage's draft with its creator pinned, *Add access* open
 * (`?pick`), and the one line a refused member list leaves.
 *
 * Served by the dev server at `/design-people.html` (`?theme=dark`), beside a blank left menu at
 * the owner's 435 px; open it at 1786 × 1000. Inviting someone new lives on Settings → Team
 * (`design-team.html?page=invite`). Fixtures only: no route imports this module.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { draftView } from "~/components/zerops/projects/accessDraft.logic";
import {
  AddAccessPicker,
  ProjectAccessChips,
} from "~/components/zerops/projects/ProjectAccessChips";
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
  member("lucie", "Lucie Horáková", "ADMIN"),
  member("jan", "Jan Svoboda", "NO_ACCESS"),
  member("eva", "Eva Dvořáková", "NO_ACCESS"),
  member("iva", "Iva Malá", "BASIC_USER", "WAITING_AUTHORIZATION"),
  member("petra", "Petra Králová", "NO_ACCESS"),
  member("ondrej", "Ondřej Procházka-Dvořák", "NO_ACCESS"),
];

const input = (members: ProjectPeopleInput["members"]): ProjectPeopleInput => ({
  members,
  projects: [
    { projectId: "prod", kind: "production" },
    { projectId: "stage", kind: "stage" },
    { projectId: "m1", kind: "mate" },
    { projectId: "m2", kind: "mate" },
    { projectId: "m3", kind: "mate" },
  ],
  grants: {
    prod: {
      status: "ready",
      grants: [
        { clientUserId: "cu-karel", roleCode: "READ_ONLY" },
        { clientUserId: "cu-jan", roleCode: "READ_ONLY" },
        { clientUserId: "cu-lucie", roleCode: "NO_ACCESS" },
      ],
    },
    stage: {
      status: "ready",
      grants: [
        { clientUserId: "cu-jan", roleCode: "ADMIN" },
        { clientUserId: "cu-lucie", roleCode: "NO_ACCESS" },
      ],
    },
  },
  owners: { m1: "me", m2: "me", m3: "karel" },
  pictures: {},
  viewerUserId: "me",
});

const KNOWN = { known: true, status: "ready", refused: false, list: MEMBERS } as const;

function HarnessPage() {
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU_WIDTH }} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-6 pt-6 pb-12">
          <article className="ov-card" style={{ maxWidth: 560 }}>
            <ProjectAccessChips label="People" view={projectPeople(input(KNOWN))} />
          </article>
          <article className="ov-card" style={{ maxWidth: 560 }}>
            <ProjectAccessChips
              label="People"
              onAdd={() => {}}
              onChoose={() => {}}
              saving={new Set(["cu-me"])}
              troubles={{
                "cu-jan": "Only an organization owner or admin can change who has access.",
              }}
              view={projectPeople({
                ...input(KNOWN),
                viewer: { roleCode: "OWNER", membershipId: "cu-ada" },
                viewerUserId: "ada",
              })}
            />
          </article>
          <article className="ov-card" style={{ maxWidth: 560 }}>
            <ProjectAccessChips
              onAdd={() => {}}
              onChoose={() => {}}
              view={projectPeople({
                ...input(KNOWN),
                projects: [{ projectId: "stage", kind: "stage" }],
                viewer: { roleCode: "OWNER", membershipId: "cu-ada" },
                viewerUserId: "ada",
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
                candidates={(() => {
                  const view = projectPeople({
                    ...input(KNOWN),
                    viewer: { roleCode: "OWNER", membershipId: "cu-ada" },
                  });
                  return view.kind === "people" ? view.candidates : [];
                })()}
                onAdd={() => {}}
              />
            </article>
          ) : null}
          <article className="ov-card" style={{ maxWidth: 560 }}>
            <ProjectAccessChips
              label="People"
              view={projectPeople(
                input({ known: false, status: "failed", refused: true, list: [] }),
              )}
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
