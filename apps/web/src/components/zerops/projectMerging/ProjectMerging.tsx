/**
 * Who merges a project's changes, on the project's page: the Merging row of its side column, whose
 * line says where the setting stands, and the section its *Manage* opens — everyone working on it,
 * or only the organization's Owner and Admins and the people picked. An Owner or Admin changes it
 * with one Save; anyone else reads who merges, by name: whom to ask. HQ enforces it at the merge
 * (`not_app_merger`).
 */
import { MERGERS_NEED_UPDATE, MERGERS_WRITERS } from "@t3tools/client-runtime/zerops/hq";
import type { MembersRead } from "@t3tools/client-runtime/data";
import { useMemo, useState } from "react";

import { useMergingMembers, type AppMergers, type MergingPress } from "~/zerops/useAppMergers";

import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Label } from "../../ui/label";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { Skeleton } from "../../ui/skeleton";
import { SetupRow } from "../project/SetupCard";
import { SectionAction } from "../system";
import {
  draftPicked,
  draftSends,
  MERGING_TITLE,
  mergingDraft,
  mergingLine,
  mergingNow,
  mergingPeople,
  mergingSave,
  type MergersPeople,
  type MergingDraft,
  type MergingPerson,
} from "./projectMerging.logic";

/**
 * The Merging row of a project page's side column: where the setting stands in one line, and
 * *Manage*, which opens the section (`ProjectMerging`); *View* for whoever only reads it, where
 * there are people to read. On an HQ older than the setting it says so and offers nothing.
 */
export function ProjectMergingRow({
  merging,
  onManage,
}: {
  readonly merging: Pick<AppMergers, "people" | "older" | "editable">;
  readonly onManage: (from: HTMLElement) => void;
}) {
  const { people, older, editable } = merging;
  return (
    <SetupRow
      action={
        // Where nothing is limited the line is all a reader's section would say.
        older || people === undefined || (editable === false && people === null) ? undefined : (
          <SectionAction onClick={onManage}>{editable === false ? "View" : "Manage"}</SectionAction>
        )
      }
      busy={!older && people === undefined}
      label="Merging"
      surface="project-merging-row"
    >
      <div className="flex min-h-7 min-w-0 items-center">
        {older ? (
          <span className="text-line text-muted-foreground">{MERGERS_NEED_UPDATE}</span>
        ) : people === undefined ? (
          <Skeleton className="h-5 w-48" />
        ) : (
          <span className="text-sm text-foreground">{mergingLine(people)}</span>
        )}
      </div>
    </SetupRow>
  );
}

/** The people to pick from, as the section draws them. */
export type MergingPeopleView =
  | { readonly kind: "reading" }
  | { readonly kind: "unreadable"; readonly line: string }
  | { readonly kind: "known"; readonly people: ReadonlyArray<MergingPerson> };

/** The member list as the checklist reads it; its last answer stands while it is read again. */
export function mergingPeopleView(
  members: Pick<MembersRead, "fact" | "members" | "status" | "refused">,
  named: ReadonlyArray<string>,
): MergingPeopleView {
  if (members.fact.kind === "known")
    return { kind: "known", people: mergingPeople(members.members, named) };
  if (members.refused)
    return { kind: "unreadable", line: "Zerops doesn't let you see this organization's people." };
  return members.status === "failed"
    ? { kind: "unreadable", line: "Couldn't read this organization's people. Reload to try again." }
    : { kind: "reading" };
}

/** The section over the account: the organization's members, and the draft being edited. */
export function ProjectMerging({ merging }: { readonly merging: AppMergers }) {
  const members = useMergingMembers();
  // `null`: nothing edited, so the choice follows what stands.
  const [edited, setEdited] = useState<MergingDraft | null>(null);
  const { people } = merging;
  const draft = useMemo(() => edited ?? mergingDraft(people ?? null), [edited, people]);
  // Whoever stands named stays in the list while unchecked, until the save.
  const choices = useMemo(
    () => mergingPeopleView(members, [...(people ?? []), ...draft.people]),
    [draft.people, members, people],
  );
  if (merging.older) return <MergingNeedsUpdate />;
  if (people === undefined) return <Skeleton className="h-16 w-full" />;
  const { save } = merging;
  return (
    <ProjectMergingView
      choices={choices}
      current={people}
      draft={draft}
      editable={save === undefined ? undefined : merging.editable}
      onDraft={setEdited}
      onSave={() => {
        save?.(draftSends(draft), () => {
          setEdited(null);
        });
      }}
      press={merging.press}
    />
  );
}

/** The section on an HQ older than the setting: what it needs, and nothing to press. */
export function MergingNeedsUpdate() {
  return <p className="px-1 text-sm text-muted-foreground">{MERGERS_NEED_UPDATE}</p>;
}

/** What merging is, and when limiting it helps. */
const MERGING_IS =
  "Merging puts a change on main. Limit it when not everyone working here should decide what lands there.";

export function ProjectMergingView({
  current,
  draft,
  choices,
  editable,
  press,
  onDraft,
  onSave,
}: {
  /** Who merges as it stands: what Save is measured against. */
  readonly current: MergersPeople;
  readonly draft: MergingDraft;
  readonly choices: MergingPeopleView;
  /** An Owner or Admin changes it; `false` reads it; `undefined` while their role is not read. */
  readonly editable: boolean | undefined;
  readonly press: MergingPress;
  readonly onDraft: (draft: MergingDraft) => void;
  readonly onSave: () => void;
}) {
  const saving = press.kind === "saving";
  if (editable === false) return <MergingRead choices={choices} current={current} />;
  const locked = editable !== true || saving;
  const { enabled, tooMany } = mergingSave(current, draft);
  const picked = new Set(draft.people);
  return (
    <div className="flex flex-col gap-4 p-1" data-zerops-surface="project-merging">
      <p className="text-sm text-muted-foreground">{MERGING_IS}</p>
      <RadioGroup
        aria-label={MERGING_TITLE}
        disabled={locked}
        onValueChange={(value) => {
          onDraft({ ...draft, limited: value === "limited" });
        }}
        value={draft.limited ? "limited" : "everyone"}
      >
        <Label>
          <Radio value="everyone" />
          Everyone working on this project
        </Label>
        <Label>
          <Radio value="limited" />
          Only the Owner, Admins and people you pick
        </Label>
      </RadioGroup>
      {!draft.limited ? null : choices.kind === "reading" ? (
        <div aria-busy="true" className="flex flex-col gap-2 ps-6">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-52" />
        </div>
      ) : choices.kind === "unreadable" ? (
        <p className="ps-6 text-sm text-muted-foreground">{choices.line}</p>
      ) : (
        <ul aria-label="People who merge" className="flex max-h-80 flex-col overflow-y-auto ps-6">
          {choices.people.map((person) => (
            <li className="flex min-h-8 min-w-0 items-center gap-2" key={person.userId}>
              <Label>
                <Checkbox
                  checked={person.always || picked.has(person.userId)}
                  disabled={locked || person.always}
                  onCheckedChange={(checked) => {
                    onDraft(draftPicked(draft, person.userId, checked));
                  }}
                />
                {person.name}
              </Label>
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                {person.always ? `${person.role} · always` : person.role}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editable === true ? (
        <div className="flex min-h-7 items-center gap-3">
          <Button disabled={!enabled || saving} onClick={onSave} size="sm" variant="primary">
            {saving ? "Saving…" : "Save"}
          </Button>
          {press.kind === "refused" ? (
            <span className="min-w-0 text-sm text-destructive-foreground" role="alert">
              {press.words}
            </span>
          ) : tooMany === undefined ? null : (
            <span className="min-w-0 text-sm text-muted-foreground">{tooMany}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The section as anyone but an Owner or Admin reads it: who merges here, by name, and who changes
 * that. Nothing to press.
 */
function MergingRead({
  current,
  choices,
}: {
  readonly current: MergersPeople;
  readonly choices: MergingPeopleView;
}) {
  return (
    <div className="flex flex-col gap-3 p-1" data-zerops-surface="project-merging">
      <p className="text-sm text-foreground">
        {current === null
          ? "Everyone working on this project can merge."
          : choices.kind === "unreadable"
            ? `${mergingLine(current)}.`
            : "Only these people merge here."}
      </p>
      {current === null ? null : choices.kind === "reading" ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : choices.kind === "unreadable" ? (
        <p className="text-sm text-muted-foreground">{choices.line}</p>
      ) : (
        <ul aria-label="People who merge" className="flex max-h-80 flex-col overflow-y-auto">
          {mergingNow(choices.people, current).map((person) => (
            <li className="flex min-h-7 min-w-0 items-center gap-2" key={person.userId}>
              <span className="text-sm font-medium text-foreground">{person.name}</span>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{person.role}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{MERGERS_WRITERS}</p>
    </div>
  );
}
