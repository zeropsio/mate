/**
 * The team as the account's data layer holds it, for the Team page, a person's page and the
 * invitation: the member list and the grants of whoever the page names, held while it is drawn;
 * the projects the organization can give, by their Mate names; who is looking; and each write as
 * the account's operation, resolving once Zerops answered and the team was read again — or
 * rejecting with what to tell the person.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  initialStream,
  membersProjectRoles,
  organizationMembers,
  shownHqProjectPeopleAtom,
  shownProjectsAtom,
  type MembersRead,
  type ResentInvitation,
  type SampledRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo } from "react";

import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useProjection,
} from "~/zerops/accountData";
import { useAccountOperationsOptional, type AccountOperations } from "~/zerops/accountOperations";
import { isChief } from "~/zerops/chief";
import { invitedNames } from "~/zerops/invitationMemory";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { writeTrouble } from "~/zerops/zeropsWrite";

import { accessProjects, inviteProjects } from "./teamMember.logic";
import { teamGrantIds, teamPeople, type TeamPlace } from "./teamSettings.logic";

const UNREAD_MEMBERS = Atom.make<MembersRead>({
  fact: { kind: "unknown" },
  coverage: "unknown",
  stream: initialStream({ parent: null, mode: "sampled" }),
  link: null,
  members: [],
  status: "loading",
  settled: false,
  refused: false,
});
const UNREAD_GRANTS = Atom.make<
  Readonly<Record<string, SampledRead<ReadonlyArray<{ projectId: string; roleCode: string }>>>>
>({});

type Intent = Parameters<AccountOperations["submit"]>[0];

/** The team, and the grants of `grantsOf` too: every developer and guest, else these people. */
export function useTeam(grantsOf?: ReadonlyArray<string>) {
  const session = useZeropsSessionOptional();
  const orgId = useAccountOrgId();
  const clientId = session?.activeOrganization?.id ?? null;
  const organizationName = session?.activeOrganization?.name ?? "this organization";
  const { registry } = useZeropsRegistry();

  useDetailDemand("organizationMembers", undefined, clientId);
  const members = useProjection(
    organizationMembers,
    orgId === null || clientId === null ? null : { orgId, clientId },
    UNREAD_MEMBERS,
  );

  // The grants a page names, held while it is drawn.
  const listed = useMemo(() => teamGrantIds(members.members), [members.members]);
  const grantIds = grantsOf ?? listed;
  const grantKey = grantIds.join(",");
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || grantKey === "") return;
    const releases = grantKey
      .split(",")
      .map((ownerId) => demandDetail({ family: "memberProjectRoles", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, grantKey]);
  const ids = useMemo(() => (grantKey === "" ? [] : grantKey.split(",")), [grantKey]);
  const grants = useProjection(
    membersProjectRoles,
    orgId === null ? null : { orgId, clientUserIds: ids },
    UNREAD_GRANTS,
  );

  const roster = useAtomValue(shownProjectsAtom).projects;
  const hqProjectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const viewerUserId = session?.user?.id ?? null;
  const viewer = useAccountDataOptional()?.viewer;

  // Where each project belongs: its Mate project, or itself outside any.
  const places = useMemo(() => {
    const byProject: Record<string, TeamPlace> = {};
    for (const { id, name } of roster) byProject[id] = { key: id, name, groupId: null };
    for (const group of registry.groups)
      for (const { projectId } of group.projects)
        byProject[projectId] = { key: group.groupId, name: group.name, groupId: group.groupId };
    return byProject;
  }, [registry, roster]);

  const view = useMemo(
    () =>
      teamPeople({
        // The names typed for invitations here, read again as the member list changes.
        invitedNames: clientId === null ? {} : invitedNames(clientId),
        members: {
          known: members.fact.kind === "known",
          status: members.status,
          refused: members.refused,
          list: members.members,
        },
        grants,
        places,
        pictures: Object.fromEntries(
          Object.values(hqProjectPeople).flatMap(({ owner }) =>
            owner === null ? [] : [[owner.userId, owner.avatarUrl]],
          ),
        ),
        viewerUserId,
        viewer:
          viewer === undefined
            ? undefined
            : {
                membershipId: viewer.membershipId,
                ...(viewer.roleCode === undefined ? {} : { roleCode: viewer.roleCode }),
              },
      }),
    [clientId, grants, hqProjectPeople, members, places, viewer, viewerUserId],
  );

  const projects = useMemo(
    () =>
      accessProjects({
        groups: registry.groups,
        roster,
        chiefs: new Set(roster.filter((project) => isChief(project)).map(({ id }) => id)),
      }),
    [registry, roster],
  );

  // What an invitation gives: each Mate project whole, as its People section gives it.
  const invitable = useMemo(
    () =>
      inviteProjects({
        groups: registry.groups,
        roster,
        chiefs: new Set(roster.filter((project) => isChief(project)).map(({ id }) => id)),
      }),
    [registry, roster],
  );

  const operations = useAccountOperationsOptional();
  /** Sends one change; resolves once Zerops answered, rejects with what to tell the person. */
  const write = useCallback(
    async (intent: Intent): Promise<void> => {
      if (operations === null) throw new Error("Zerops isn't reachable from here.");
      const { progress, evidence } = await operations.submit(intent);
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
    },
    [operations],
  );
  const check = useCallback(
    (email: string) => {
      if (operations === null || clientId === null)
        return Promise.reject(new Error("Zerops isn't reachable from here."));
      return operations.run(
        { kind: "check-invitee", orgId: clientId, email },
        { orgId: clientId, unobserved: "Zerops isn't answering. Try again." },
      );
    },
    [clientId, operations],
  );

  /**
   * Send again (`resend-invitation`): resolves once Zerops sent the invitation again, else with
   * what to tell the person and — where the earlier one is withdrawn and no new one went — what to
   * send again.
   */
  const resend = useCallback(
    async (input: {
      readonly clientUserId: string;
      readonly names?: { readonly firstName: string; readonly lastName: string };
      readonly invitation?: ResentInvitation;
    }): Promise<
      | { readonly sent: true }
      | { readonly sent: false; readonly trouble: string; readonly invitation?: ResentInvitation }
    > => {
      if (operations === null || clientId === null)
        return { sent: false, trouble: "Zerops isn't reachable from here." };
      let handed: { readonly clientUserId: string | null; readonly unsent?: string } | undefined;
      let invitation = input.invitation;
      try {
        await operations.run(
          { kind: "resend-invitation", orgId: clientId, ...input },
          {
            orgId: clientId,
            unobserved: "Check the organization's members in Zerops.",
            accepted: (result) => {
              handed = result;
              if (result.clientUserId === null) invitation = result.invitation;
            },
          },
        );
        return { sent: true };
      } catch (cause) {
        const trouble =
          handed?.unsent ?? (cause instanceof Error ? cause.message : "Zerops didn't send it.");
        // Withdrawn and sent again after all: nothing is left to send.
        if (handed !== undefined && handed.clientUserId !== null) return { sent: false, trouble };
        return { sent: false, trouble, ...(invitation === undefined ? {} : { invitation }) };
      }
    },
    [clientId, operations],
  );

  return {
    view,
    grants,
    clientId,
    organizationName,
    viewerRole: viewer?.roleCode,
    projects,
    invitable,
    writable: operations !== null && clientId !== null,
    write,
    check,
    resend,
  };
}
