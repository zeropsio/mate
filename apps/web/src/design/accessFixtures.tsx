/**
 * The organization's people for the creation harnesses' access sections (`NewProjectAccess`, as
 * the New project page and the add-Mate dialog draw it), and the section itself over them.
 */
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import { useEffect, useMemo, useState } from "react";

import {
  draftChoose,
  draftSummary,
  draftView,
  type DraftInput,
} from "~/components/zerops/projects/accessDraft.logic";
import { NewProjectAccess } from "~/components/zerops/projects/NewProjectAccess";

/** Twenty-one people: you, sixteen admins, one developer, and three who reach no project. */
const PEOPLE = [
  ["me", "Mia Moss", "ADMIN"],
  ["ada", "Ada Lind", "ADMIN"],
  ["bo", "Bo Hale", "ADMIN"],
  ["cy", "Cyril Nord", "ADMIN"],
  ["di", "Dita Park", "ADMIN"],
  ["ed", "Edo Moon", "ADMIN"],
  ["fay", "Fay Linn", "ADMIN"],
  ["gus", "Gus Orr", "ADMIN"],
  ["hal", "Hal Pike", "ADMIN"],
  ["ivy", "Ivy Rowe", "ADMIN"],
  ["jo", "Jo Sand", "ADMIN"],
  ["kit", "Kit Tate", "ADMIN"],
  ["lu", "Lu Vale", "ADMIN"],
  ["mo", "Mo West", "ADMIN"],
  ["ned", "Ned Yoke", "ADMIN"],
  ["ola", "Ola Zorn", "ADMIN"],
  ["pia", "Pia Ames", "ADMIN"],
  ["rex", "Rex", "BASIC_USER"],
  ["sal", "Sal Quill", "NO_ACCESS"],
  ["kam", "Kamila Novak", "NO_ACCESS"],
  ["kar", "Karel Dvorak", "NO_ACCESS"],
] as const;
const MEMBERS = PEOPLE.map(([id, fullName, roleCode]) => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id: `u-${id}`, fullName },
}));
const DRAFT: Omit<DraftInput, "list"> = {
  members: { known: true, status: "ready", refused: false, list: MEMBERS },
  kind: "mate",
  app: { projects: [], grants: {}, owners: {} },
  pictures: {},
  creator: { membershipId: "cu-me", userId: "u-me" },
};

/** *Project access* as the host draws it on the page (`NewProjectAccess`), from the fixtures. */
export function HarnessAccess({
  onChange,
  label = "Who gets access to this project",
  addLabel,
}: {
  readonly onChange: (list: ReadonlyArray<ProjectGrant>) => void;
  readonly label?: string;
  readonly addLabel?: string;
}) {
  const [list, setList] = useState<ReadonlyArray<ProjectGrant>>([]);
  const view = useMemo(() => draftView({ ...DRAFT, list }), [list]);
  useEffect(() => onChange(list), [list, onChange]);
  const summary = draftSummary({ view, organization: "Mate s.r.o.", prefill: [], list });
  return (
    <NewProjectAccess
      {...(addLabel === undefined ? {} : { addLabel })}
      label={label}
      onAdd={(picks) =>
        setList((held) =>
          picks.reduce(
            (next, { candidate, level }) =>
              draftChoose(next, MEMBERS, candidate.clientUserId, level),
            held,
          ),
        )
      }
      onChoose={(person, choice) => {
        const change = person.change;
        if (change === null) return;
        setList((held) =>
          draftChoose(
            held,
            MEMBERS,
            change.clientUserId,
            choice === "withdraw" ? "remove" : choice,
          ),
        );
      }}
      summary={summary}
      view={view}
    />
  );
}
