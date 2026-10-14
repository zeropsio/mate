/**
 * A project's People section (`ProjectPeople`), from a made-up organization: an owner, you as a
 * developer with two Mates, an admin lowered on production, a guest with a grant per place and an
 * invitation not accepted yet — then the same seen by an organization owner (a ··· per person,
 * one change saving, one refused, *Invite* at the foot), then the one line a refused member list
 * leaves.
 *
 * Served by the dev server at `/design-people.html` (`?theme=dark`), beside a blank left menu at
 * the owner's 435 px; open it at 1786 × 1000. `?invite=address|name|access` opens the invitation
 * at that step (`&refused` says a refusal in it). Fixtures only: no route imports this module.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ProjectInviteDialog } from "~/components/zerops/projects/ProjectInviteDialog";
import { ProjectPeopleList } from "~/components/zerops/projects/ProjectPeople";
import type { InviteStep } from "~/components/zerops/projects/projectInvite.logic";
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
  member("jan", "Jan Svoboda", "NO_ACCESS"),
  member("eva", "Eva Dvořáková", "NO_ACCESS"),
  member("iva", "Iva Malá", "BASIC_USER", "WAITING_AUTHORIZATION"),
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
      ],
    },
    stage: { status: "ready", grants: [{ clientUserId: "cu-jan", roleCode: "ADMIN" }] },
  },
  owners: { m1: "me", m2: "me", m3: "karel" },
  pictures: {},
  viewerUserId: "me",
});

const INVITE = params.get("invite");
const INVITE_STEP: InviteStep | null =
  INVITE === "address"
    ? { step: "address" }
    : INVITE === "name"
      ? { step: "name", email: "petra.kralova@example.com" }
      : INVITE === "access"
        ? {
            step: "access",
            email: "petra.kralova@example.com",
            invitee: { kind: "existing", userId: "petra" },
          }
        : null;
const ACTIONS = {
  check: () => new Promise<never>(() => {}),
  shownHere: () => false,
  send: () => new Promise<never>(() => {}),
};

function HarnessPage() {
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU_WIDTH }} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-6 pt-6 pb-12">
          <article className="ov-card" style={{ maxWidth: 520 }}>
            <ProjectPeopleList
              view={projectPeople(
                input({ known: true, status: "ready", refused: false, list: MEMBERS }),
              )}
            />
          </article>
          <article className="ov-card" style={{ maxWidth: 520 }}>
            <ProjectPeopleList
              onChange={() => {}}
              onInvite={() => {}}
              projectName="Shop"
              saving={new Set(["cu-me"])}
              troubles={{
                "cu-jan": "Only an organization owner or admin can change who has access.",
              }}
              view={projectPeople({
                ...input({ known: true, status: "ready", refused: false, list: MEMBERS }),
                viewer: { roleCode: "OWNER", membershipId: "cu-ada" },
                viewerUserId: "ada",
              })}
            />
          </article>
          <article className="ov-card" style={{ maxWidth: 520 }}>
            <ProjectPeopleList
              view={projectPeople(
                input({ known: false, status: "failed", refused: true, list: [] }),
              )}
            />
          </article>
          {INVITE_STEP === null ? null : (
            <ProjectInviteDialog
              actions={ACTIONS}
              initial={INVITE_STEP}
              initialError={
                params.has("refused")
                  ? "Already in this organization — change their access in the list."
                  : null
              }
              onOpenChange={() => {}}
              open
              projectName="Shop"
            />
          )}
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
