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
import { EmptyState } from "../../ui/empty";
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
import { Loading } from "~/components/ui/loading";
import { SectionLabel } from "../system/SectionLabel";
import { Failure } from "~/components/ui/failure";
import { cn } from "~/lib/utils";
import { Text } from "~/components/ui/text";
import { Separator } from "~/components/ui/separator";

/**
 * A creation form's *Project access*: the host draws the draft (`ProjectAccessDraft`), which says
 * each change of the list the creation sends; a form without one sends none.
 */
export type ProjectAccessSlot = (
  onChange: (userRoles: ReadonlyArray<ProjectGrant>) => void,
  /** The new Mate's name as typed, where a Mate is made: the section names it. */
  mate?: string,
) => ReactNode;

/** A choice from a person's ···: a level, or the way out. */
export type AccessChoice = GivenLevel | NonNullable<PersonChange["end"]>;

/** Where a person's own Team page is, by membership id: the chip's face leads there. */
type PersonPageLink = (clientUserId: string) => boolean;

/** Someone picked in *Add access*, at the level ticked for them. */
export interface AccessPick {
  readonly candidate: AccessCandidate;
  readonly level: GivenLevel;
}

interface ProjectAccessChipsProps {
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
  /** One person a `Row`, a small face and the level at the row's end: the New project page's list. */
  readonly rows?: boolean;
}

/** A badge's level: a chip's, or `owner` on a project someone owns. */
type BadgeLevel = ChipLevel | "owner";

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
  rows = false,
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
    <section
      aria-label={label}
      className={heading ? CARD_SECTION : rows ? "grid gap-1.5" : "grid gap-1.5 pb-3"}
    >
      {heading ? <SectionLabel level={3}>{label}</SectionLabel> : null}
      {view.kind === "reading" ? (
        <Loading count={2} label="Who has access" shape="rows" />
      ) : view.kind === "unreadable" ? (
        <Failure cause={view.line} size="line" />
      ) : (
        <ul aria-label={label} className={rows ? "flex flex-col" : ACCESS_CHIPS}>
          {view.people.map((person) => {
            const Person = rows ? AccessRow : AccessChip;
            return (
              <Person
                busy={saving?.has(person.key) === true}
                key={person.key}
                linked={personPage?.(person.key) === true}
                {...(onChoose === undefined
                  ? {}
                  : { onChoose: (choice: AccessChoice) => onChoose(person, choice) })}
                person={person}
              />
            );
          })}
        </ul>
      )}
      {said.map(({ key, line }) => (
        <Failure cause={line} key={key} role="alert" size="line" />
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

/**
 * A section of a card: a hairline over it, its label hugging what it holds. Opened alone in a
 * dialog (`data-sections="bare"`), it stands there with no rule, named by the dialog's title.
 */
export const CARD_SECTION =
  "mt-4 grid gap-1 border-t border-rule px-1.5 pt-4 [[data-sections=bare]>&]:mt-0 [[data-sections=bare]>&]:border-t-0 [[data-sections=bare]>&]:pt-0 [[data-sections=bare]>&>[data-zerops-section-label]]:hidden";

/**
 * Who reaches a project, as people chips: as many columns of at least 168 px as fit (232 px for
 * `wide` chips, a person's projects, whose names are longer).
 */
export const ACCESS_CHIPS = "mt-0.5 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2";
export const ACCESS_CHIPS_WIDE =
  "mt-0.5 grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-2";

/**
 * A chip: a pill lifted off its card, its face and words, a ⋮ where it has a menu. A quiet press's
 * hover on it is a step over the lift.
 */
export function accessChip(menu: boolean): string {
  return cn(
    "grid h-12 grid-cols-[minmax(0,1fr)] items-center rounded-full bg-foreground/4 px-1.5 [--accent:color-mix(in_oklab,var(--foreground)_6%,transparent)]",
    menu && "grid-cols-[minmax(0,1fr)_auto] pe-1",
  );
}

/** A chip's face and words: a 32 px face, then its name over its level. */
export const ACCESS_CHIP_WHO =
  "grid min-w-0 cursor-default grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2.5";
export const ACCESS_CHIP_TEXT = "grid min-w-0 justify-items-start gap-y-0.75";
export const ACCESS_CHIP_NAME =
  "max-w-full truncate text-body leading-4 font-medium text-foreground";

/** A line of a chip's hover card. */
const HOVER_LINE = "text-caption leading-4 text-muted-foreground";

/** An access picker's parts, in its popover: the search, the list, the foot (under a Separator). */
export const PICK_SEARCH = "px-3 pt-3 pb-2";
export const PICK_LIST = "grid max-h-72 overflow-y-auto px-1.5 pb-1.5";
export const PICK_FOOT = "grid px-3 pt-2.5 pb-3";

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

interface AccessPersonProps {
  readonly person: ProjectPerson;
  readonly busy: boolean;
  /** The face leads to the person's own Team page. */
  readonly linked: boolean;
  readonly onChoose?: (choice: AccessChoice) => void;
}

/** A pill in the chips' grid: a 32 px face, the short name over the level, then the ⋮. */
function AccessChip({ person, busy, linked, onChoose }: AccessPersonProps) {
  const change = person.change;
  const { choose, asking } = useAskFirst(person, onChoose);
  return (
    <li className={accessChip(change !== null && onChoose !== undefined)}>
      <Tooltip>
        <TooltipTrigger
          render={
            linked ? (
              // The face leads to the person's own Team page.
              <Link
                className={cn(
                  ACCESS_CHIP_WHO,
                  "group/who cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  person.pending && "opacity-55",
                )}
                params={{ clientUserId: person.key }}
                to="/settings/team/$clientUserId"
              />
            ) : (
              <span className={cn(ACCESS_CHIP_WHO, person.pending && "opacity-55")} />
            )
          }
        >
          <PersonAvatar name={person.name} picture={person.avatarUrl} size={32} />
          <span className={ACCESS_CHIP_TEXT}>
            <span
              className={cn(ACCESS_CHIP_NAME, "underline-offset-2 group-hover/who:underline")}
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
      {asking}
    </li>
  );
}

/**
 * One person a row (the kit's `Row`, as the *Add people* card's found people): a 20 px face, the
 * short name with who they are on hover, and the level and the ⋮ at the row's end. An invitation's
 * face and name are dimmed; its level and menu stay at full ink.
 */
function AccessRow({ person, busy, linked, onChoose }: AccessPersonProps) {
  const change = person.change;
  const { choose, asking } = useAskFirst(person, onChoose);
  const dim = person.pending ? "opacity-55" : undefined;
  return (
    <Row
      control={
        <>
          <AccessBadge busy={busy} level={person.level} />
          {change === null || onChoose === undefined ? null : (
            <ChipMenu
              busy={busy}
              change={change}
              name={person.name}
              onChoose={choose}
              size="icon-xs"
            />
          )}
          {asking}
        </>
      }
      lead={
        <span className={dim}>
          <PersonAvatar name={person.name} picture={person.avatarUrl} size={20} />
        </span>
      }
      render={<li />}
      size="sm"
      title={
        <Tooltip>
          <TooltipTrigger
            render={
              linked ? (
                <Link
                  className="underline-offset-2 hover:underline"
                  params={{ clientUserId: person.key }}
                  to="/settings/team/$clientUserId"
                />
              ) : (
                <span className="cursor-default" />
              )
            }
          >
            <span className={dim} data-part="name">
              {person.creator ? "You" : person.short}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <HoverCard person={person} />
          </TooltipPopup>
        </Tooltip>
      }
    />
  );
}

/**
 * A choice from a person's ⋮, asked first where it takes the viewer's own access down: `choose`
 * for the menu, and `asking`, the question, to draw beside it.
 */
function useAskFirst(
  person: ProjectPerson,
  onChoose: ((choice: AccessChoice) => void) | undefined,
) {
  const change = person.change;
  const [asked, setAsked] = useState<AccessChoice | null>(null);
  const choose = (choice: AccessChoice) => {
    if (change !== null && asksFirst(change, choice)) setAsked(choice);
    else onChoose?.(choice);
  };
  const asking =
    change?.selfLower === undefined ? null : (
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setAsked(null);
        }}
        open={asked !== null}
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
                if (asked !== null) onChoose?.(asked);
                setAsked(null);
              }}
              variant="destructive"
            >
              Give it up
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    );
  return { choose, asking };
}

/** Who someone is: full name, e-mail and role — then what they may do here. */
function HoverCard({ person }: { readonly person: ProjectPerson }) {
  return (
    <div className="grid min-w-45 gap-0.5 px-0.5 py-1 text-left">
      <span className="text-body leading-4.5 font-semibold">{person.name}</span>
      {person.email === null || person.email === person.name ? null : (
        <span className={HOVER_LINE}>{person.email}</span>
      )}
      <span className={HOVER_LINE}>
        {[person.role, ...(person.pending ? ["invited, not joined yet"] : [])].join(" · ")}
      </span>
      {person.line === "" ? null : <span className={HOVER_LINE}>{person.line}</span>}
      <span className={HOVER_LINE}>
        {BADGE_WORDS[person.level]}:{" "}
        {LEVEL_MEANING[person.level === "hidden" ? "none" : person.level]}
      </span>
      {person.note === null ? null : <span className={HOVER_LINE}>{person.note}</span>}
    </div>
  );
}

/** A person's ⋮: the levels they may be given, theirs checked, then the way out. */
function ChipMenu({
  change,
  name,
  busy,
  onChoose,
  size = "icon-sm",
}: {
  readonly change: PersonChange;
  readonly name: string;
  readonly busy: boolean;
  readonly onChoose: (choice: AccessChoice) => void;
  /** A row's ⋮ is its line's height (`icon-xs`); a chip's, the pill's (`icon-sm`). */
  readonly size?: "icon-xs" | "icon-sm";
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
        render={<Button size={size} variant="ghost" />}
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
export const matches = (candidate: AccessCandidate, query: string) => {
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
    <div className="grid">
      <div className={PICK_SEARCH}>
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
        <div className="px-2.5 pb-1">
          <EmptyState size="row">
            {query.trim() === ""
              ? "Everyone here has access."
              : `Nobody matches “${query.trim()}”.`}
          </EmptyState>
        </div>
      ) : (
        <ul aria-label="People in the organization" className={PICK_LIST}>
          {shown.map((candidate) => (
            <Row
              control={(["read", "full"] as const).map((level) => (
                <span
                  className="inline-flex items-center gap-1.5 text-caption leading-4.5"
                  key={level}
                >
                  <Checkbox
                    aria-label={`${level === "read" ? "Read" : "Full"} access for ${candidate.name}`}
                    checked={ticked[candidate.clientUserId] === level}
                    onCheckedChange={(on) => tick(candidate.clientUserId, level, on === true)}
                  />
                  <span aria-hidden="true">{level === "read" ? "Read" : "Full"}</span>
                </span>
              ))}
              key={candidate.clientUserId}
              lead={<PersonAvatar name={candidate.name} picture={candidate.avatarUrl} size={32} />}
              line={candidate.pending ? `${candidate.role} · invited` : candidate.role}
              picked={ticked[candidate.clientUserId] !== undefined}
              render={<li />}
              title={candidate.name}
            />
          ))}
        </ul>
      )}
      <Text
        className="grid gap-1 px-3 pt-2"
        render={<dl />}
        variant="note"
        aria-label="What Read and Full give"
      >
        {(["read", "full"] as const).map((level) => (
          <div key={level}>
            <dt className="inline font-medium text-foreground">
              {level === "read" ? "Read" : "Full"}:
            </dt>{" "}
            <dd className="inline">{ACCESS_LEVEL_LINES[level]}</dd>
          </div>
        ))}
      </Text>
      <Separator />
      <div className={PICK_FOOT}>
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
      <Text render={<p />} variant="description" data-zerops-access="line">
        {summary.line}
        {summary.changes === null ? null : (
          <span className="text-foreground"> · {summary.changes}</span>
        )}
      </Text>
      {open ? (
        <div className="pt-2" id={listId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
