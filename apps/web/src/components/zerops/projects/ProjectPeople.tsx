/**
 * A project's People: who can work on it and how, read-only. The organization's members, the
 * grants on the project's places and whose each Mate is, all through the account's data layer;
 * each place's own row — the only read naming everybody's grants — is held while it is shown.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  initialStream,
  organizationMembers,
  projectsGrants,
  shownHqProjectPeopleAtom,
  shownProjectsAtom,
  type MembersRead,
  type ProjectGrantsRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { useAccountOrgId, useDetailDemand, useProjection } from "~/zerops/accountData";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";

import { Avatar } from "../primitives";
import {
  projectPeople,
  type ProjectPeopleInput,
  type ProjectPeopleView,
} from "./projectPeople.logic";

/** Outside an account nothing is read: every place's grants are still to come. */
const UNREAD_GRANTS = Atom.make<Readonly<Record<string, ProjectGrantsRead>>>({});
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

/** Who can work on the group `groupId`, as the data layer holds it now. */
function useProjectPeople(groupId: string): ProjectPeopleView {
  const session = useZeropsSessionOptional();
  const orgId = useAccountOrgId();
  const { registry } = useZeropsRegistry();
  const projects = useMemo(
    () => registry.groups.find((group) => group.groupId === groupId)?.projects ?? [],
    [groupId, registry],
  );
  const placeIds = useMemo(
    () => projects.flatMap(({ projectId, kind }) => (kind === "mate" ? [] : [projectId])),
    [projects],
  );
  const placeKey = placeIds.join(",");

  // Each place's own row, held while the section is drawn: everybody's grants come only with it.
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || placeKey === "") return;
    const releases = placeKey
      .split(",")
      .map((ownerId) => demandDetail({ family: "project", listing: "project", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, placeKey]);

  // The organization's members: who they are, their role, whether they joined. Displayed here,
  // never a gate: what anyone may do is Zerops' and HQ's to decide.
  const clientId = session?.activeOrganization?.id ?? null;
  useDetailDemand("organizationMembers", undefined, clientId);
  const members = useProjection(
    organizationMembers,
    orgId === null || clientId === null ? null : { orgId, clientId },
    UNREAD_MEMBERS,
  );
  const grants = useProjection(
    projectsGrants,
    orgId === null ? null : { orgId, projectIds: placeIds },
    UNREAD_GRANTS,
  );
  const roster = useAtomValue(shownProjectsAtom).projects;
  const hqProjectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const viewerUserId = session?.user?.id ?? null;

  return useMemo(() => {
    const input: ProjectPeopleInput = {
      members: {
        known: members.fact.kind === "known",
        status: members.status,
        refused: members.refused,
        list: members.members,
      },
      projects: projects.map(({ projectId, kind }) => {
        const name = roster.find(({ id }) => id === projectId)?.name;
        return { projectId, kind, ...(name === undefined ? {} : { name }) };
      }),
      grants,
      owners: Object.fromEntries(
        projects.map(({ projectId }) => [projectId, hqProjectPeople[projectId]?.owner?.userId]),
      ),
      // The pictures the menu's faces draw owners with, as HQ names them.
      pictures: Object.fromEntries(
        Object.values(hqProjectPeople).flatMap(({ owner }) =>
          owner === null ? [] : [[owner.userId, owner.avatarUrl]],
        ),
      ),
      viewerUserId,
    };
    return projectPeople(input);
  }, [grants, hqProjectPeople, members, projects, roster, viewerUserId]);
}

/** The People section of a project page, for the group `groupId`. */
export function ProjectPeople({ groupId }: { groupId: string }) {
  return <ProjectPeopleList view={useProjectPeople(groupId)} />;
}

/** The section as drawn from what is known of the people. */
export function ProjectPeopleList({ view }: { readonly view: ProjectPeopleView }) {
  return (
    <section className="ov-sec" aria-label="People">
      <h3 className="ov-sec-name">People</h3>
      {view.kind === "reading" ? (
        <p className="ov-sec-empty">Reading who has access…</p>
      ) : view.kind === "unreadable" ? (
        <p className="ov-sec-empty">{view.line}</p>
      ) : view.people.length === 0 ? (
        <p className="ov-sec-empty">Nobody has access yet.</p>
      ) : (
        <ul className="ov-people">
          {view.people.map((person) => (
            <li className="ov-person" data-pending={person.pending || undefined} key={person.key}>
              <Avatar initials={person.initials} size="md" src={person.avatarUrl} />
              <div className="ov-mate-text">
                <div className="ov-mate-l1">
                  <span className="ov-mate-name">{person.name}</span>
                  {person.you ? <span className="ov-person-you">You</span> : null}
                </div>
                <span className="ov-mate-l2">{person.line}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
