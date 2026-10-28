/**
 * Who reaches a Zerops project as people chips: a face, a short
 * name and the level they have there, a hover card with who they are, and a ··· for whoever may
 * change it; then *Add access* under them, which picks people already in the organization who reach none of
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
} from "lucide-react";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import { useId, useMemo, useState, type ReactNode } from "react";

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
import { Label } from "../../ui/label";
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
  LEVEL_MEANING,
  personMenu,
  type AccessCandidate,
  type ChipLevel,
  type GivenLevel,
  type PersonChange,
  type ProjectPeopleView,
  type ProjectPerson,
} from "./projectPeople.logic";
import { Badge, type BadgeTone } from "~/components/ui/badge";

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
  const addable =
    view.kind === "people" && view.invite && onAdd !== undefined && view.candidates.length > 0
      ? { candidates: view.candidates, onAdd }
      : null;
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
        </ul>
      )}
      {said.map(({ key, line }) => (
        <p className="ov-sec-empty" data-tone="failed" key={key} role="alert">
          {line}
        </p>
      ))}
      {/* Adding people is a quiet tool under the people, never a tile as big as one of them. */}
      {addable === null ? null : (
        // The quiet button's words share the chips' start edge.
        <span className="-ms-2.5 flex items-center gap-1">
          <AddAccess adding={adding} candidates={addable.candidates} onAdd={addable.onAdd} />
        </span>
      )}
    </section>
  );
}

/** The level a chip holds, as a small badge: an icon and a word. */
const BADGE_TONE: Readonly<Record<BadgeLevel, BadgeTone>> = {
  owner: "success",
  full: "success",
  basic: "info",
  read: "neutral",
  hidden: "neutral",
};

/** A person's access on a project, as a Badge: its mark and its word; Saving… while it changes. */
export function AccessBadge({ level, busy = false }: { level: BadgeLevel; busy?: boolean }) {
  const Icon = BADGE_ICON[level];
  return (
    <Badge data-part="badge" tone={busy ? "neutral" : BADGE_TONE[level]}>
      {busy ? null : <Icon aria-hidden="true" />}
      {busy ? "Saving…" : level === "owner" ? "Owner" : BADGE_WORDS[level]}
    </Badge>
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
              <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
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

/** Who someone is: full name, e-mail and role — then what they may do here. */
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
      {person.line === "" ? null : <span className="ov-chip-card-line">{person.line}</span>}
      <span className="ov-chip-card-line">
        {BADGE_WORDS[person.level]}:{" "}
        {LEVEL_MEANING[person.level === "hidden" ? "none" : person.level]}
      </span>
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

/** *Add access*: a quiet button opening the organization's people who reach none of it yet. */
export function AddAccess({
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
        render={<Button data-zerops-surface="add-access" size="sm" variant="ghost" />}
      >
        <PlusIcon aria-hidden="true" />
        {adding ? "Adding…" : "Add access"}
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
        <Button disabled={picks.length === 0} onClick={() => onAdd(picks)} size="sm">
          {picks.length > 1 ? `Add ${picks.length} people` : "Add people"}
        </Button>
      </div>
    </div>
  );
}

/**
 * A creation dialog's *Project access* in one line: who can open the project, in words
 * (`draftSummary`), and *Change who can open it*, which opens the people chips in place for edits;
 * *Done* folds them again. Changes made in the chips are counted on the line.
 */
export function AccessDraftFold({
  label,
  summary,
  children,
}: {
  readonly label: string;
  readonly summary: { readonly line: string; readonly changes: string | null };
  /** The people chips, drawn while the list is open. */
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <section aria-label={label} className="flex flex-col gap-1" data-zerops-surface="access-fold">
      {/* The quiet button's words end on the section's end edge. */}
      <div className="-me-2.5 flex min-h-7 items-center justify-between gap-3">
        <Label render={<h3 />}>{label}</Label>
        <Button
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          size="sm"
          variant="ghost"
        >
          {open ? "Done" : "Change who can open it"}
        </Button>
      </div>
      <p className="text-body text-muted-foreground text-pretty" data-zerops-access="line">
        {summary.line}
        {summary.changes === null ? null : (
          <span className="text-foreground"> · {summary.changes}</span>
        )}
      </p>
      {open ? (
        <div className="pt-2" id={listId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
