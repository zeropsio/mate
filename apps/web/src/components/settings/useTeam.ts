/**
 * The team as the account's data layer holds it, for the Team page, a person's page and the
 * invitation: the member list and the grants of whoever the page names, held while it is drawn;
 * the projects the organization can give, by their Mate names; who is looking; the viewer's access
 * changes HQ runs; and each write as the account's operation, resolving once its owner answered —
 * or rejecting with what to tell the person.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accessOperations,
  accountReadsAtom,
  initialStream,
  membersProjectRoles,
  NO_ACCESS_OPERATIONS,
  organizationMembers,
  shownHqProjectPeopleAtom,
  shownProjectsAtom,
  type MembersRead,
  type SampledRead,
} from "@t3tools/client-runtime/data";
import type { HqAccessChange } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useProjection,
} from "~/zerops/accountData";
import { randomUUID } from "~/lib/utils";
import { useAccountOperationsOptional, type AccountOperations } from "~/zerops/accountOperations";
import { isChief } from "@t3tools/client-runtime/zerops/chief";
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
const NO_OPERATIONS = Atom.make(NO_ACCESS_OPERATIONS);
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
  const account = useAccountDataOptional();
  const viewer = account?.viewer;
  const retryDetail = account?.retryDetail;
  /** The person's *Try again* on one person's grants, once that read failed. */
  const retryGrants = useCallback(
    (clientUserId: string) =>
      retryDetail?.({ family: "memberProjectRoles", ownerId: clientUserId }),
    [retryDetail],
  );

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
   * Starts one person's access change at HQ (`start-access-changes`), under an id chosen here:
   * resolves once HQ took it, rejects with HQ's refusal in words. HQ runs it whatever becomes of
   * this tab; its row reads how it goes (`accessOperations`).
   */
  const startAccessChange = useCallback(
    (change: HqAccessChange) => {
      if (clientId === null) return Promise.reject(new Error("Zerops isn't reachable from here."));
      return write({
        kind: "start-access-changes",
        orgId: clientId,
        changes: [{ id: randomUUID(), change }],
      });
    },
    [clientId, write],
  );
  /** Continue on a change waiting for the viewer's fresh sign-in; Delete on one that stopped. */
  const continueAccessChange = useCallback(
    (id: string) =>
      clientId === null
        ? Promise.reject(new Error("Zerops isn't reachable from here."))
        : write({ kind: "continue-operation", orgId: clientId, id }),
    [clientId, write],
  );
  const deleteAccessChange = useCallback(
    (id: string) =>
      clientId === null
        ? Promise.reject(new Error("Zerops isn't reachable from here."))
        : write({ kind: "delete-access-change", orgId: clientId, id }),
    [clientId, write],
  );

  // The viewer's access changes, as HQ shows them to their maker.
  const operationsOf = useProjection(
    accessOperations,
    clientId === null ? null : { orgId: clientId, viewer: viewerUserId },
    NO_OPERATIONS,
  );
  // A change that stopped running moved the team in Zerops: its list, and the changed person's
  // grants, which no stream carries, are read again once — on HQ's word, never on a cadence.
  const running = useRef<ReadonlyMap<string, string | null>>(new Map());
  const memberList = members.members;
  useEffect(() => {
    const now = new Map(
      operationsOf.flatMap(({ id, state, userId }) => (state === "running" ? [[id, userId]] : [])),
    );
    const ended = [...running.current].flatMap(([id, userId]) => (now.has(id) ? [] : [userId]));
    running.current = now;
    if (ended.length === 0 || clientId === null || retryDetail === undefined) return;
    retryDetail({ family: "organizationMembers", ownerId: clientId });
    for (const member of memberList)
      if (ended.includes(member.user?.id ?? member.userId ?? null))
        retryDetail({ family: "memberProjectRoles", ownerId: member.id });
  }, [clientId, memberList, operationsOf, retryDetail]);

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
    startAccessChange,
    continueAccessChange,
    deleteAccessChange,
    operations: operationsOf,
    retryGrants,
  };
}
