/**
 * The organization's HQ on the Tools row (`hqToolLine`): healthy, unavailable since when, being
 * set up and how far, where it stopped with *Try again* — and, where the organization has none,
 * *Set up HQ* for an owner or an admin, or whom to ask for anybody else.
 */
import { canWriteRegistry } from "@t3tools/client-runtime/zerops";
import { runHqBirth } from "@t3tools/client-runtime/zerops/hq";

import { hqBirthDeps, hqBirthSite, useAccountHq, useHqStanding } from "~/zerops/accountHq";
import { bearHq, hqBirthView, useHqBirths } from "~/zerops/hqBirth";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { QUIET_BUTTON_CLASS } from "./projects/flowSteps";
import { hqToolLine } from "./ZeropsHqTool.logic";

export function ZeropsHqTool() {
  const { activeOrganization, client } = useZeropsSession();
  const clientId = activeOrganization?.id;
  const accountHq = useAccountHq(clientId);
  const standing = useHqStanding(
    accountHq.hq.kind === "official" ? accountHq.hq.address : undefined,
  );
  const held = useHqBirths((state) => (clientId === undefined ? undefined : state.byOrg[clientId]));
  const line = hqToolLine({
    status: accountHq.status,
    hq: accountHq.hq,
    standing,
    birth: hqBirthView(held),
    mayBear: canWriteRegistry({ roleCode: activeOrganization?.roleCode }),
    admins: accountHq.admins,
  });
  const setUp = () => {
    if (clientId === undefined) return;
    bearHq({
      clientId,
      run: (record, moved) =>
        runHqBirth({
          record,
          clientId,
          ...hqBirthSite(client),
          deps: hqBirthDeps(client),
          moved,
        }),
      onBorn: accountHq.reread,
    });
  };

  switch (line.kind) {
    case "none":
      return <span data-zerops-surface="hq-tool">HQ</span>;
    case "healthy":
      return (
        <span data-zerops-surface="hq-tool">
          HQ <span className="text-muted-foreground">· Healthy</span>
        </span>
      );
    case "unavailable":
      return (
        <span data-zerops-surface="hq-tool" role="status">
          HQ{" "}
          <span className="text-muted-foreground">
            · Unavailable since{" "}
            {new Date(line.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
      );
    case "set-up":
      return (
        <button
          className={QUIET_BUTTON_CLASS}
          data-zerops-surface="hq-tool"
          onClick={setUp}
          type="button"
        >
          <span aria-hidden="true">+</span>
          <span>Set up HQ</span>
        </button>
      );
    case "setting-up":
      return (
        <span data-zerops-surface="hq-tool" role="status">
          HQ <span className="text-muted-foreground">· {line.doing}…</span>
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex flex-wrap items-center gap-2" data-zerops-surface="hq-tool">
          <span role="alert">
            HQ <span className="text-muted-foreground">· {line.reason}</span>
          </span>
          {line.tryAgain ? (
            <button className={QUIET_BUTTON_CLASS} onClick={setUp} type="button">
              Try again
            </button>
          ) : null}
        </span>
      );
    case "ask":
    case "unclear":
      return (
        <span className="text-muted-foreground" data-zerops-surface="hq-tool">
          {line.line}
        </span>
      );
  }
}
