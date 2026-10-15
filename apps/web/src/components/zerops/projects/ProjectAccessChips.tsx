/**
 * Who reaches a Zerops project — or every project of an app — as people chips: a face, a short
 * name and the level they have there, a hover card with who they are, and a ··· for whoever may
 * change it; then *Add access*, which picks people already in the organization who reach none of
 * it yet, each at Read or Full. Inviting someone new by e-mail lives on the Team page.
 *
 * A pure view: what is known of the people (`projectPeople.logic.ts`) and what is being changed of
 * them arrive; each choice goes back to the caller, which writes it — or, in a creation's draft,
 * keeps it.
 */
import { Link } from "@tanstack/react-router";
import {
  CogIcon,
  CrownIcon,
  EyeIcon,
  EyeOffIcon,
  LockOpenIcon,
  MoreVerticalIcon,
  PlusIcon,
  SplitIcon,
} from "lucide-react";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import { useMemo, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Row } from "../../ui/row";
import { Input } from "../../ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { PersonAvatar } from "../primitives";
import {
  ACCESS_LEVEL_LINES,
  asksFirst,
  BADGE_WORDS,
  personMenu,
  type AccessCandidate,
  type ChipLevel,
  type GivenLevel,
  type PersonChange,
  type ProjectPeopleView,
  type ProjectPerson,
} from "./projectPeople.logic";

/**
 * A creation form's *Project access*: the host draws the draft (`ProjectAccessDraft`), which says
 * each change of the list the creation sends; a form without one sends none.
 */
export type ProjectAccessSlot = (
  onChange: (userRoles: ReadonlyArray<ProjectGrant>) => void,
) => ReactNode;

/** A choice from a person's ···: a level, or the way out. */
export type AccessChoice = GivenLevel | NonNullable<PersonChange["end"]>;

/** Where a person's own Team page is, by membership id: the chip's face leads there. */
export type PersonPageLink = (clientUserId: string) => boolean;

/** Someone picked in *Add access*, at the level ticked for them. */
export interface AccessPick {
  readonly candidate: AccessCandidate;
  readonly level: GivenLevel;
}

export interface ProjectAccessChipsProps {
  readonly view: ProjectPeopleView;
  /** The section's name, and the list's. */
  readonly label?: string;
  /** Drawn as a card section with its own heading; `false` where the host names it. */
  readonly heading?: boolean;
  /** The chips whose access is being changed now, by key. */
  readonly saving?: ReadonlySet<string>;
  /** What a change's refusal said, by chip key; `add` for adding people. */
  readonly troubles?: Readonly<Record<string, string>>;
  /** A menu choice; absent, nobody's access is changed from here. */
  readonly onChoose?: (person: ProjectPerson, choice: AccessChoice) => void;
  /** People added; absent, nobody is added from here. */
  readonly onAdd?: (picks: ReadonlyArray<AccessPick>) => void;
  /** Adding is under way. */
  readonly adding?: boolean;
  /** Whether a chip's face leads to that person's Team page; absent, none does. */
  readonly personPage?: PersonPageLink;
}

/** A badge's level: a chip's, or `owner` on a project someone owns. */
export type BadgeLevel = ChipLevel | "owner";

const BADGE_ICON: Readonly<Record<BadgeLevel, typeof LockOpenIcon>> = {
  owner: CrownIcon,
  full: LockOpenIcon,
  basic: CogIcon,
  read: EyeIcon,
  mixed: SplitIcon,
  hidden: EyeOffIcon,
};

/** The key a refusal to add people is said under. */
export const ADD_TROUBLE = "add";

export function ProjectAccessChips({
  view,
  label = "Project access",
  heading = true,
  saving,
  troubles,
  onChoose,
  onAdd,
  adding = false,
  personPage,
}: ProjectAccessChipsProps) {
  const people = view.kind === "people" ? view.people : [];
  const said = Object.entries(troubles ?? {}).flatMap(([key, line]) => {
    if (key === ADD_TROUBLE) return [{ key, line }];
    const person = people.find((one) => one.key === key);
    return person === undefined ? [] : [{ key, line: `${person.name}: ${line}` }];
  });
  return (
    <section className={heading ? "ov-sec" : "ov-access"} aria-label={label}>
      {heading ? <h3 className="ov-sec-name">{label}</h3> : null}
      {view.kind === "reading" ? (
        <p className="ov-sec-empty">Reading who has access…</p>
      ) : view.kind === "unreadable" ? (
        <p className="ov-sec-empty">{view.line}</p>
      ) : (
        <ul aria-label={label} className="ov-chips">
          {view.people.map((person) => (
            <AccessChip
              busy={saving?.has(person.key) === true}
              key={person.key}
              linked={personPage?.(person.key) === true}
              {...(onChoose === undefined
                ? {}
                : { onChoose: (choice: AccessChoice) => onChoose(person, choice) })}
              person={person}
            />
          ))}
          {view.invite && onAdd !== undefined && view.candidates.length > 0 ? (
            <li className="ov-chip-slot">
              <AddAccess adding={adding} candidates={view.candidates} onAdd={onAdd} />
            </li>
          ) : null}
        </ul>
      )}
      {said.map(({ key, line }) => (
        <p className="ov-sec-empty" data-tone="failed" key={key} role="alert">
          {line}
        </p>
      ))}
    </section>
  );
}

/** The level a chip holds, as a small badge: an icon and a word. */
export function AccessBadge({ level, busy = false }: { level: BadgeLevel; busy?: boolean }) {
  const Icon = BADGE_ICON[level];
  return (
    <span
      className="ov-chip-badge"
      data-level={busy ? undefined : level === "owner" ? "full" : level}
      data-part="badge"
    >
      {busy ? null : <Icon aria-hidden="true" className="size-3" />}
      {busy ? "Saving…" : level === "owner" ? "Owner" : BADGE_WORDS[level]}
    </span>
  );
}

function AccessChip({
  person,
  busy,
  linked,
  onChoose,
}: {
  readonly person: ProjectPerson;
  readonly busy: boolean;
  /** The face leads to the person's own Team page. */
  readonly linked: boolean;
  readonly onChoose?: (choice: AccessChoice) => void;
}) {
  const change = person.change;
  const [asking, setAsking] = useState<AccessChoice | null>(null);
  const choose = (choice: AccessChoice) => {
    if (change !== null && asksFirst(change, choice)) setAsking(choice);
    else onChoose?.(choice);
  };
  return (
    <li
      className="ov-chip"
      data-menu={(change !== null && onChoose !== undefined) || undefined}
      data-pending={person.pending || undefined}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            linked ? (
              <Link
                className="ov-chip-who"
                params={{ clientUserId: person.key }}
                to="/settings/team/$clientUserId"
              />
            ) : (
              <span className="ov-chip-who" />
            )
          }
        >
          <PersonAvatar name={person.name} picture={person.avatarUrl} size={32} />
          <span className="ov-chip-text">
            <span
              className="ov-chip-name"
              data-creator={person.creator || undefined}
              data-part="name"
            >
              {person.creator ? "You" : person.short}
            </span>
            <AccessBadge busy={busy} level={person.level} />
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          <HoverCard person={person} />
        </TooltipPopup>
      </Tooltip>
      {change === null || onChoose === undefined ? null : (
        <ChipMenu busy={busy} change={change} name={person.name} onChoose={choose} />
      )}
      {change?.selfLower === undefined ? null : (
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          open={asking !== null}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>{change.selfLower.title}</AlertDialogTitle>
              <AlertDialogDescription>{change.selfLower.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <Button
                onClick={() => {
                  if (asking !== null) onChoose?.(asking);
                  setAsking(null);
                }}
                variant="destructive"
              >
                Give it up
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}
    </li>
  );
}

/** Who someone is: full name, e-mail and role — then each project's level where they differ. */
function HoverCard({ person }: { readonly person: ProjectPerson }) {
  return (
    <div className="ov-chip-card">
      <span className="ov-chip-card-name">{person.name}</span>
      {person.email === null || person.email === person.name ? null : (
        <span className="ov-chip-card-line">{person.email}</span>
      )}
      <span className="ov-chip-card-line">
        {[person.role, ...(person.pending ? ["invited, not joined yet"] : [])].join(" · ")}
      </span>
      {person.across.length > 0 ? (
        <ul className="ov-chip-card-across">
          {person.across.map(({ label, level }) => (
            <li key={label}>
              <span>{label}</span>
              <span>{level === null ? "No access" : BADGE_WORDS[level]}</span>
            </li>
          ))}
        </ul>
      ) : person.line === "" ? null : (
        <span className="ov-chip-card-line">{person.line}</span>
      )}
      {person.note === null ? null : <span className="ov-chip-card-line">{person.note}</span>}
    </div>
  );
}

/** A person's ⋮: the levels they may be given, theirs checked, then the way out. */
function ChipMenu({
  change,
  name,
  busy,
  onChoose,
}: {
  readonly change: PersonChange;
  readonly name: string;
  readonly busy: boolean;
  readonly onChoose: (choice: AccessChoice) => void;
}) {
  const entries = personMenu(change);
  const actions = entries.flatMap((entry) => (entry.kind === "action" ? [entry] : []));
  const levels = entries.flatMap((entry) => (entry.kind === "level" ? [entry] : []));
  const end = entries.find((entry) => entry.kind === "end");
  const held = levels.find((entry) => entry.checked)?.level ?? "";
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Change ${name}'s access`}
        disabled={busy}
        render={<Button size="icon-sm" variant="ghost" />}
      >
        <MoreVerticalIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start">
        {actions.map((entry) => (
          <MenuItem key={`${entry.choice}-${entry.label}`} onClick={() => onChoose(entry.choice)}>
            {entry.label}
          </MenuItem>
        ))}
        {levels.length === 0 ? null : (
          <MenuRadioGroup
            onValueChange={(value) => {
              if (value !== held) onChoose(value as GivenLevel);
            }}
            value={held}
          >
            {levels.map((entry) => (
              <MenuRadioItem key={entry.level} value={entry.level} variant="check">
                {entry.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        )}
        {end === undefined ? null : (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onChoose(end.end)} variant="destructive">
              {end.label}
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** Whether a candidate matches what was typed: their name or e-mail, any case. */
const matches = (candidate: AccessCandidate, query: string) => {
  const needle = query.trim().toLocaleLowerCase();
  return (
    needle === "" ||
    candidate.name.toLocaleLowerCase().includes(needle) ||
    (candidate.email?.toLocaleLowerCase().includes(needle) ?? false)
  );
};

/** *Add access*: a dashed chip opening the organization's people who reach none of it yet. */
function AddAccess({
  candidates,
  adding,
  onAdd,
}: {
  readonly candidates: ReadonlyArray<AccessCandidate>;
  readonly adding: boolean;
  readonly onAdd: (picks: ReadonlyArray<AccessPick>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
      }}
      open={open}
    >
      <PopoverTrigger
        disabled={adding}
        render={<button className="ov-chip-add" data-zerops-surface="add-access" type="button" />}
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        <span>{adding ? "Adding…" : "Add access"}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" padding="none" width="md">
        {open ? (
          <AddAccessPicker
            candidates={candidates}
            onAdd={(picks) => {
              setOpen(false);
              onAdd(picks);
            }}
          />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

/** The search, the people with Read and Full to tick, and *Add people*. */
export function AddAccessPicker({
  candidates,
  onAdd,
}: {
  readonly candidates: ReadonlyArray<AccessCandidate>;
  readonly onAdd: (picks: ReadonlyArray<AccessPick>) => void;
}) {
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<Readonly<Record<string, GivenLevel>>>({});
  const shown = useMemo(
    () => candidates.filter((candidate) => matches(candidate, query)),
    [candidates, query],
  );
  const picks = candidates.flatMap((candidate) => {
    const level = ticked[candidate.clientUserId];
    return level === undefined ? [] : [{ candidate, level }];
  });
  // Read and Full are one choice per person: ticking one unticks the other.
  const tick = (clientUserId: string, level: GivenLevel, on: boolean) =>
    setTicked((held) => {
      const { [clientUserId]: was, ...rest } = held;
      if (on) return { ...rest, [clientUserId]: level };
      return was === level ? rest : held;
    });
  return (
    <div className="ov-pick">
      <div className="ov-pick-search">
        <Input
          aria-label="Search people"
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search by name or email…"
          size="sm"
          type="search"
          value={query}
        />
      </div>
      {shown.length === 0 ? (
        <p className="ov-pick-empty">
          {query.trim() === "" ? "Everyone here has access." : `Nobody matches “${query.trim()}”.`}
        </p>
      ) : (
        <ul aria-label="People in the organization" className="ov-pick-list">
          {shown.map((candidate) => (
            <Row
              control={(["read", "full"] as const).map((level) => (
                <span className="ov-pick-level" key={level}>
                  <Checkbox
                    aria-label={`${level === "read" ? "Read" : "Full"} access for ${candidate.name}`}
                    checked={ticked[candidate.clientUserId] === level}
                    onCheckedChange={(on) => tick(candidate.clientUserId, level, on === true)}
                  />
                  <span aria-hidden="true">{level === "read" ? "Read" : "Full"}</span>
                </span>
              ))}
              data-ticked={ticked[candidate.clientUserId] !== undefined || undefined}
              key={candidate.clientUserId}
              lead={<PersonAvatar name={candidate.name} picture={candidate.avatarUrl} size={32} />}
              line={candidate.pending ? `${candidate.role} · invited` : candidate.role}
              render={<li />}
              title={candidate.name}
            />
          ))}
        </ul>
      )}
      <dl
        aria-label="What Read and Full give"
        className="grid gap-1 px-3 pt-2 text-xs text-muted-foreground"
      >
        {(["read", "full"] as const).map((level) => (
          <div key={level}>
            <dt className="inline font-medium text-foreground">
              {level === "read" ? "Read" : "Full"}:
            </dt>{" "}
            <dd className="inline">{ACCESS_LEVEL_LINES[level]}</dd>
          </div>
        ))}
      </dl>
      <div className="ov-pick-foot">
        <Button disabled={picks.length === 0} onClick={() => onAdd(picks)} size="md">
          {picks.length > 1 ? `Add ${picks.length} people` : "Add people"}
        </Button>
      </div>
    </div>
  );
}
