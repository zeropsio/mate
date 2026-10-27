/**
 * What the ref picker lists, from the pages of refs HQ answered and the changes the page already
 * holds: Mate's branches, its changes' branches by the change's title, what HQ follows from
 * GitHub, and a typed commit id as a commit.
 *
 * Pure: no network, no clock.
 */
import {
  refGroups,
  type GitRefGroupName,
} from "@t3tools/client-runtime/zerops/gitBrowse/refGroups";
import { refRevision } from "@t3tools/client-runtime/zerops/gitBrowse/refs";
import type { GitRefItem } from "@t3tools/shared/hqGitBrowse/refs";

/** A change the page holds, as far as the picker names it. */
export interface PickerChange {
  readonly number: number;
  readonly title: string;
  readonly mateProjectId: string;
}

export interface PickerRow {
  /** Unique in the list: the ref's full name, or `commit:<id>`. */
  readonly value: string;
  /** What the page opens. */
  readonly rev: string;
  readonly label: string;
  /** The branch's own name under a change's title. */
  readonly detail: string | null;
  readonly outsideMate: boolean;
  readonly commit?: { readonly subject: string | null; readonly committedAt: string | null };
}

export interface PickerSection {
  readonly name: GitRefGroupName | "Commit";
  readonly rows: ReadonlyArray<PickerRow>;
}

const COMMIT_ID = /^[0-9a-f]{7,40}$/iu;

/** A typed 7-40 hex string, as the commit it may name. */
export const typedCommit = (query: string): string | null => {
  const typed = query.trim();
  return COMMIT_ID.test(typed) ? typed.toLowerCase() : null;
};

/** A change's branch by its change's title, where the page holds that change. */
export const changeTitle = (
  item: Pick<GitRefItem, "change">,
  changes: ReadonlyArray<PickerChange>,
): string | null =>
  item.change === undefined
    ? null
    : (changes.find(
        (change) =>
          change.number === item.change!.number && change.mateProjectId === item.change!.mateId,
      )?.title ?? null);

export const pickerSections = (input: {
  readonly items: ReadonlyArray<GitRefItem>;
  readonly query: string;
  readonly changes: ReadonlyArray<PickerChange>;
}): ReadonlyArray<PickerSection> => {
  const commit = typedCommit(input.query);
  const typed: ReadonlyArray<PickerSection> =
    commit === null
      ? []
      : [
          {
            name: "Commit",
            rows: [
              {
                value: `commit:${commit}`,
                rev: commit,
                label: `Commit ${commit.slice(0, 7)}`,
                detail: null,
                outsideMate: false,
              },
            ],
          },
        ];
  return [
    ...typed,
    ...refGroups(input.items).map((group) => ({
      name: group.name,
      rows: group.items.map((item): PickerRow => {
        const title = changeTitle(item, input.changes);
        const metadataPending =
          item.metadataPending === true || item.subject == null || !item.committedAt;
        return {
          value: item.ref,
          rev: refRevision(item),
          label: title ?? item.name,
          detail: title === null ? null : item.name,
          outsideMate: item.outsideMate,
          commit: {
            subject: metadataPending ? null : (item.subject ?? null),
            committedAt: metadataPending ? null : (item.committedAt ?? null),
          },
        };
      }),
    })),
  ];
};
