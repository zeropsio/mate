import { sameValue } from "./equal.ts";
import type { MateAttentionRead } from "./mateAttention.ts";

/** The menu's existing row reading, plus HQ's dated results and current-work verdict. */
export interface MenuMateWork {
  readonly projectId: string;
  readonly activity?:
    | {
        readonly at: string;
        readonly hasWork?: true | undefined;
        readonly kind: string;
        readonly remembered?: true | undefined;
      }
    | undefined;
  readonly attention?: MateAttentionRead | undefined;
  readonly face: string;
}

export interface MenuProjectRecord {
  readonly id: string;
  readonly mates: ReadonlyArray<MenuMateWork>;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** One classification for every client drawing these project records. */
export function activeMenuProject(
  project: MenuProjectRecord,
  now: number,
  openProjectId: string | null | undefined,
): boolean {
  const recent = (at: string) => {
    const age = now - Date.parse(at);
    return age >= 0 && age <= WEEK;
  };
  return project.mates.some(
    ({ projectId, activity, attention, face }) =>
      projectId === openProjectId ||
      face === "needs" ||
      (activity?.remembered !== true &&
        ["working", "connecting", "monitoring"].includes(activity?.kind ?? "")) ||
      (attention?.live === true && (attention.attention?.working ?? 0) > 0) ||
      (activity?.hasWork === true && recent(activity.at)) ||
      attention?.attention?.results.some((result) => recent(result.completedAt)) === true,
  );
}

export interface MenuProjectOpening {
  readonly scope: string;
  readonly open: boolean;
  readonly order: string;
  readonly active: ReadonlyArray<string>;
  readonly other: ReadonlyArray<string>;
}

/** Freeze identities, not row contents. Explicit order changes retain automatic membership. */
export function menuProjectOpening(
  previous: MenuProjectOpening | null,
  input: {
    readonly scope: string;
    readonly open: boolean;
    readonly order: string;
    /** Already ordered by the existing Name / Creation date / Custom preference. */
    readonly projects: ReadonlyArray<MenuProjectRecord>;
    readonly now: number;
    readonly openProjectId: string | null | undefined;
  },
): MenuProjectOpening {
  const reset =
    previous === null || previous.scope !== input.scope || (!previous.open && input.open);
  const held = reset ? null : previous;
  const known = new Set([...(held?.active ?? []), ...(held?.other ?? [])]);
  const active = new Set(held?.active ?? []);
  for (const project of input.projects) {
    if (!known.has(project.id) && activeMenuProject(project, input.now, input.openProjectId))
      active.add(project.id);
  }
  const current = input.projects.map(({ id }) => id);
  const order =
    held === null || held.order !== input.order
      ? current
      : [...held.active, ...held.other]
          .filter((id) => current.includes(id))
          .concat(current.filter((id) => !known.has(id)));
  const next = {
    scope: input.scope,
    open: input.open,
    order: input.order,
    active: order.filter((id) => active.has(id)),
    other: order.filter((id) => !active.has(id)),
  };
  return previous !== null && sameValue(previous, next) ? previous : next;
}
