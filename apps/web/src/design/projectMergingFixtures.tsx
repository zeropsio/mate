/**
 * Who can merge, in every state its row and its section have: for the project automation harness
 * (`/design-project-automation.html?merging=<state>`) and the harness's project page
 * (`/design-overview.html?page=tea`). Made-up people only.
 *
 * `?merging=` takes `all` (every state, one under another) or one of `everyone`, `limited`,
 * `saving`, `refused`, `member`, `member-everyone`, `member-unseen`, `older`, `reading`, `left`,
 * `open-main`, `open-main-permission`. A state an Owner or Admin can edit is
 * live: the choice and the picks change, and Save rests where it would.
 *
 * Fixtures only. Nothing here ships.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { useState, type ReactNode } from "react";

import {
  MergingNeedsUpdate,
  ProjectMergingRow,
  ProjectMergingView,
  type MergingPeopleView,
} from "~/components/zerops/projectMerging/ProjectMerging";
import {
  MERGING_TITLE,
  mergingDraft,
  mergingPeople,
  openMains,
  type MergersPeople,
  type MergingDraft,
  type OpenMain,
} from "~/components/zerops/projectMerging/projectMerging.logic";
import { SectionAction, SectionLabel } from "~/components/zerops/system";
import type { MergingPress } from "~/zerops/useAppMergers";

const nothing = () => {};

const member = (id: string, fullName: string, roleCode: string): ZeropsOrganizationMember => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id: `u-${id}`, fullName },
});

const MEMBERS = [
  member("mira", "Mira Osei", "OWNER"),
  member("teo", "Teo Hartmann", "ADMIN"),
  member("ada", "Ada Keller", "BASIC_USER"),
  member("sam", "Sam Rivers", "BASIC_USER"),
  member("lee", "Lee Park", "NO_ACCESS"),
  member("noor", "Noor Tan", "READ_ONLY"),
  member("kim", "Kim Lund", "NO_ACCESS"),
];

const TWO_NAMED: MergersPeople = ["u-ada", "u-sam"];

/** A repository on GitHub through the organization's app, as GitHub's rules on its main stand. */
const onGithub = (governance: "no_ruleset" | "permission_not_approved") =>
  openMains([
    {
      remote: {
        url: "https://github.com/acme/tea-shop.git",
        repositoryId: "7",
        keptAt: "2026-10-17T09:00:00Z",
        keptBy: "Mira Osei",
        expiresAt: null,
        invalidSince: null,
        via: "app",
        githubAppId: 123456,
        governance,
      },
    },
  ]);

interface MergingState {
  readonly title: string;
  /** Who merges as HQ holds it. */
  readonly current: MergersPeople;
  /** What the person has chosen and not saved; absent: what stands. */
  readonly draft?: MergingDraft;
  readonly editable: boolean | undefined;
  readonly press?: MergingPress;
  readonly older?: boolean;
  readonly reading?: boolean;
  /** Zerops does not let this person read the organization's people (a guest). */
  readonly unseen?: boolean;
  /** The project's repositories whose main is open on GitHub. */
  readonly open?: ReadonlyArray<OpenMain>;
}

export const MERGING_STATES = {
  everyone: {
    title: "Everyone working here can merge — an Owner or Admin",
    current: null,
    editable: true,
  },
  limited: {
    title: "Limited, two people named — an Owner or Admin",
    current: TWO_NAMED,
    editable: true,
  },
  saving: {
    title: "Saving the limit",
    current: null,
    draft: { limited: true, people: ["u-ada", "u-sam"] },
    editable: true,
    press: { kind: "saving" },
  },
  refused: {
    title: "HQ refused: someone picked left the organization",
    current: TWO_NAMED,
    draft: { limited: true, people: ["u-ada", "u-sam", "u-ines"] },
    editable: true,
    press: {
      kind: "refused",
      words:
        "Someone you picked is no longer an active member of this organization. Uncheck them and save again.",
    },
  },
  member: {
    title: "A member reads it",
    current: TWO_NAMED,
    editable: false,
  },
  "member-everyone": {
    title: "A member reads it — nothing limited",
    current: null,
    editable: false,
  },
  "member-unseen": {
    title: "A guest reads it — Zerops does not show them the organization's people",
    current: TWO_NAMED,
    editable: false,
    unseen: true,
  },
  older: {
    title: "An HQ older than the setting",
    current: null,
    editable: true,
    older: true,
  },
  reading: {
    title: "Limited, the organization's people still being read",
    current: TWO_NAMED,
    editable: true,
    reading: true,
  },
  left: {
    title: "Someone named is no longer in the organization",
    current: ["u-ada", "u-ines"],
    editable: true,
  },
  "open-main": {
    title: "Limited, and GitHub's main has no ruleset: a Mate can still push to it",
    current: TWO_NAMED,
    editable: true,
    open: onGithub("no_ruleset"),
  },
  "open-main-permission": {
    title: "Limited, and Mate's GitHub app cannot approve merges yet",
    current: TWO_NAMED,
    editable: true,
    open: onGithub("permission_not_approved"),
  },
} satisfies Readonly<Record<string, MergingState>>;

export type MergingStateName = keyof typeof MERGING_STATES;

export const isMergingState = (name: string): name is MergingStateName =>
  Object.hasOwn(MERGING_STATES, name);

/** The section as the project page frames it: its label, *Close*, then its card. */
function Section({ children }: { readonly children: ReactNode }) {
  return (
    <section aria-label={MERGING_TITLE} className="pp-group">
      <SectionLabel action={<SectionAction onClick={nothing}>Close</SectionAction>}>
        {MERGING_TITLE}
      </SectionLabel>
      <div className="pp-card pp-detail">{children}</div>
    </section>
  );
}

/** The section's body in one state; where it can be edited, the draft is live. */
export function MergingBody({ state }: { readonly state: MergingState }) {
  const [draft, setDraft] = useState(state.draft ?? mergingDraft(state.current));
  if (state.older === true) return <MergingNeedsUpdate />;
  const choices: MergingPeopleView =
    state.reading === true
      ? { kind: "reading" }
      : state.unseen === true
        ? { kind: "unreadable", line: "Zerops doesn't let you see this organization's people." }
        : {
            kind: "known",
            people: mergingPeople(MEMBERS, [...(state.current ?? []), ...draft.people]),
          };
  return (
    <ProjectMergingView
      choices={choices}
      current={state.current}
      draft={draft}
      editable={state.editable}
      onDraft={setDraft}
      onSave={nothing}
      open={state.open}
      press={state.press ?? { kind: "idle" }}
    />
  );
}

/** The Merging row in one state, as the page's side column holds it. */
export function MergingRow({
  state,
  onManage = nothing,
}: {
  readonly state: MergingState;
  readonly onManage?: (from: HTMLElement) => void;
}) {
  return (
    <ProjectMergingRow
      merging={{ people: state.current, older: state.older === true, editable: state.editable }}
      onManage={onManage}
      open={state.open}
    />
  );
}

/** One state: its row at the side column's width beside its section at the main column's. */
function MergingStatePanel({ name }: { readonly name: MergingStateName }) {
  const state: MergingState = MERGING_STATES[name];
  return (
    <section className="grid content-start gap-3" data-merging-state={name}>
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {state.title}
      </h2>
      <div className="grid grid-cols-[minmax(0,700px)_minmax(0,360px)] items-start gap-10">
        <Section>
          <MergingBody state={state} />
        </Section>
        <div className="pp-setup grid">
          <MergingRow state={state} />
        </div>
      </div>
    </section>
  );
}

/** `?merging=all`, or one state by its name. */
export function MergingHarness({ show }: { readonly show: string }) {
  const names = isMergingState(show)
    ? [show]
    : (Object.keys(MERGING_STATES) as ReadonlyArray<MergingStateName>);
  return (
    <div className="grid content-start gap-10 bg-background p-8 text-foreground">
      {names.map((name) => (
        <MergingStatePanel key={name} name={name} />
      ))}
    </div>
  );
}
