import { agentNeedsSignIn } from "@t3tools/client-runtime/zerops";
import { mateFailureWords, usageLimitProvider } from "../../zerops/noticeWords";
import { memo } from "react";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { CircleAlertIcon, PauseIcon, XIcon } from "lucide-react";
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
  driver,
  mateName,
  usageLimitShown = false,
}: {
  error: string | null;
  mateName?: string | undefined;
  /** The timeline already owns this expected pause; say it once. */
  usageLimitShown?: boolean;
  /** The conversation's agent driver (its session's `providerName`): only its own sign-in failure is one. */
  driver?: string | null | undefined;
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
  const limit = usageLimitProvider(error);
  if (limit !== null && usageLimitShown) return null;
  const words = mateFailureWords(error, driver, mateName);
  const needsSignIn = agentNeedsSignIn(error, driver);
  if (needsSignIn) {
    return (
      <div className="mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
        <Alert variant="warning" role="status" controlAlignment="first-line">
          {limit === null ? <CircleAlertIcon /> : <PauseIcon />}
          <AlertDescription>{words}</AlertDescription>
          {onAuthorize === undefined ? null : (
            <AlertAction>
              <Button
                data-zerops-primary-action="Authorize"
                onClick={onAuthorize}
                size="sm"
                variant="ghost"
              >
                Sign in
              </Button>
            </AlertAction>
          )}
        </Alert>
      </div>
    );
  }
  return (
    <div className="mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert
        variant={limit === null ? "error" : "warning"}
        role={limit === null ? "alert" : "status"}
        controlAlignment="first-line"
      >
        {limit === null ? <CircleAlertIcon /> : <PauseIcon />}
        <AlertDescription>
          <Tooltip>
            <TooltipTrigger render={<div className="line-clamp-3" />}>{words}</TooltipTrigger>
            <TooltipPopup side="top" className="whitespace-pre-wrap">
              {words}
            </TooltipPopup>
          </Tooltip>
        </AlertDescription>
        {onDismiss && (
          <AlertAction>
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss notice" onClick={onDismiss}>
              <XIcon />
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
