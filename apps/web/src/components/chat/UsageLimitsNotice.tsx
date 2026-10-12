import type { EnvironmentId, UsageLimitsReport } from "@t3tools/contracts";
import { limitsNotice } from "@t3tools/shared/usageLimits";
import { GaugeIcon } from "lucide-react";

import { getDriverOption } from "../settings/providerDriverMeta";
import { LimitWindows, ResetCredits } from "../usage/UsageLimits";
import type { ConversationNotice } from "./ConversationRows";

/** Driver name, then the instance when there could be more than one of that driver. */
function accountLabel(account: UsageLimitsReport["accounts"][number]): string {
  if (!account.instanceId) return account.label;
  const driver = getDriverOption(account.driver)?.label ?? String(account.driver);
  const instance =
    account.displayName?.trim() ||
    (String(account.instanceId) !== String(account.driver) ? account.instanceId : "");
  // The default instance is often named after its driver; saying it twice adds nothing.
  return instance && instance.toLowerCase() !== driver.toLowerCase()
    ? `${driver} · ${instance}`
    : driver;
}

/**
 * The /usage-limits answer, as its row at the conversation's end: the account and plan on its line,
 * each window and when it resets under it, whole; × puts it away.
 */
export function usageLimitsNotice(
  id: string,
  report: UsageLimitsReport,
  environmentId: EnvironmentId,
  onDismiss: () => void,
): ConversationNotice {
  const [first] = report.accounts;
  const single = report.accounts.length === 1 && first ? first : null;
  const summary = single
    ? [accountLabel(single), single.plan].filter(Boolean).join(" · ")
    : `${report.accounts.length} accounts`;
  return {
    id,
    icon: <GaugeIcon />,
    words: (
      <>
        <strong>Usage limits</strong> · {summary}
      </>
    ),
    detail: <UsageLimitsBody report={report} environmentId={environmentId} />,
    dismissLabel: "Dismiss usage limits",
    onDismiss,
  };
}

function UsageLimitsBody({
  report,
  environmentId,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
}) {
  const now = Date.parse(report.createdAt);
  return (
    <div className="flex flex-col gap-2 pb-1.5">
      {report.accounts.map((account) => {
        const resetCreditInput =
          account.resetCreditInput ??
          (account.instanceId ? { instanceId: account.instanceId } : undefined);
        const notice = limitsNotice(account.limits);
        return (
          <div key={account.id} className="flex min-w-0 flex-col gap-1">
            {report.accounts.length > 1 ? (
              <span className="truncate text-xs text-muted-foreground">
                {[accountLabel(account), account.plan].filter(Boolean).join(" · ")}
              </span>
            ) : null}
            {notice ? (
              <span className="text-xs text-muted-foreground">{notice}</span>
            ) : (
              <LimitWindows
                compact
                driver={account.driver}
                windows={account.limits.windows}
                now={now}
              />
            )}
            {resetCreditInput && account.limits.resetCredits ? (
              <ResetCredits
                environmentId={environmentId}
                input={resetCreditInput}
                credits={account.limits.resetCredits}
                now={now}
              />
            ) : null}
          </div>
        );
      })}
      {report.notices.map((notice) => (
        <span key={notice} className="text-xs text-muted-foreground">
          {notice}
        </span>
      ))}
    </div>
  );
}
