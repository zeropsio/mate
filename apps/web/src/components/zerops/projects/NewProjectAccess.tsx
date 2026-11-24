/**
 * The New project page's *Project access*: its name and who can open it in one line
 * (`draftSummary`), *Add people to this project*, which opens the *Add people* card in place, then
 * everyone the project will reach, one person a row with their level and a ··· to change it.
 *
 * A pure view like `ProjectAccessChips`: the draft (`ProjectAccessDraft`) keeps every choice.
 */
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "../../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group";
import { PersonAvatar } from "../primitives";
import {
  matches,
  ProjectAccessChips,
  type AccessChoice,
  type AccessPick,
} from "./ProjectAccessChips";
import {
  ACCESS_LEVEL_LINES,
  type AccessCandidate,
  type GivenLevel,
  type ProjectPeopleView,
  type ProjectPerson,
} from "./projectPeople.logic";

export function NewProjectAccess({
  label,
  addLabel = "Add people to this project",
  summary,
  view,
  onChoose,
  onAdd,
}: {
  readonly label: string;
  /** What *Add people* says: to this project, or to this Mate. */
  readonly addLabel?: string;
  /** Who can open it, in words; `null` while the people are still read. */
  readonly summary: { readonly line: string; readonly changes: string | null } | null;
  readonly view: ProjectPeopleView;
  readonly onChoose: (person: ProjectPerson, choice: AccessChoice) => void;
  readonly onAdd: (picks: ReadonlyArray<AccessPick>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const candidates = view.kind === "people" && view.invite ? view.candidates : [];
  return (
    <section aria-label={label} className="np-access" data-zerops-surface="new-project-access">
      <div className="np-access-head">
        <h3 className="np-access-name">{label}</h3>
        {summary === null ? null : (
          <p className="np-access-line" data-zerops-access="line">
            {summary.line}
            {summary.changes === null ? null : (
              <span className="text-foreground"> · {summary.changes}</span>
            )}
          </p>
        )}
      </div>
      <div className="np-access-body">
        {candidates.length === 0 ? null : adding ? (
          <AddPeopleCard
            candidates={candidates}
            onAdd={(picks) => {
              setAdding(false);
              onAdd(picks);
            }}
            onClose={() => setAdding(false)}
          />
        ) : (
          <Button
            className="self-start"
            data-zerops-surface="add-access"
            onClick={() => setAdding(true)}
            size="md"
            variant="secondary"
          >
            <PlusIcon aria-hidden="true" />
            {addLabel}
          </Button>
        )}
        <ProjectAccessChips heading={false} label={label} onChoose={onChoose} rows view={view} />
      </div>
    </section>
  );
}

/**
 * *Add people*: a search over the organization's people who reach none of the project yet, each
 * found person given Read or Full, then *Add*. Nobody is listed before something is typed.
 */
function AddPeopleCard({
  candidates,
  onAdd,
  onClose,
}: {
  readonly candidates: ReadonlyArray<AccessCandidate>;
  readonly onAdd: (picks: ReadonlyArray<AccessPick>) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<Readonly<Record<string, GivenLevel>>>({});
  const titleId = useId();
  const typed = query.trim();
  const shown = useMemo(
    () => (typed === "" ? [] : candidates.filter((candidate) => matches(candidate, typed))),
    [candidates, typed],
  );
  const picks = candidates.flatMap((candidate) => {
    const level = ticked[candidate.clientUserId];
    return level === undefined ? [] : [{ candidate, level }];
  });
  const pick = (clientUserId: string, level: GivenLevel | undefined) =>
    setTicked((held) => {
      const { [clientUserId]: _was, ...rest } = held;
      return level === undefined ? rest : { ...rest, [clientUserId]: level };
    });
  return (
    <div
      aria-labelledby={titleId}
      className="np-add"
      data-zerops-surface="add-people"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      role="group"
    >
      <div className="np-add-head">
        <span className="np-add-title" id={titleId}>
          Add people
        </span>
        <Button
          aria-label="Close"
          className="-my-0.5 -me-0.5"
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <label className="np-add-search">
        <SearchIcon aria-hidden="true" />
        <input
          aria-label="Search people"
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search by name or email"
          type="search"
          value={query}
        />
      </label>
      {typed === "" ? null : shown.length === 0 ? (
        <p className="np-add-empty">Nobody matches “{typed}”.</p>
      ) : (
        <ul aria-label="People in the organization" className="np-add-list">
          {shown.map((candidate) => {
            const level = ticked[candidate.clientUserId];
            return (
              <li
                className="np-add-row"
                data-picked={level !== undefined || undefined}
                key={candidate.clientUserId}
              >
                <PersonAvatar name={candidate.name} picture={candidate.avatarUrl} size={24} />
                <span className="np-add-who">
                  <span className="np-add-name">{candidate.name}</span>
                  <span className="np-add-role">
                    {candidate.pending ? `${candidate.role} · invited` : candidate.role}
                  </span>
                </span>
                <ToggleGroup
                  aria-label={`Access for ${candidate.name}`}
                  onValueChange={(value) => {
                    const next = value[0];
                    pick(
                      candidate.clientUserId,
                      next === "read" || next === "full" ? next : undefined,
                    );
                  }}
                  size="segmented-sm"
                  value={level === undefined ? [] : [level]}
                  variant="segmented"
                >
                  <ToggleGroupItem value="read">Read</ToggleGroupItem>
                  <ToggleGroupItem value="full">Full</ToggleGroupItem>
                </ToggleGroup>
              </li>
            );
          })}
        </ul>
      )}
      {picks.length === 0 && typed === "" ? null : (
        <dl aria-label="What Read and Full give" className="np-add-hints">
          {(["read", "full"] as const).map((one) => (
            <div key={one}>
              <dt>{one === "read" ? "Read" : "Full"}</dt>
              <dd>{ACCESS_LEVEL_LINES[one]}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="np-add-foot">
        <Button onClick={onClose} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button disabled={picks.length === 0} onClick={() => onAdd(picks)} size="sm">
          {picks.length === 0
            ? "Add people"
            : picks.length === 1
              ? "Add 1 person"
              : `Add ${String(picks.length)} people`}
        </Button>
      </div>
    </div>
  );
}
