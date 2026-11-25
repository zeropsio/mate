import type { GitBrowseView } from "@t3tools/client-runtime/data";
import { currentStorage } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { HqRepoStorage } from "@t3tools/contracts";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import { useId, useState, type FormEvent } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { GitRepositoryStorage } from "./GitRepositoryStorage";
import { Loading } from "~/components/ui/loading";
import { Text } from "~/components/ui/text";

/** The figure uses the same held storage read as the repository's limit form. */
export function GitStorageFigure({
  storage,
  view,
}: {
  readonly storage: GitHomeAbout["storage"];
  readonly view: GitBrowseView<HqRepoStorage>;
}) {
  const read = view.state === "known" ? view.answer : null;
  return <GitRepositoryStorage storage={currentStorage(storage, read)} />;
}

export function StorageLimit({
  view,
  set,
  onDone,
}: {
  readonly onDone: () => void;
  readonly view: GitBrowseView<HqRepoStorage>;
  readonly set: (capGiB: number) => Promise<void>;
}) {
  const id = useId();
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
        onDone();
      },
      (cause: unknown) => {
        setPending(false);
        setError(cause instanceof Error ? cause.message : "HQ did not take this change.");
      },
    );
  };
  return (
    <>
      {capGiB === null && view.state === "unread" ? (
        <Loading label="The storage limit" shape="line" />
      ) : capGiB === null ? (
        <Text render={<p />} variant="description" role="alert">
          {view.state === "refused" || view.state === "failed"
            ? view.words
            : "You can't read this repository's storage limit."}
        </Text>
      ) : (
        <form className="flex flex-col gap-2" noValidate onSubmit={submit}>
          <Text render={<label htmlFor={id} />} variant="heading">
            Storage limit
          </Text>
          <Text render={<p />} variant="note">
            In whole GiB, from 1 to 100. It is {capGiB} GiB now.
          </Text>
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
            <Text variant="note">GiB</Text>
            <Button type="submit" size="sm" disabled={whole === null || pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
          {error === null ? null : (
            <Text render={<p />} variant="error" role="alert">
              {error}
            </Text>
          )}
        </form>
      )}
    </>
  );
}
