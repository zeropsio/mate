import type { GitBrowseView } from "@t3tools/client-runtime/data";
import { currentStorage } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { HqRepoStorage } from "@t3tools/contracts";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import { useId, useState, type FormEvent } from "react";
import { Button, InlineButton } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { useRepoStorage } from "~/zerops/useRepoStorage";
import { GitRepositoryStorage } from "./GitRepositoryStorage";

/**
 * A repository's storage figure, from HQ's storage read once it answers (and a set's answer after),
 * with the limit's control for whoever HQ's structure verb lets set it; everyone else reads it.
 */
export function GitStorageFigure({
  appId,
  repo,
  storage,
}: {
  readonly appId: string;
  readonly repo: string;
  /** What the repository's home said, until its storage read answers. */
  readonly storage: GitHomeAbout["storage"];
}) {
  const { view, offer, set } = useRepoStorage(appId, repo);
  const read = view.state === "known" ? view.answer : null;
  return (
    <GitRepositoryStorage
      storage={currentStorage(storage, read)}
      control={
        offer.kind === "allowed" && set !== undefined ? (
          <StorageLimit key={`${appId}:${repo}`} view={view} set={set} />
        ) : null
      }
    />
  );
}

function StorageLimit({
  view,
  set,
}: {
  readonly view: GitBrowseView<HqRepoStorage>;
  readonly set: (capGiB: number) => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capGiB = view.state === "known" ? view.answer.capGiB : null;
  const value = draft ?? (capGiB === null ? "" : String(capGiB));
  // Whole GiB is all the field takes; HQ alone decides which ones it allows.
  const typed = value.trim() === "" ? null : Number(value);
  const whole = typed !== null && Number.isInteger(typed) ? typed : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (whole === null || pending) return;
    setPending(true);
    setError(null);
    set(whole).then(
      () => {
        setPending(false);
        setDraft(null);
        setOpen(false);
      },
      (cause: unknown) => {
        setPending(false);
        setError(cause instanceof Error ? cause.message : "HQ did not take this change.");
      },
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && !pending) {
          setDraft(null);
          setError(null);
        }
      }}
    >
      <PopoverTrigger render={<InlineButton />}>Change limit</PopoverTrigger>
      <PopoverPopup align="start" width="md">
        {capGiB === null ? (
          <p
            className="text-sm text-muted-foreground"
            role={view.state === "unread" ? undefined : "alert"}
          >
            {view.state === "refused" || view.state === "failed"
              ? view.words
              : view.state === "withheld"
                ? "You can't read this repository's storage limit."
                : "Reading the storage limit…"}
          </p>
        ) : (
          <form className="flex flex-col gap-2" noValidate onSubmit={submit}>
            <label className="text-sm font-medium text-foreground" htmlFor={id}>
              Storage limit
            </label>
            <p className="text-xs text-muted-foreground">
              In whole GiB, from 1 to 100. It is {capGiB} GiB now.
            </p>
            <div className="flex items-center gap-2">
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                size="sm"
                value={value}
                disabled={pending}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
              <span className="text-xs text-muted-foreground">GiB</span>
              <Button type="submit" size="sm" disabled={whole === null || pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
            {error === null ? null : (
              <p className="text-xs text-destructive-foreground" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </PopoverPopup>
    </Popover>
  );
}
