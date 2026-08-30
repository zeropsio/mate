/**
 * The Zerops cards: one reading per `zerops_*` tool result.
 *
 * Presentational only. Whether there is a card at all, and what it says, is
 * decided by `@t3tools/client-runtime/zerops/cards/payloads` and tested there; a payload this
 * build cannot decode never reaches here, and the timeline renders its generic
 * tool block instead.
 *
 * Nothing here calls Zerops. The only actions are links to URLs the result
 * already carried.
 */
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import type {
  ZeropsCardPayload,
  ZeropsCheckLine,
} from "@t3tools/client-runtime/zerops/cards/payloads";

const PASSED = /^(pass|healthy|ok|done|finished|deployed|mounted|active)$/iu;
const FAILED = /^(fail|failed|unhealthy|error)$/iu;

function Verdict({ status }: { status: string }) {
  if (PASSED.test(status)) {
    return <CheckIcon aria-label="passed" className="size-3 shrink-0 text-success-foreground" />;
  }
  if (FAILED.test(status)) {
    return <XIcon aria-label="failed" className="size-3 shrink-0 text-destructive-foreground" />;
  }
  return null;
}

function CheckRow({ check }: { check: ZeropsCheckLine }) {
  return (
    <li className="flex items-center gap-1.5 text-xs">
      <Verdict status={check.status} />
      <span className="text-foreground">{check.name}</span>
      {check.httpStatus === undefined ? null : (
        <span className="text-muted-foreground">HTTP {check.httpStatus}</span>
      )}
      {check.detail === undefined ? null : (
        <span className="truncate text-muted-foreground">{check.detail}</span>
      )}
    </li>
  );
}

function UrlChip({ url }: { url: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 rounded-md bg-info/8 px-2 py-0.5 font-medium text-info-foreground text-xs hover:underline"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <ExternalLinkIcon className="size-3" />
      {url.replace(/^https?:\/\//u, "")}
    </a>
  );
}

function CardFrame({
  title,
  tone,
  children,
}: {
  readonly title: string;
  readonly tone?: "error";
  readonly children?: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "error"
          ? "rounded-xl border border-destructive/40 bg-destructive/8 px-3 py-2"
          : "rounded-xl border border-border/55 bg-card/20 px-3 py-2"
      }
      data-zerops-card
    >
      <div className="font-medium text-foreground text-sm">{title}</div>
      {children}
    </div>
  );
}

export function ZeropsToolCard({ payload }: { payload: ZeropsCardPayload }) {
  switch (payload.kind) {
    case "error":
      return (
        <CardFrame title={payload.code} tone="error">
          {/*
            A real zcp error message is multi-line — zcli's own log output is
            embedded in it (captured live: five log lines in one `error`).
            Collapsing those newlines, which is what HTML does by default, runs
            them into one unreadable sentence; and they can be long, so the
            block scrolls rather than pushing the rest of the card off screen.
          */}
          <p className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-destructive-foreground text-xs">
            {payload.message}
          </p>
          {payload.suggestion === undefined ? null : (
            <p className="mt-1 text-muted-foreground text-xs">{payload.suggestion}</p>
          )}
          {payload.failureClass === undefined ? null : (
            <Badge className="mt-1.5" size="sm" variant="error">
              {payload.failureClass}
            </Badge>
          )}
          {payload.checks.length === 0 ? null : (
            <ul className="mt-1.5 space-y-0.5">
              {payload.checks.map((check) => (
                <CheckRow check={check} key={check.name} />
              ))}
            </ul>
          )}
        </CardFrame>
      );

    case "deploy":
      return (
        <CardFrame
          title={`${payload.target} · ${payload.status}`}
          {...(payload.failedPhase === undefined ? {} : { tone: "error" as const })}
        >
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {payload.buildStatus === undefined ? null : (
              <Badge size="sm" variant="outline">
                build {payload.buildStatus}
              </Badge>
            )}
            {payload.buildDuration === undefined ? null : (
              <span className="text-muted-foreground">{payload.buildDuration}</span>
            )}
            {payload.subdomainUrl === undefined ? null : <UrlChip url={payload.subdomainUrl} />}
          </div>
          {payload.failedPhase === undefined ? null : (
            <p className="mt-1 text-destructive-foreground text-xs">
              failed during {payload.failedPhase}
              {payload.failureCause === undefined ? "" : ` — ${payload.failureCause}`}
            </p>
          )}
          {payload.failureAction === undefined ? null : (
            <p className="mt-0.5 text-muted-foreground text-xs">{payload.failureAction}</p>
          )}
          {payload.warnings.map((warning) => (
            <p className="mt-0.5 text-muted-foreground text-xs" key={warning}>
              {warning}
            </p>
          ))}
        </CardFrame>
      );

    case "verify":
      return (
        <CardFrame title={`${payload.hostname} · ${payload.status}`}>
          <ul className="mt-1 space-y-0.5">
            {payload.checks.map((check) => (
              <CheckRow check={check} key={check.name} />
            ))}
          </ul>
        </CardFrame>
      );

    case "import":
      return (
        <CardFrame title={payload.summary ?? `Importing into ${payload.projectName ?? "project"}`}>
          <ul className="mt-1 space-y-0.5">
            {payload.services.map((entry) => (
              <li className="flex items-center gap-1.5 text-xs" key={entry.hostname}>
                <Verdict status={entry.status} />
                <span className="text-foreground">{entry.hostname}</span>
                <span className="text-muted-foreground">{entry.status}</span>
                {entry.failReason === undefined ? null : (
                  <span className="truncate text-destructive-foreground">{entry.failReason}</span>
                )}
              </li>
            ))}
          </ul>
          {payload.errors.map((entry) => (
            <p className="mt-0.5 text-destructive-foreground text-xs" key={entry.hostname}>
              {entry.hostname}: {entry.message}
            </p>
          ))}
        </CardFrame>
      );

    case "mount":
      return (
        <CardFrame title={payload.mounts.length === 1 ? "Mount" : "Mounts"}>
          <ul className="mt-1 space-y-0.5">
            {payload.mounts.map((entry) => (
              <li className="flex items-center gap-1.5 text-xs" key={entry.hostname}>
                <Verdict status={entry.mounted ? "mounted" : "failed"} />
                <span className="text-foreground">{entry.hostname}</span>
                <span className="truncate text-muted-foreground">
                  {entry.mountPath ?? entry.message ?? (entry.mounted ? "mounted" : "not mounted")}
                </span>
              </li>
            ))}
          </ul>
        </CardFrame>
      );

    case "subdomain":
      return (
        <CardFrame title={`Subdomain ${payload.action} · ${payload.hostname}`}>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {payload.urls.map((url) => (
              <UrlChip key={url} url={url} />
            ))}
          </div>
        </CardFrame>
      );

    case "plan":
      return (
        <CardFrame title={payload.intent ?? "Plan"}>
          {payload.message === undefined ? null : (
            <p className="mt-0.5 text-muted-foreground text-xs">{payload.message}</p>
          )}
          <p className="mt-1 text-muted-foreground text-xs">
            step {payload.completed} of {payload.total}
          </p>
          <ul className="mt-1 space-y-0.5">
            {payload.steps.map((step) => (
              <li className="flex items-center gap-1.5 text-xs" key={step.name}>
                <Verdict status={step.status} />
                <span className="text-foreground">{step.name}</span>
                <span className="text-muted-foreground">{step.status}</span>
              </li>
            ))}
          </ul>
        </CardFrame>
      );
  }
}
