import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useGitCredentials } from "~/zerops/useGitCredentials";
import { formatDayAwareTimestamp } from "~/timestampFormat";

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
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <pre className="overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs text-foreground">
        <code>git clone {cloneUrl}</code>
      </pre>
      <p className="text-sm text-muted-foreground">
        Use <code>person</code> as the username and your Git password when Git asks. It lasts 12
        hours and uses your current Zerops permissions.
      </p>
      <div>
        <Button variant="outline" size="sm" disabled={busy} onClick={onIssue}>
          {state.action.kind === "working" && state.action.verb === "issue"
            ? "Creating…"
            : "Create Git password"}
        </Button>
      </div>
      {state.action.kind === "failed" || state.action.kind === "unresolved" ? (
        <p role="alert" className="text-sm text-status-failed">
          {state.action.words} Read the password list again before creating another.
        </p>
      ) : null}
      {state.action.kind === "issued" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Copy this password now. It is only shown once.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              font="mono"
              readOnly
              autoComplete="off"
              aria-label="Git password"
              value={state.action.credential.token}
            />
            <Button variant="outline" size="sm" onClick={onCopy}>
              Copy password
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Your Git passwords for this project</h3>
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
            <p className="text-sm text-muted-foreground">Read again to see all your passwords.</p>
          ) : null}
          {state.credentials.stale ? (
            <p className="text-sm text-status-failed">HQ could not read the password list again.</p>
          ) : null}
          {state.credentials.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Git password yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {state.credentials.records.map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    Created{" "}
                    <time dateTime={record.createdAt}>
                      {formatDayAwareTimestamp(record.createdAt, "locale")}
                    </time>{" "}
                    · expires{" "}
                    <time dateTime={record.expiresAt}>
                      {formatDayAwareTimestamp(record.expiresAt, "locale")}
                    </time>
                  </span>
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
      ) : state.credentials.state === "failed" ? (
        <p role="alert" className="text-sm text-status-failed">
          {state.credentials.words}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Reading your Git passwords…</p>
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
  if (credentials.address === undefined)
    return <p className="text-sm text-muted-foreground">Waiting for HQ…</p>;
  const cloneUrl = `${credentials.address.replace(/\/+$/u, "")}/git/${encodeURIComponent(appId)}/${encodeURIComponent(repo)}.git`;
  return (
    <>
      <ZeropsGitCredentialsView {...credentials} cloneUrl={cloneUrl} />
      {credentials.copied === null ? null : (
        <p className="text-xs text-muted-foreground" role="status">
          {credentials.copied}
        </p>
      )}
    </>
  );
}
