/**
 * One person's *Project access*, as their own page and the invitation set it — legacy Zerops's:
 * the projects whose own level for them differs from what their role gives, as chips — a project's
 * Mate name over its level, a ⋮ with what may change — then *Set custom accesses*, a picker: search
 * the projects, give each Read, Full (or Hidden, for someone whose role reaches every project) or
 * leave it Unset, then *Add projects*. Nothing is written here: the host keeps the draft and saves
 * it whole.
 */
import { FolderIcon, MoreVerticalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Radio, RadioGroup } from "../ui/radio-group";
import { AccessBadge } from "../zerops/projects/ProjectAccessChips";
import type { GivenLevel } from "../zerops/projects/projectPeople.logic";
import type { AccessProject, ProjectChip, ProjectChipAction } from "./teamMember.logic";

const PICK_WORDS: Readonly<Record<GivenLevel, string>> = {
  read: "Read",
  full: "Full",
  none: "Hidden",
};

export function MemberProjectAccess({
  chips,
  candidates,
  levels,
  editable,
  onChoose,
  onAdd,
}: {
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
    <ul aria-label="Their projects" className="ov-chips" data-wide="">
      {chips.map((chip) => (
        <li
          className="ov-chip"
          data-changed={chip.changed || undefined}
          data-menu={(editable && chip.actions.length > 0) || undefined}
          key={chip.projectId}
        >
          <span className="ov-chip-who">
            <span aria-hidden="true" className="tm-project-face">
              <FolderIcon className="size-4" />
            </span>
            <span className="ov-chip-text">
              <span className="ov-chip-name" data-part="name">
                {chip.label}
              </span>
              <AccessBadge level={chip.level} />
            </span>
          </span>
          {editable && chip.actions.length > 0 ? (
            <Menu>
              <MenuTrigger
                aria-label={`Change access to ${chip.label}`}
                render={<Button size="icon-xs" variant="ghost" />}
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
      {editable && candidates.length > 0 ? (
        <li className="ov-chip-slot">
          <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger
              render={
                <button
                  className="ov-chip-add"
                  data-zerops-surface="set-custom-access"
                  type="button"
                />
              }
            >
              <PlusIcon aria-hidden="true" className="size-4" />
              <span>Set custom accesses</span>
            </PopoverTrigger>
            <PopoverPopup align="start" padding="none" width="lg">
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
        </li>
      ) : null}
    </ul>
  );
}

const UNSET = "unset";

/** The search, each project with its levels and *Unset*, and *Add projects*. */
export function ProjectPicker({
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
    <div className="ov-pick">
      <div className="ov-pick-search">
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
        <p className="ov-pick-empty">
          <SearchIcon aria-hidden="true" className="me-1.5 inline size-3.5" />
          Nothing matches “{query.trim()}”.
        </p>
      ) : (
        <ul aria-label="Projects" className="ov-pick-list">
          {shown.map((project) => {
            const level = picks[project.projectId];
            return (
              <li
                className="tm-pick-row"
                data-ticked={level !== undefined || undefined}
                key={project.projectId}
              >
                <span className="tm-pick-name">{project.label}</span>
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
                    <label className="tm-pick-level" key={option}>
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
      <div className="ov-pick-foot">
        <Button disabled={count === 0} onClick={() => onAdd(picks)} size="sm">
          {count > 1 ? `Add ${count} projects` : "Add projects"}
        </Button>
      </div>
    </div>
  );
}
