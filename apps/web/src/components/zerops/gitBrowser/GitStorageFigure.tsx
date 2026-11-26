import type { GitBrowseView } from "@t3tools/client-runtime/data";
import { currentStorage } from "@t3tools/client-runtime/zerops/gitBrowse/home";
import type { HqRepoStorage } from "@t3tools/contracts";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "~/components/ui/dialog";
import { Failure } from "~/components/ui/failure";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
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
  repo,
  storage,
  view,
  set,
  pending,
  setPending,
  focusRef,
  onDone,
}: {
  readonly repo: string;
  readonly storage: GitHomeAbout["storage"];
  readonly onDone: () => void;
  readonly view: GitBrowseView<HqRepoStorage>;
  readonly set: (capGiB: number) => Promise<void>;
  readonly pending: boolean;
  readonly setPending: (pending: boolean) => void;
  readonly focusRef: RefObject<HTMLElement | null>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
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
      <DialogHeader>
        <DialogTitle>Storage limit for {repo}</DialogTitle>
        <DialogDescription>
          A push that would take {repo} past its limit is refused.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <Card size="md" variant="inset">
          <GitStorageFigure storage={storage} view={view} />
        </Card>
        {capGiB === null && view.state === "unread" ? (
          <Loading label="The storage limit" shape="line" />
        ) : capGiB === null ? (
          <Text render={<p />} variant="description" role="alert">
            {view.state === "refused" || view.state === "failed"
              ? view.words
              : "You can't read this repository's storage limit."}
          </Text>
        ) : (
          <form id={`${id}-form`} noValidate onSubmit={submit}>
            <Field>
              <FieldLabel htmlFor={id}>Limit in GiB</FieldLabel>
              <Input
                ref={(element) => {
                  focusRef.current = element;
                }}
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                value={value}
                disabled={pending}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
              <FieldDescription>
                In whole GiB, from 1 to 100. It is {capGiB} GiB now.
              </FieldDescription>
            </Field>
          </form>
        )}
        {error === null ? null : <Failure cause={error} size="line" role="alert" />}
      </DialogPanel>
      <DialogFooter>
        <Button
          ref={
            capGiB === null
              ? (element) => {
                  focusRef.current = element;
                }
              : undefined
          }
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form={`${id}-form`}
          disabled={capGiB === null || whole === null || pending}
        >
          {pending ? "Saving…" : "Save limit"}
        </Button>
      </DialogFooter>
    </>
  );
}
