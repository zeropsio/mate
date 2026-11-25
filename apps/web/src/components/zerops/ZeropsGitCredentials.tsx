import { useMemo, useState } from "react";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { Failure } from "~/components/ui/failure";
import { Input } from "~/components/ui/input";
import { Loading } from "~/components/ui/loading";
import { useGitCredentials } from "~/zerops/useGitCredentials";
import { useHqAppReleases } from "~/zerops/useHqAppDetail";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { Card } from "~/components/ui/card";
import { Text } from "~/components/ui/text";

export function ZeropsGitCredentialsView({
  state,
  cloneUrl,
  onIssue,
  onRevoke,
  onAgain,
  onCopy,
}: {
  readonly state: ReturnType<typeof useGitCredentials>["state"];
  readonly cloneUrl: string;
  readonly onIssue: () => void;
  readonly onRevoke: (id: string) => void;
  readonly onAgain: () => void;
  readonly onCopy: () => void;
}) {
  const busy = state.action.kind === "working";
  const [commandCopy, setCommandCopy] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <Card className="min-w-0 flex-1">
          <pre className="min-w-0 overflow-auto p-3 font-mono text-caption text-foreground">
            <code>git clone {cloneUrl}</code>
          </pre>
        </Card>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void writeTextToClipboard(`git clone ${cloneUrl}`, "clone command").then(
              () => setCommandCopy("Copied"),
              () => setCommandCopy("Could not copy. Copy the command manually."),
            );
          }}
        >
          Copy command
        </Button>
      </div>
      {commandCopy === null ? null : (
        <Text render={<p />} variant="note" role="status">
          {commandCopy}
        </Text>
      )}
      <Text render={<p />} variant="description">
        Use <code>person</code> as the username and your Git password when Git asks. It lasts 12
        hours and uses your current Zerops permissions.
      </Text>
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={
            busy || state.credentials.state !== "known" || state.action.kind === "unresolved"
          }
          onClick={onIssue}
        >
          {state.action.kind === "working" && state.action.verb === "issue"
            ? "Creating…"
            : "Create Git password"}
        </Button>
      </div>
      {state.action.kind === "failed" || state.action.kind === "unresolved" ? (
        <p role="alert" className="text-body text-status-failed">
          {state.action.words}
        </p>
      ) : null}
      {state.action.kind === "issued" ? (
        <div className="flex flex-col gap-2">
          <Text render={<p />} variant="description">
            Copy this password now. It is only shown once.
          </Text>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              font="mono"
              readOnly
              autoComplete="off"
              aria-label="Git password"
              value={state.action.credential.token}
            />
            <Button variant="secondary" size="sm" onClick={onCopy}>
              Copy password
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Text render={<h3 />} variant="heading">
          Your Git passwords for this project
        </Text>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAgain}
          disabled={state.credentials.state === "reading"}
        >
          Read again
        </Button>
      </div>
      {state.credentials.state === "known" ? (
        <>
          {state.credentials.partial ? (
            <Text render={<p />} variant="description">
              Read again to see all your passwords.
            </Text>
          ) : null}
          {state.credentials.stale ? (
            <p className="text-body text-status-failed">
              HQ could not read the password list again.
            </p>
          ) : null}
          {state.credentials.records.length === 0 ? (
            <EmptyState size="line">No Git password yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {state.credentials.records.map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-3 py-2">
                  <Text variant="meta">
                    Created{" "}
                    <time dateTime={record.createdAt}>
                      {formatDayAwareTimestamp(record.createdAt, "locale")}
                    </time>{" "}
                    · expires{" "}
                    <time dateTime={record.expiresAt}>
                      {formatDayAwareTimestamp(record.expiresAt, "locale")}
                    </time>
                  </Text>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onRevoke(record.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : state.credentials.state === "withheld" ? (
        <p role="alert" className="text-body text-status-failed">
          Git password access is unavailable. Read again to check your access.
        </p>
      ) : state.credentials.state === "failed" ? (
        <Failure cause={state.credentials.words} role="alert" size="line" />
      ) : (
        <Loading label="Reading your Git passwords" shape="words" />
      )}
    </div>
  );
}
export function ZeropsGitCredentials({
  appId,
  repo,
}: {
  readonly appId: string;
  readonly repo: string;
}) {
  const credentials = useGitCredentials(appId);
  const appIds = useMemo(() => [appId], [appId]);
  const cloneUrl = useHqAppReleases(appIds)
    .repos.get(appId)
    ?.find((r) => r.name === repo)?.url;
  if (cloneUrl === undefined)
    return (
      <Text render={<p />} variant="description">
        Waiting for HQ…
      </Text>
    );
  return (
    <>
      <ZeropsGitCredentialsView {...credentials} cloneUrl={cloneUrl} />
      {credentials.copied === null ? null : (
        <Text render={<p />} variant="note" role="status">
          {credentials.copied}
        </Text>
      )}
    </>
  );
}
