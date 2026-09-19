import { AGENT_SIGN_IN_MESSAGE, agentNeedsSignIn } from "@t3tools/client-runtime/zerops";
import { memo } from "react";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function getThreadErrorBannerKey(threadKey: string, error: string | null): string | null {
  return error === null ? null : `${threadKey}\u0000${error}`;
}

export function shouldShowThreadErrorBanner(
  threadKey: string,
  error: string | null,
  isDismissed: boolean,
): boolean {
  return getThreadErrorBannerKey(threadKey, error) !== null && !isDismissed;
}

// Session-scoped (module-level so it survives ChatView remounts, e.g. route
// changes between threads). Mirrors the branch-mismatch banner: a dismissal
// is remembered per thread key plus message, so navigating away to a thread
// with no error cannot resurrect the banner, while a different error message
// on the same thread still appears.
const sessionDismissedThreadErrorBannerKeys = new Set<string>();

export function dismissThreadErrorBannerForSession(bannerKey: string | null): void {
  if (bannerKey !== null) {
    sessionDismissedThreadErrorBannerKeys.add(bannerKey);
  }
}

export function isThreadErrorBannerDismissedForSession(bannerKey: string | null): boolean {
  return bannerKey !== null && sessionDismissedThreadErrorBannerKeys.has(bannerKey);
}

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
  onAuthorize,
}: {
  error: string | null;
  onDismiss?: () => void;
  /**
   * Opens the tray that signs the agent in, where the caller has one.
   *
   * A driver that is not signed in says so the way a terminal would — *run
   * `claude auth login` on this environment's machine* — and that machine is a
   * container the person reaches through this app and has no shell on. The app
   * can do it; the banner offers that instead of repeating the command.
   */
  onAuthorize?: (() => void) | undefined;
}) {
  if (!error) return null;
  const needsSignIn = onAuthorize !== undefined && agentNeedsSignIn(error);
  if (needsSignIn) {
    return (
      <div className="mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
        <Alert variant="error" controlAlignment="first-line">
          <CircleAlertIcon />
          <AlertDescription>{AGENT_SIGN_IN_MESSAGE}</AlertDescription>
          <AlertAction>
            <Button
              data-zerops-primary-action="Authorize"
              onClick={onAuthorize}
              size="sm"
              variant="ghost"
            >
              Authorize
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }
  return (
    <div className="mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert variant="error" controlAlignment="first-line">
        <CircleAlertIcon />
        <AlertDescription>
          <Tooltip>
            <TooltipTrigger render={<div className="line-clamp-3" />}>{error}</TooltipTrigger>
            <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap">
              {error}
            </TooltipPopup>
          </Tooltip>
        </AlertDescription>
        {onDismiss && (
          <AlertAction>
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={onDismiss}>
              <XIcon className="text-destructive" />
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
