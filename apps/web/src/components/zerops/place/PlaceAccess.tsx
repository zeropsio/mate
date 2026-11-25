/**
 * Who reaches a place, as its page's aside says it: their faces stacked (five, then "+N"), how many
 * they are and how their access splits. Who they are by name, and changing it, is the project
 * page's access section, linked from the card's label.
 */
import type { ReactNode } from "react";

import { Card } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty";

import type { columnPeople } from "../projects/accessTable.logic";
import { PersonAvatarStack } from "../primitives";
import { ACCESS_FACES, accessBreakdown } from "./place.logic";
import { Text } from "~/components/ui/text";

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
  return (
    <Card className="min-w-0" data-zerops-surface="place-access">
      <div className="flex min-w-0 items-center gap-3.5 px-4 py-3.5">
        {summary === null ? (
          unread
        ) : people.length === 0 ? (
          <EmptyState size="line">Nobody has access yet.</EmptyState>
        ) : (
          <>
            <PersonAvatarStack people={people} shown={ACCESS_FACES} size={32} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body text-foreground">{words.count}</span>
              {words.split === "" ? null : (
                <Text truncate variant="note">
                  {words.split}
                </Text>
              )}
            </span>
          </>
        )}
      </div>
    </Card>
  );
}
