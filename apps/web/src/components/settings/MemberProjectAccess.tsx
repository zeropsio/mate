/**
 * One person's *Project access*, as their own page and the invitation set it — legacy Zerops's:
 * a heading over what their role gives by default, *Set custom accesses* at the heading's end, then
 * the projects whose own level for them differs, as chips — a project's Mate name over its level, a
 * ⋮ with what may change. *Set custom accesses* opens a picker: search the projects, give each Read,
 * Full (or Hidden, for someone whose role reaches every project) or leave it Unset, then *Add
 * projects*. Nothing is written here: the host keeps the draft and saves it whole.
 */
import { FolderIcon, MoreVerticalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { EmptyState } from "../ui/empty";
import { Radio, RadioGroup } from "../ui/radio-group";
import {
  ACCESS_CHIP_NAME,
  ACCESS_CHIP_TEXT,
  ACCESS_CHIP_WHO,
  ACCESS_CHIPS_WIDE,
  AccessBadge,
  accessChip,
  PICK_FOOT,
  PICK_LIST,
  PICK_SEARCH,
} from "../zerops/projects/ProjectAccessChips";
import { cn } from "~/lib/utils";
import type { GivenLevel } from "../zerops/projects/projectPeople.logic";
import type { OrgRoleCode } from "@t3tools/client-runtime/zerops/teamRoles";
import {
  projectAccessIntro,
  type AccessProject,
  type ProjectChip,
  type ProjectChipAction,
} from "./teamMember.logic";
import { SectionHeader } from "../ui/section";

const PICK_WORDS: Readonly<Record<GivenLevel, string>> = {
  read: "Read",
  full: "Full",
  none: "Hidden",
};

export function MemberProjectAccess({
  memberRole,
  createsProjects,
  viewerGives,
  chips,
  candidates,
  levels,
  editable,
  onChoose,
  onAdd,
}: {
  /** The role being given or held: what it reaches by itself heads the section. */
  readonly memberRole: OrgRoleCode;
  /** The person may create projects (a Developer), and so reaches the ones they create. */
  readonly createsProjects: boolean;
  /** The viewer may give this person projects: what they reach is said as theirs to add. */
  readonly viewerGives: boolean;
  readonly chips: ReadonlyArray<ProjectChip>;
  /** The projects without a level of their own yet: what the picker offers. */
  readonly candidates: ReadonlyArray<AccessProject>;
  /** The levels the picker offers for this person, each beside *Unset*. */
  readonly levels: ReadonlyArray<GivenLevel>;
  readonly editable: boolean;
  readonly onChoose: (projectId: string, choice: ProjectChipAction["choice"]) => void;
  readonly onAdd: (picks: Readonly<Record<string, GivenLevel | undefined>>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-3.5">
      <SectionHeader
        action={
          editable && candidates.length > 0 ? (
            <Popover onOpenChange={setOpen} open={open}>
              <PopoverTrigger
                render={
                  <Button data-zerops-surface="set-custom-access" size="sm" variant="secondary" />
                }
              >
                <PlusIcon aria-hidden="true" />
                Choose projects
              </PopoverTrigger>
              <PopoverPopup align="end" padding="none" width="lg">
                {open ? (
                  <ProjectPicker
                    candidates={candidates}
                    levels={levels}
                    onAdd={(picks) => {
                      setOpen(false);
                      onAdd(picks);
                    }}
                  />
                ) : null}
              </PopoverPopup>
            </Popover>
          ) : null
        }
        line={projectAccessIntro({ roleCode: memberRole, createsProjects, viewerGives })}
        title="Project access"
      />
      {chips.length === 0 ? null : (
        <ul aria-label="Their projects" className={ACCESS_CHIPS_WIDE}>
          {chips.map((chip) => (
            <li
              className={cn(
                accessChip(editable && chip.actions.length > 0),
                chip.changed && "inset-ring-2 inset-ring-primary",
              )}
              key={chip.projectId}
            >
              <span className={ACCESS_CHIP_WHO}>
                {/* A project's face: a folder on a muted 32 px disc. */}
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
                >
                  <FolderIcon className="size-4" />
                </span>
                <span className={ACCESS_CHIP_TEXT}>
                  <span className={ACCESS_CHIP_NAME} data-part="name">
                    {chip.label}
                  </span>
                  <AccessBadge level={chip.level} />
                </span>
              </span>
              {editable && chip.actions.length > 0 ? (
                <Menu>
                  <MenuTrigger
                    aria-label={`Change access to ${chip.label}`}
                    render={<Button size="icon-sm" variant="ghost" />}
                  >
                    <MoreVerticalIcon aria-hidden="true" />
                  </MenuTrigger>
                  <MenuPopup align="start">
                    {chip.actions.map((action) => (
                      <MenuItem
                        key={`${action.choice}-${action.label}`}
                        onClick={() => onChoose(chip.projectId, action.choice)}
                        {...(action.choice === "remove" ? { variant: "destructive" as const } : {})}
                      >
                        {action.label}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const UNSET = "unset";

/** The search, each project with its levels and *Unset*, and *Add projects*. */
function ProjectPicker({
  candidates,
  levels,
  onAdd,
}: {
  readonly candidates: ReadonlyArray<AccessProject>;
  readonly levels: ReadonlyArray<GivenLevel>;
  readonly onAdd: (picks: Readonly<Record<string, GivenLevel | undefined>>) => void;
}) {
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Readonly<Record<string, GivenLevel | undefined>>>({});
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle === ""
      ? candidates
      : candidates.filter(({ label }) => label.toLocaleLowerCase().includes(needle));
  }, [candidates, query]);
  const count = Object.values(picks).filter((level) => level !== undefined).length;
  return (
    <div className="grid">
      <div className={PICK_SEARCH}>
        <Input
          aria-label="Search projects"
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search projects…"
          size="sm"
          type="search"
          value={query}
        />
      </div>
      {shown.length === 0 ? (
        <div className="px-2.5 pb-1">
          <EmptyState mark={<SearchIcon aria-hidden="true" />} size="row">
            Nothing matches “{query.trim()}”.
          </EmptyState>
        </div>
      ) : (
        <ul aria-label="Projects" className={PICK_LIST}>
          {shown.map((project) => {
            const level = picks[project.projectId];
            return (
              // A project: its name, then its levels on the same line (a list row would put them
              // under the name in a popover this narrow); a finger's level is the row's height.
              <li
                className={cn(
                  "grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-control px-2 py-1.5 max-sm:min-h-11 max-sm:py-0",
                  level !== undefined && "bg-item-picked",
                )}
                key={project.projectId}
              >
                <span className="truncate text-body leading-4.5 font-medium">{project.label}</span>
                <RadioGroup
                  aria-label={`Access to ${project.label}`}
                  className="flex-row"
                  onValueChange={(value) =>
                    setPicks((held) => ({
                      ...held,
                      [project.projectId]: value === UNSET ? undefined : (value as GivenLevel),
                    }))
                  }
                  value={level ?? UNSET}
                >
                  {[...levels, UNSET].map((option) => (
                    <label
                      className="ms-2.5 inline-flex cursor-pointer items-center gap-1.5 text-caption max-sm:min-h-11"
                      key={option}
                    >
                      <Radio value={option} />
                      <span>{option === UNSET ? "Unset" : PICK_WORDS[option as GivenLevel]}</span>
                    </label>
                  ))}
                </RadioGroup>
              </li>
            );
          })}
        </ul>
      )}
      <div className={PICK_FOOT}>
        <Button disabled={count === 0} onClick={() => onAdd(picks)} size="sm">
          {count > 1 ? `Add ${count} projects` : "Add projects"}
        </Button>
      </div>
    </div>
  );
}
