/**
 * Settings › Activity: who did what in the organization — its people, Mates, GitHub, HQ and Zerops'
 * operators — newest first, a page at a time. Only its Owners and Admins read it; HQ says so to
 * anyone else.
 */
import {
  initialStream,
  organizationMembers,
  shownProjectsAtom,
  type MembersRead,
} from "@t3tools/client-runtime/data";
import { isTokenMember, mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useMemo, useState } from "react";

import { useAccountOrgId, useDetailDemand, useProjection } from "~/zerops/accountData";
import { useActivityPage } from "~/zerops/useActivity";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";

import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { activityLine, type ActivityNames } from "./activitySettings.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

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

/** The names entries are said by: the organization's members and the projects the person sees. */
function useActivityNames(): ActivityNames {
  const orgId = useAccountOrgId();
  const clientId = useZeropsSessionOptional()?.activeOrganization?.id ?? null;
  useDetailDemand("organizationMembers", undefined, clientId);
  const { members } = useProjection(
    organizationMembers,
    orgId === null || clientId === null ? null : { orgId, clientId },
    UNREAD_MEMBERS,
  );
  const projects = useAtomValue(shownProjectsAtom).projects;
  return useMemo(() => {
    const people = new Map<string, string>();
    for (const member of members) {
      if (isTokenMember(member)) continue;
      const userId = member.user?.id ?? member.userId;
      const name = mateMemberName(member);
      if (userId !== undefined && name !== undefined) people.set(userId, name);
    }
    const named = new Map(projects.map((project) => [project.id, project.name]));
    return { person: (id) => people.get(id), project: (id) => named.get(id) };
  }, [members, projects]);
}

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** One page: its entries, and the way to the older ones on the last page shown. */
function ActivityPage({
  before,
  names,
  last,
  onOlder,
}: {
  readonly before: string | null;
  readonly names: ActivityNames;
  readonly last: boolean;
  readonly onOlder: (next: string) => void;
}) {
  const { read, again } = useActivityPage(before);
  if (read.state === "unread" || read.state === "reading")
    return <Skeleton className="mx-3 h-24" />;
  if (read.state === "withheld")
    return (
      <p className="px-3 text-sm text-muted-foreground">
        Only the organization's owners and admins see its activity.
      </p>
    );
  if (read.state === "unsupported" || read.state === "failed")
    return (
      <div className="flex items-center gap-3 px-3 text-sm text-muted-foreground">
        <span>{read.words}</span>
        {read.state === "failed" ? (
          <Button size="sm" variant="secondary" onClick={again}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  const lines = read.page.entries.map((entry) => activityLine(entry, names));
  if (before === null && lines.length === 0)
    return <p className="px-3 text-sm text-muted-foreground">Nothing has happened here yet.</p>;
  return (
    <>
      {read.stale ? (
        <p className="px-3 text-xs text-muted-foreground">
          HQ could not be read again; this is what it said before.
        </p>
      ) : null}
      <ul className="divide-y divide-border/60" data-activity-page={before ?? "newest"}>
        {lines.map((line) => (
          <li
            key={line.key}
            className="flex flex-col gap-0.5 px-3 py-2 text-sm"
            data-activity-entry={line.key}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-foreground">{line.who}</span>
              <span className="text-foreground">{line.what}</span>
              {line.outcome !== null ? (
                <span className="text-xs text-warning-foreground">{line.outcome}</span>
              ) : null}
              <time className="ml-auto shrink-0 text-xs text-muted-foreground" dateTime={line.at}>
                {when(line.at)}
              </time>
            </div>
            {line.subject !== null ? (
              <span
                className={
                  line.subject.code
                    ? "truncate font-mono text-xs text-muted-foreground"
                    : "truncate text-xs text-muted-foreground"
                }
              >
                {line.subject.text}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {last && read.page.next !== null ? (
        <div className="px-3">
          <Button size="sm" variant="secondary" onClick={() => onOlder(read.page.next as string)}>
            Show older
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function ActivitySettings() {
  const names = useActivityNames();
  // The pages shown, by the entry each reads before: the newest first, then each "Show older".
  const [pages, setPages] = useState<ReadonlyArray<string | null>>([null]);
  return (
    <SettingsPageContainer>
      <SettingsSection {...searchableSetting("activity")}>
        {pages.map((before, index) => (
          <ActivityPage
            key={before ?? "newest"}
            before={before}
            names={names}
            last={index === pages.length - 1}
            onOlder={(next) => setPages((shown) => [...shown, next])}
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
