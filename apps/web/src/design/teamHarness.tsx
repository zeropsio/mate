/**
 * Settings → Team (`TeamList`), from a made-up organization seen by its owner: you, a second
 * owner, two admins, a developer on two Mate projects, a guest on three, someone who works on every
 * project, an invitation not accepted yet — one change saving, one refused, *Invite* at the foot —
 * and the guest's ··· open.
 *
 * Served by the dev server at `/design-team.html` (`?theme=dark`), beside a blank left menu at the
 * owner's 435 px; open it at 1786 × 1000. `?invite=access` opens the invitation at its role step
 * (a guest, Snap ticked); `?menu=0` leaves every menu shut. Fixtures only: no route imports this
 * module.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { TeamInviteDialog } from "~/components/settings/TeamInviteDialog";
import { TeamList } from "~/components/settings/TeamSettings";
import {
  teamPeople,
  type TeamInput,
  type TeamPlace,
} from "~/components/settings/teamSettings.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const MENU_WIDTH = 435;

const member = (
  id: string,
  fullName: string,
  roleCode: string,
  extra: Partial<ZeropsOrganizationMember> = {},
): ZeropsOrganizationMember => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id, fullName, email: `${id}@example.com` },
  ...extra,
});

const MEMBERS = [
  member("me", "Ada Lovelace", "OWNER"),
  member("karel", "Karel Novák", "ADMIN"),
  member("petra", "Petra Králová", "OWNER"),
  member("jan", "Jan Svoboda", "NO_ACCESS", { canCreateProjects: true }),
  member("eva", "Eva Dvořáková", "NO_ACCESS"),
  member("tomas", "Tomáš Beneš", "BASIC_USER"),
  member("lucie", "Lucie Horáková", "ADMIN"),
  member("iva", "iva.mala@example.com", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
  { id: "cu-token", status: "ACTIVE", roleCode: "ADMIN", user: { email: "token-x@zerops.io" } },
];

const place = (key: string, name: string): TeamPlace => ({ key, name, groupId: key });
const SNAP = place("g-snap", "Snap");
const BEVIRO = place("g-beviro", "Beviro");
const SHOP = place("g-shop", "Shop");

const grants = (entries: Record<string, string>) => ({
  status: "ready" as const,
  value: Object.entries(entries).map(([projectId, roleCode]) => ({ projectId, roleCode })),
});

const INPUT: TeamInput = {
  members: { known: true, status: "ready", refused: false, list: MEMBERS },
  grants: {
    "cu-jan": grants({ "snap-prod": "BASIC_USER", "beviro-prod": "BASIC_USER" }),
    "cu-eva": grants({
      "snap-prod": "READ_ONLY",
      "beviro-prod": "READ_ONLY",
      "shop-prod": "BASIC_USER",
    }),
    "cu-iva": grants({ "snap-prod": "READ_ONLY" }),
  },
  places: { "snap-prod": SNAP, "beviro-prod": BEVIRO, "shop-prod": SHOP },
  pictures: {},
  viewerUserId: "me",
  viewer: { roleCode: "OWNER", membershipId: "cu-me" },
};

const VIEW = teamPeople(INPUT);
const ACTIONS = {
  check: () => new Promise<never>(() => {}),
  shownHere: () => false,
  send: () => new Promise<never>(() => {}),
};

function HarnessPage() {
  const invite = params.get("invite") === "access";
  // The guest's ··· open, as a person clicking it sees it.
  useEffect(() => {
    if (invite || params.get("menu") === "0") return;
    const timer = setTimeout(() => {
      document.querySelector<HTMLElement>('[aria-label="Change Eva Dvořáková\'s role"]')?.click();
    }, 200);
    return () => clearTimeout(timer);
  }, [invite]);
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU_WIDTH }} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-10 pb-12">
          <TeamList
            onEnd={() => {}}
            onInvite={() => {}}
            onRole={() => {}}
            organizationName="Acme"
            saving={new Set(["cu-tomas"])}
            troubles={{ "cu-lucie": "Admins can't change an owner's or another admin's role." }}
            view={VIEW}
          />
        </div>
        {invite && VIEW.kind === "people" ? (
          <TeamInviteDialog
            actions={ACTIONS}
            initial={{
              step: "access",
              email: "petra.kralova@example.com",
              invitee: { kind: "existing", userId: "petra" },
            }}
            initialChoice={{ role: "guest", groups: ["g-snap"], level: "work" }}
            onOpenChange={() => {}}
            open
            organizationName="Acme"
            projects={[BEVIRO, SHOP, SNAP].map(({ key, name }) => ({ groupId: key, name }))}
            roles={VIEW.invite}
          />
        ) : null}
      </main>
    </div>
  );
}

const router = createRouter({
  routeTree: createRootRoute({ component: HarnessPage }),
  history: createMemoryHistory(),
});

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
