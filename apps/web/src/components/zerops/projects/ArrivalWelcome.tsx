/**
 * The overview's welcome on a person's first visit after joining (`arrival.logic`): one line
 * naming the organization and their role, and the one thing that role can do. It is decided once,
 * when the projects and who started their Mates are read, in the same render that draws it; the
 * decision is kept, so later visits are quiet.
 */
import { useEffect, useState } from "react";

import { markWelcomed, wasWelcomed } from "~/zerops/invitationMemory";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import {
  arrivalWelcome,
  welcomeOwed,
  type ArrivalApp,
  type ArrivalWelcome as Welcome,
} from "./arrival.logic";

interface Decided {
  readonly orgId: string;
  readonly welcome: Welcome | null;
}

export function ArrivalWelcome({
  orgId,
  organizationName,
  viewer,
  apps,
  settled,
  onStart,
}: {
  readonly orgId: string;
  readonly organizationName: string;
  readonly viewer: { readonly roleCode?: string | undefined; readonly canCreateProjects?: boolean };
  readonly apps: ReadonlyArray<ArrivalApp>;
  /** The projects, who started their Mates and what HQ offers are read: the welcome may decide. */
  readonly settled: boolean;
  readonly onStart: (groupId: string) => void;
}) {
  const [decided, setDecided] = useState<Decided | null>(null);
  // Decided during render, so the line lands with the page and never pushes it down a frame later.
  if (settled && apps.length > 0 && decided?.orgId !== orgId) {
    const owed = welcomeOwed({ welcomed: wasWelcomed(orgId), apps });
    setDecided({
      orgId,
      welcome: owed ? arrivalWelcome({ organizationName, viewer, apps }) : null,
    });
  }
  useEffect(() => {
    if (decided !== null) markWelcomed(decided.orgId);
  }, [decided]);

  const welcome = decided?.orgId === orgId ? decided.welcome : null;
  if (welcome === null) return null;
  const { action } = welcome;
  return (
    <Card variant="flat">
      <div
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3"
        data-zerops-surface="arrival-welcome"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">{welcome.line}</p>
          {welcome.detail === null ? null : (
            <p className="text-sm text-muted-foreground">{welcome.detail}</p>
          )}
        </div>
        {action === null ? null : (
          <Button onClick={() => onStart(action.groupId)} size="sm">
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  );
}
