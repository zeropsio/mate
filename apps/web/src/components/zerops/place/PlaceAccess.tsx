/**
 * Who reaches a place, as its page's aside says it: their faces stacked (five, then "+N"), how many
 * they are and how their access splits. Who they are by name, and changing it, is the project
 * page's access section, linked from the card's label.
 */
import type { ReactNode } from "react";

import { Card } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty";

import type { columnPeople } from "../projects/accessTable.logic";
import { PersonAvatar } from "../primitives";
import { ACCESS_FACES, accessBreakdown } from "./place.logic";

export function PlaceAccessCard({
  summary,
  unread,
}: {
  /** The place's people with their level there; `null` while they are read or can't be. */
  readonly summary: ReturnType<typeof columnPeople>;
  /** What stands for them while they are read or can't be (`AccessUnread`). */
  readonly unread: ReactNode;
}) {
  const people = summary?.people ?? [];
  const words = accessBreakdown(people);
  const more = people.length - ACCESS_FACES;
  return (
    <Card className="min-w-0" data-zerops-surface="place-access">
      <div className="flex min-w-0 items-center gap-3.5 px-4 py-3.5">
        {summary === null ? (
          unread
        ) : people.length === 0 ? (
          <EmptyState size="line">Nobody has access yet.</EmptyState>
        ) : (
          <>
            <span aria-hidden="true" className="flex shrink-0 ps-2">
              {people.slice(0, ACCESS_FACES).map((person) => (
                <PersonAvatar
                  className="-ms-2 ring-2 ring-card"
                  key={person.key}
                  name={person.name}
                  picture={person.avatarUrl}
                  size={32}
                />
              ))}
              {more <= 0 ? null : (
                <span className="relative -ms-2 flex size-8 items-center justify-center rounded-full bg-accent text-caption font-medium text-muted-foreground ring-2 ring-card tabular-nums">
                  {`+${String(more)}`}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body text-foreground">{words.count}</span>
              {words.split === "" ? null : (
                <span className="truncate text-caption text-muted-foreground">{words.split}</span>
              )}
            </span>
          </>
        )}
      </div>
    </Card>
  );
}
