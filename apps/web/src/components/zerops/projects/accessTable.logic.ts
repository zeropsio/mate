/**
 * An app's access as one table: the organization's people by the app's places — Production, each
 * Stage, then each Mate. A cell is what one person has on one place: the organization's default, a
 * level set on that place, or *Owner* on a Mate of their own, which no change touches.
 *
 * Zerops grants access per Zerops project: the organization role, unless the project names its own
 * grant for the member (`userRoles`), which wins in both directions (`effectiveProjectRole`). Only
 * an organization owner or admin changes it; an admin changes no owner's or other admin's, and
 * nobody hides a project from an owner or admin (Zerops keeps every project visible to them).
 *
 * Pure: the member list, each place's grants and whose each Mate is arrive read.
 */
import type {
  ProjectAccessChange,
  ProjectAccessRole,
} from "@t3tools/client-runtime/zerops/projectAccess";
import { isTokenMember } from "@t3tools/client-runtime/zerops/mateAccess";
import {
  asOrgRole,
  isMateKind,
  roleAtLeast,
  type ZeropsOrgRole,
} from "@t3tools/shared/zeropsRoles";

import { environmentTitle } from "../place/place.logic";
import {
  BADGE_WORDS,
  isPending,
  levelOf,
  mayHide,
  memberFace,
  UNREADABLE,
  type AccessCandidate,
  type PersonFace,
  type ProjectPeopleInput,
} from "./projectPeople.logic";

/** A place's column: Production, a Stage, or a Mate with its owner's face. */
export interface AccessColumn {
  readonly projectId: string;
  readonly kind: "production" | "stage" | "mate";
  /** "Production", the Stage's title, the Mate's name. */
  readonly label: string;
  /** A Mate's owner, drawn on its header; `null` on a place, or an owner not among the members. */
  readonly owner: PersonFace | null;
  /** Zerops doesn't show the viewer who reaches it: its cells are unknown. */
  readonly unread: boolean;
}

/** What one person has on one place; `unknown` where Zerops doesn't show it to the viewer. */
export type CellLevel = "none" | "read" | "basic" | "full" | "owner" | "unknown";

/** A level the viewer gives on a place, or `default`: the place's own dropped, the role decides. */
export type CellChoice = "full" | "read" | "none" | "default";

export interface CellChoiceEntry {
  readonly choice: CellChoice;
  readonly label: string;
  readonly checked: boolean;
}

export interface AccessCell {
  readonly projectId: string;
  readonly level: CellLevel;
  /** From the organization's role alone: the place names nothing of its own for them. */
  readonly byDefault: boolean;
  /** What the viewer may set here; empty where they may change nothing. */
  readonly choices: ReadonlyArray<CellChoiceEntry>;
  /** Why the viewer, who changes others' access, can't change this one. */
  readonly fixed: string | null;
}

export interface AccessRow extends PersonFace {
  /** The membership (`clientUser`) id. */
  readonly key: string;
  /** Their organization role: what each place gives them unless it says otherwise. */
  readonly roleCode: ZeropsOrgRole;
  readonly you: boolean;
  /** The viewer's own row: giving up their own full access asks first. */
  readonly self: boolean;
  /** Not joined yet: an invitation. */
  readonly pending: boolean;
  /** One per column, in the columns' order. */
  readonly cells: ReadonlyArray<AccessCell>;
  /** *Same everywhere…*: a level for every place they may be changed on. Empty: no shortcut. */
  readonly everywhere: ReadonlyArray<{ readonly choice: CellChoice; readonly label: string }>;
  /** An invitation the viewer may withdraw. */
  readonly withdraw: boolean;
}

export type AccessTableView =
  | { readonly kind: "reading" }
  | { readonly kind: "unreadable"; readonly line: string }
  | {
      readonly kind: "table";
      readonly columns: ReadonlyArray<AccessColumn>;
      readonly rows: ReadonlyArray<AccessRow>;
      /** The viewer changes access here: an organization owner or admin. */
      readonly editable: boolean;
      /** The viewer may add people: an organization owner or admin. */
      readonly invite: boolean;
      /** Members who reach none of it, by name. */
      readonly candidates: ReadonlyArray<AccessCandidate>;
    };

/** A cell's word: the chips' levels, *None* and *Owner*. */
export const CELL_WORDS: Readonly<Record<CellLevel, string>> = {
  full: BADGE_WORDS.full,
  basic: BADGE_WORDS.basic,
  read: BADGE_WORDS.read,
  none: "None",
  owner: "Owner",
  unknown: "Unknown",
};

const GIVEN_ROLE: Readonly<Record<Exclude<CellChoice, "default">, ProjectAccessRole>> = {
  full: "ADMIN",
  read: "READ_ONLY",
  none: "NO_ACCESS",
};

const CHOICE_WORDS: Readonly<Record<Exclude<CellChoice, "default">, string>> = {
  full: "Full",
  read: "Read",
  none: "None",
};

/** What a role gives on a place nobody set anything on. */
const defaultLevel = (role: string | undefined): "full" | "basic" | "read" | "none" =>
  levelOf(role) ?? "none";

const COLUMN_ORDER: Readonly<Record<AccessColumn["kind"], number>> = {
  production: 0,
  stage: 1,
  mate: 2,
};

/**
 * One cell's choice as the one write it makes, for that place only: a level, or none of the
 * place's own where the organization's role already gives it.
 */
export function cellChange(input: {
  readonly clientUserId: string;
  readonly memberRole: string | undefined;
  readonly projectId: string;
  readonly choice: CellChoice;
}): ProjectAccessChange {
  const { clientUserId, projectId, choice } = input;
  const roleCode =
    choice === "default" || choice === defaultLevel(input.memberRole) ? null : GIVEN_ROLE[choice];
  return { clientUserId, projectId, roleCode };
}

/** *Same everywhere…*: one write per place the person may be changed on — never their own Mates. */
export function everywhereChanges(input: {
  readonly row: AccessRow;
  readonly columns: ReadonlyArray<AccessColumn>;
  readonly choice: CellChoice;
}): ReadonlyArray<ProjectAccessChange> {
  const { row, columns, choice } = input;
  return row.cells.flatMap((cell, index) =>
    cell.choices.length === 0 || columns[index] === undefined
      ? []
      : [
          cellChange({
            clientUserId: row.key,
            memberRole: row.roleCode,
            projectId: cell.projectId,
            choice,
          }),
        ],
  );
}

const RANKS: ReadonlyArray<ZeropsOrgRole> = [
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
];
const LEVEL_RANK: Readonly<Record<CellLevel, number>> = {
  owner: 4,
  full: 4,
  basic: 3,
  read: 2,
  none: 0,
  unknown: 0,
};

export function accessTable(input: ProjectPeopleInput): AccessTableView {
  const { members } = input;
  if (members.refused) return { kind: "unreadable", line: UNREADABLE.refused };
  if (!members.known)
    return members.status === "failed"
      ? { kind: "unreadable", line: UNREADABLE.failed }
      : { kind: "reading" };
  // Every column's people are read at once: a table half drawn would take cells back.
  for (const { projectId } of input.projects) {
    const read = input.grants[projectId];
    if (read?.grants === undefined && read?.status !== "failed") return { kind: "reading" };
  }

  const people = members.list.filter((member) => !isTokenMember(member));
  const ownerFace = (projectId: string): PersonFace | null => {
    const owner = input.owners[projectId];
    const found = people.find((member) => (member.user?.id ?? member.userId) === owner);
    return owner == null || found === undefined ? null : memberFace(found, input.pictures);
  };
  const columns: ReadonlyArray<AccessColumn> = input.projects
    .map(({ projectId, kind, name }, index) => {
      const mate = isMateKind(kind);
      const column: AccessColumn = {
        projectId,
        kind: mate ? "mate" : kind === "production" ? "production" : "stage",
        label: mate
          ? (name ?? "Mate")
          : environmentTitle(kind === "production" ? "production" : "stage", name ?? ""),
        owner: mate ? ownerFace(projectId) : null,
        unread: input.grants[projectId]?.grants === undefined,
      };
      return { column, index };
    })
    .toSorted(
      (a, b) => COLUMN_ORDER[a.column.kind] - COLUMN_ORDER[b.column.kind] || a.index - b.index,
    )
    .map(({ column }) => column);

  const viewer = input.viewer;
  const editable = viewer !== undefined && roleAtLeast(viewer.roleCode, "ADMIN");
  const candidates: Array<AccessCandidate> = [];
  const ranked = people.flatMap((member) => {
    const role = asOrgRole(member.roleCode);
    const face = memberFace(member, input.pictures);
    const pending = isPending(member);
    const self = viewer !== undefined && member.id === viewer.membershipId;
    // An admin changes no owner's or other admin's access: Zerops refuses those writes.
    const changeable =
      editable && (roleAtLeast(viewer.roleCode, "OWNER") || self || !roleAtLeast(role, "ADMIN"));
    const base = defaultLevel(role);
    const cells = columns.map((column): AccessCell => {
      const owned =
        column.kind === "mate" &&
        face.userId !== undefined &&
        input.owners[column.projectId] === face.userId;
      const grant = input.grants[column.projectId]?.grants?.find(
        ({ clientUserId }) => clientUserId === member.id,
      )?.roleCode;
      if (owned || grant === "OWNER")
        return {
          projectId: column.projectId,
          level: "owner",
          byDefault: false,
          choices: [],
          fixed: editable ? `${column.label} is ${face.name}’s Mate.` : null,
        };
      if (column.unread)
        return {
          projectId: column.projectId,
          level: "unknown",
          byDefault: false,
          choices: [],
          fixed: `Zerops doesn’t show you who reaches ${column.label}.`,
        };
      const level = grant === undefined ? base : defaultLevel(grant);
      const choices = changeable ? cellChoices(role, level) : [];
      return {
        projectId: column.projectId,
        level,
        byDefault: grant === undefined,
        choices,
        fixed:
          editable && !changeable
            ? "Only an organization owner can change an owner’s or admin’s access."
            : null,
      };
    });
    if (cells.every(({ level }) => level === "none" || level === "unknown")) {
      candidates.push({ ...face, clientUserId: member.id, pending });
      return [];
    }
    const own = cells.some((cell) => cell.choices.length > 0 && !cell.byDefault);
    const everywhere = cells.some(({ choices }) => choices.length > 0)
      ? [
          ...levelsFor(role).map((choice) => ({ choice, label: CHOICE_WORDS[choice] })),
          ...(own
            ? [{ choice: "default" as const, label: `Organization default (${CELL_WORDS[base]})` }]
            : []),
        ]
      : [];
    const row: AccessRow = {
      ...face,
      key: member.id,
      roleCode: role,
      you: face.userId !== undefined && face.userId === input.viewerUserId,
      self,
      pending,
      cells,
      everywhere,
      withdraw: pending && editable && !roleAtLeast(role, "ADMIN"),
    };
    // Ordered by what they have on the places — or on the Mates, where the app has no place.
    const judged = cells.filter((_, index) => columns[index]?.kind !== "mate");
    const best = Math.max(
      ...(judged.length > 0 ? judged : cells).map(({ level }) => LEVEL_RANK[level]),
    );
    return [{ row, rank: [row.you ? 0 : 1, pending ? 1 : 0, -best, -RANKS.indexOf(role)] }];
  });

  return {
    kind: "table",
    columns,
    rows: ranked
      .toSorted((a, b) => {
        for (const [index, value] of a.rank.entries()) {
          const other = b.rank[index]!;
          if (value !== other) return value - other;
        }
        return a.row.name.localeCompare(b.row.name);
      })
      .map(({ row }) => row),
    editable,
    invite: editable,
    candidates: candidates.toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The levels a person may be given: never *None* for an owner or admin. */
const levelsFor = (role: ZeropsOrgRole): ReadonlyArray<Exclude<CellChoice, "default">> => {
  const base = defaultLevel(role);
  return (["full", "read", "none"] as const).filter(
    (level) => level !== base && (level !== "none" || mayHide(role) || role === "NO_ACCESS"),
  );
};

/**
 * A cell's choices: each level but the one the organization gives, then that default by its word,
 * what holds now checked.
 */
function cellChoices(role: ZeropsOrgRole, level: CellLevel): ReadonlyArray<CellChoiceEntry> {
  const base = defaultLevel(role);
  return [
    ...levelsFor(role).map((choice) => ({
      choice,
      label: CHOICE_WORDS[choice],
      checked: level === choice,
    })),
    {
      choice: "default" as const,
      label: `Organization default (${CELL_WORDS[base]})`,
      checked: level === base,
    },
  ];
}

/** Who reaches one place, with their level there: a place's page and a Mate's *Access*, read only. */
export function columnPeople(
  view: AccessTableView,
  projectId: string,
): {
  readonly label: string;
  readonly people: ReadonlyArray<
    PersonFace & {
      readonly key: string;
      readonly pending: boolean;
      readonly level: Exclude<CellLevel, "none" | "unknown">;
      readonly byDefault: boolean;
    }
  >;
} | null {
  if (view.kind !== "table") return null;
  const index = view.columns.findIndex((column) => column.projectId === projectId);
  const column = view.columns[index];
  if (column === undefined) return null;
  return {
    label: column.label,
    people: view.rows.flatMap((row) => {
      const cell = row.cells[index];
      if (cell === undefined || cell.level === "none" || cell.level === "unknown") return [];
      return [{ ...row, level: cell.level, byDefault: cell.byDefault }];
    }),
  };
}

const SUMMARY_ORDER: ReadonlyArray<CellLevel> = ["owner", "full", "basic", "read"];

/** A row in one line, where its cells don't fit: "Owner: Fen · Full: Production, Stage". */
export function rowSummary(row: AccessRow, columns: ReadonlyArray<AccessColumn>): string {
  return SUMMARY_ORDER.flatMap((level) => {
    const where = row.cells.flatMap((cell, index) =>
      cell.level === level ? [columns[index]?.label ?? ""] : [],
    );
    return where.length === 0 ? [] : [`${CELL_WORDS[level]}: ${where.join(", ")}`];
  }).join(" · ");
}
