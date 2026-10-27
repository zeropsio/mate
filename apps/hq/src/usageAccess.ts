import type { OrgView } from "./roles.ts";
import { can } from "./permissions.ts";
import { asOrgRole, roleAtLeast } from "@t3tools/shared/zeropsRoles";
/**
 * Retired history never inherits a former project grant: it is read with the org role that
 * observes every Mate by default (Basic user), and where Zerops still has the project, only as it
 * observes it there. An existing hidden project stays live.
 */
export const mayReadUsage = (
  facts: OrgView,
  userId: string,
  projectId: string,
  deleted: boolean,
) => {
  const member = facts.members.find(
    (value) => value.kind === "person" && value.userId === userId && value.status === "ACTIVE",
  );
  if (member === undefined) return false;
  const listed = facts.projects.some((project) => project.id === projectId);
  const observes = () =>
    can({ kind: "person", userId }, "observe_mate", { projectId }, facts).allow;
  if (deleted) {
    return roleAtLeast(asOrgRole(member.roleCode), "BASIC_USER") && (!listed || observes());
  }
  return listed && observes();
};
/** The same canonical owner rule used for navigation and retained usage grouping. */
export const usageOwner = (input: {
  readonly facts: OrgView;
  readonly projectId: string;
  readonly everSignedIn: Readonly<Record<string, string>>;
  readonly runsWithoutSignIn: boolean;
  readonly madeBy: string | null;
  readonly standupRequestedBy: string | null;
}) => {
  const owner = input.facts.projects
    .find((project) => project.id === input.projectId)
    ?.userRoles.find((role) => role.roleCode === "OWNER");
  if (owner !== undefined)
    return (
      input.facts.members.find(
        (member) => member.kind === "person" && member.clientUserId === owner.clientUserId,
      )?.userId ?? null
    );
  // Zerops makes a project's creator its OWNER only below Admin; an Admin's or Owner's Mate is
  // theirs from the moment they add it, the same for every role, and stays theirs whoever signs
  // its agent in later. A Mate recorded before HQ kept its maker names whoever asked for its
  // stand-up; one naming neither is its signer's. An integration token is nobody's maker.
  const maker = [input.madeBy, input.standupRequestedBy].find(
    (userId): userId is string =>
      userId !== null &&
      !input.facts.members.some((member) => member.kind === "token" && member.userId === userId),
  );
  return maker ?? input.everSignedIn["claude-code"] ?? input.everSignedIn.codex ?? null;
};

/** One owner derivation for navigation and a Mate's Chief authority. */
export function mateOwner(input: {
  readonly facts: OrgView;
  readonly projectId: string;
  readonly mate?:
    | {
        readonly signers?: Readonly<Record<string, string>>;
        readonly madeBy: string | null;
        readonly standupRequestedBy: string | null;
      }
    | null
    | undefined;
  readonly overview?: import("./mateOverviews.ts").MateOverviewEntry["overview"] | undefined;
}) {
  const everSignedIn: Record<string, string> = {};
  for (const key of new Set([
    ...Object.keys(input.mate?.signers ?? {}),
    ...Object.keys(input.overview?.logins ?? {}),
  ])) {
    const login = input.overview?.logins[key];
    const user =
      (login?.token ? undefined : login?.signedInBy) ??
      login?.lastSignedInBy ??
      input.mate?.signers?.[key];
    if (
      typeof user === "string" &&
      user.length > 0 &&
      !input.facts.members.some((member) => member.kind === "token" && member.userId === user)
    ) {
      everSignedIn[key] = user;
    }
  }
  return usageOwner({
    facts: input.facts,
    projectId: input.projectId,
    everSignedIn,
    runsWithoutSignIn: input.overview?.identity.runsWithoutSignIn === true,
    madeBy: input.mate?.madeBy ?? null,
    standupRequestedBy: input.mate?.standupRequestedBy ?? null,
  });
}

/**
 * The person HQ records as a Mate's owner: the person whose registered Chief it is, else
 * `mateOwner`. What a reader's navigation says and what the Mate's own link names (`link.ts`).
 */
export const recordedMateOwner = (
  input: Parameters<typeof mateOwner>[0] & { readonly chiefOf: string | undefined },
) => input.chiefOf ?? mateOwner(input);
