/**
 * Settings → Team, from a made-up organization seen by its owner: the team as cards (`TeamList`),
 * one person's own page (`TeamMemberView`) and the invitation (`TeamInviteView`).
 *
 * Served by the dev server at `/design-team.html` (`?theme=dark`), beside a blank left menu at the
 * owner's 435 px; open it at 1786 × 1000. `?page=member` shows a developer's page with two
 * project grants (`&who=` another key: `cu-karel` an admin, `cu-iva` an invitation, `cu-me`
 * your own; `&viewer=ADMIN` as an admin sees it; `&advanced=1` a custom role with Advanced open;
 * `&picker=1` the project picker open; `&grants=failed` their access unread, with Try again). `?page=invite` the invitation, empty (`&from=g-snap` as
 * opened from Snap's ···); `&step=details` an address typed and Snap picked, a guest
 * (`&role=developer` a Developer); Invite answers after a moment, as Zerops would, and goes back to
 * the team, where their row grows in. The team's invitation is named as its inviter typed it.
 * `?ops=1` the team with the owner's access changes at HQ: Jan's role changing, Karel's project
 * access waiting for the owner's fresh sign-in, Iva's Send again failed, and the long address's
 * invitation withdrawn by a Send again and not sent; `&page=member&op=running|waiting|failed` one
 * person's page with such a change.
 * Fixtures only: no route imports this module.
 */
import {
  operationFailureDetails,
  operationFailureWords,
  type AccessOperationRow,
} from "@t3tools/client-runtime/data";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { presetMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { TeamInviteView } from "~/components/settings/TeamInvitePage";
import { TeamMemberView } from "~/components/settings/TeamMemberPage";
import { TeamList } from "~/components/settings/TeamSettings";
import { ToastProvider } from "~/components/ui/toast";
import {
  teamPeople,
  type TeamInput,
  type TeamPlace,
} from "~/components/settings/teamSettings.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const viewerRole = params.get("viewer") ?? "OWNER";
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
  user: { id, fullName, email: `${fullName.toLowerCase().replace(/\W+/g, ".")}@example.com` },
  ...extra,
});

const MEMBERS = [
  member("me", "Ada Lovelace", "OWNER"),
  member("karel", "Karel Novak", "ADMIN"),
  member("petra", "Petra Kralova", "OWNER"),
  member("jan", "Jan Svoboda", "NO_ACCESS", { canCreateProjects: true }),
  member("eva", "Eva Dvorakova", "NO_ACCESS"),
  member("tomas", "Tomas Benes", "BASIC_USER", {
    canCreateProjects: true,
  }),
  member("lucie", "Lucie Horakova", "ADMIN"),
  member("iva", "iva.mala@example.com", "NO_ACCESS", {
    status: "WAITING_AUTHORIZATION",
    user: { id: "iva", email: "iva.mala@example.com" },
  }),
  // Invited from another browser: no name typed here, an address longer than its card.
  member("nova", "nova.storefront-operations@teashop-example.com", "NO_ACCESS", {
    status: "WAITING_AUTHORIZATION",
    user: { id: "nova", email: "nova.storefront-operations@teashop-example.com" },
  }),
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
    "cu-jan": grants({ "snap-prod": "ADMIN", "beviro-prod": "ADMIN" }),
    "cu-eva": grants({
      "snap-prod": "READ_ONLY",
      "beviro-prod": "READ_ONLY",
      "shop-prod": "ADMIN",
    }),
    "cu-iva": grants({ "snap-prod": "READ_ONLY" }),
  },
  places: { "snap-prod": SNAP, "beviro-prod": BEVIRO, "shop-prod": SHOP },
  pictures: {},
  viewerUserId: "me",
  invitedNames: { "iva.mala@example.com": "Iva Mala" },
  viewer: { roleCode: viewerRole, membershipId: viewerRole === "OWNER" ? "cu-me" : "cu-karel" },
};

const PROJECTS = [
  { projectId: "beviro-prod", label: "Beviro · production" },
  { projectId: "beviro-stage", label: "Beviro · stage" },
  { projectId: "shop-prod", label: "Shop · production" },
  { projectId: "snap-fen", label: "Snap · Fen" },
  { projectId: "snap-prod", label: "Snap · production" },
  { projectId: "snap-stage", label: "Snap · stage" },
  { projectId: "legacy", label: "legacy-api" },
];

const INVITABLE = [
  { key: "g-beviro", name: "Beviro", projectIds: ["beviro-prod", "beviro-stage"] },
  { key: "legacy", name: "legacy-api", projectIds: ["legacy"] },
  { key: "g-shop", name: "Shop", projectIds: ["shop-prod"] },
  { key: "g-snap", name: "Snap", projectIds: ["snap-prod", "snap-stage", "snap-fen"] },
];

const VIEW = teamPeople(INPUT);
const never = () => new Promise<never>(() => {});
/** Zerops's answer after a moment, as the invitation is sent. */
const answered =
  <T,>(value: T) =>
  () =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), 400));

/** The team as Zerops lists it once the invitation to `address` went out. */
const invitedTo = (address: string) =>
  teamPeople({
    ...INPUT,
    members: {
      ...INPUT.members,
      list: [
        ...MEMBERS,
        member("invited", address, "NO_ACCESS", {
          status: "WAITING_AUTHORIZATION",
          user: { id: "invited", email: address },
        }),
      ],
    },
  });

const OPERATIONS: Readonly<Record<"running" | "waiting" | "failed", AccessOperationRow>> = {
  running: {
    id: "op-jan",
    kind: "role",
    userId: "jan",
    state: "running",
    phase: "Changing their role",
    mine: false,
  },
  waiting: {
    id: "op-karel",
    kind: "projects",
    userId: "karel",
    state: "waiting",
    phase: "Giving their project access",
    failure: "Your Zerops sign-in ran out before it finished.",
    continueBy: "me",
    mine: true,
  },
  failed: {
    id: "op-iva",
    kind: "resend",
    userId: "iva",
    state: "failed",
    phase: "Sending the invitation again",
    failure: "Their invitation changed in Zerops after this started, so nothing was sent again.",
    mine: false,
  },
};
const LOST_FAILURE = {
  step: "invite",
  code: "tooManyInvitations",
  at: "2026-11-22T10:00:00.000Z",
  origin: "zerops",
  zerops: { words: "The invitation could not be sent.", status: null },
};
const LOST: AccessOperationRow = {
  id: "op-nova",
  kind: "resend",
  userId: "nova",
  state: "failed",
  phase: "Sending the invitation",
  failure: operationFailureWords(LOST_FAILURE),
  details: operationFailureDetails(LOST_FAILURE),
  invitationLost: true,
  mine: false,
};
const pressed = () => new Promise<void>((resolve) => setTimeout(resolve, 600));

function Page() {
  const page = params.get("page");
  const who = params.get("who") ?? "cu-jan";
  const op = params.get("op");
  const [sentTo, setSentTo] = useState<string | null>(null);
  useEffect(() => {
    if (params.get("picker") !== "1") return;
    const timer = setTimeout(() => {
      document.querySelector<HTMLElement>('[data-zerops-surface="set-custom-access"]')?.click();
    }, 250);
    return () => clearTimeout(timer);
  }, []);
  if (VIEW.kind !== "people") return null;
  if (page === "member") {
    const found = VIEW.people.find(({ key }) => key === who)!;
    const person =
      params.get("advanced") === "1"
        ? { ...found, membership: { ...presetMembership("developer"), canViewFinances: true } }
        : found;
    return (
      <TeamMemberView
        actions={{
          updateMembership: never,
          saveAccess: never,
          remove: never,
          continueChange: pressed,
          deleteChange: pressed,
        }}
        {...(op === "running" || op === "waiting" || op === "failed"
          ? { operations: [{ ...OPERATIONS[op], userId: person.userId ?? null }] }
          : {})}
        {...(params.get("grants") === "failed"
          ? {
              grantsUnread: "Couldn't read their project access from Zerops.",
              onGrantsAgain: () => {},
            }
          : {})}
        grants={
          params.get("grants") === "failed"
            ? null
            : who === "cu-karel"
              ? { "shop-prod": "READ_ONLY" }
              : { "snap-prod": "ADMIN", "beviro-prod": "READ_ONLY", "snap-fen": "OWNER" }
        }
        organizationName="Acme"
        person={person}
        projects={PROJECTS}
        viewerRole={viewerRole}
      />
    );
  }
  if (page === "invite" && sentTo !== null) {
    return <TeamList sent={[sentTo]} view={invitedTo(sentTo)} />;
  }
  if (page === "invite") {
    const details = params.get("step") === "details";
    const role = params.get("role") === "developer" ? "developer" : "guest";
    return (
      <TeamInviteView
        actions={{
          confirm: answered("confirmed" as const),
          check: answered({ kind: "new" }),
          send: answered(undefined),
        }}
        from={params.get("from") ?? (details ? "g-snap" : undefined)}
        initialEmail={details ? "marie.cerna@example.com" : ""}
        initialMembership={presetMembership(details ? role : "developer")}
        onSent={setSentTo}
        organizationName="Acme"
        projects={INVITABLE}
        viewerRole={viewerRole}
      />
    );
  }
  if (params.get("ops") === "1") {
    const view = teamPeople({
      ...INPUT,
      members: { ...INPUT.members, list: MEMBERS.filter(({ id }) => id !== "cu-nova") },
    });
    return (
      <TeamList
        onContinue={pressed}
        onDelete={pressed}
        onSendAgain={() => {}}
        operations={[...Object.values(OPERATIONS), LOST]}
        view={view}
      />
    );
  }
  return <TeamList view={VIEW} />;
}

function HarnessPage() {
  return (
    // The invitation's toast, as the app raises it.
    <ToastProvider>
      <div className="flex h-dvh bg-background text-foreground">
        <aside
          className="shrink-0 border-e border-border bg-sidebar max-md:hidden"
          style={{ width: MENU_WIDTH }}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* The team, a person and the invitation share one column, as the app's pages do. */}
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-10 pb-12">
            <Page />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

const rootRoute = createRootRoute({ component: HarnessPage });
const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/settings/team/$clientUserId" }),
  ]),
  history: createMemoryHistory(),
});

createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
