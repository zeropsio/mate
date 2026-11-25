import { Failure } from "../ui/failure";
import { Loading } from "../ui/loading";

/**
 * A creation form's one line under its press: what the press waits on (`Loading` words), or why
 * it refused (`Failure` line); nothing otherwise. The live region stays mounted and only its
 * content changes, so a screen reader hears each change once. Fields name it with
 * `aria-describedby` by its `id`.
 */
export function PressLine({
  id,
  waiting,
  refusal,
  className,
}: {
  readonly id: string;
  /** What the press waits on, as the form says it ("Checking which names are taken…"). */
  readonly waiting?: string | undefined;
  /** Why the press refused; said instead of what it waits on. */
  readonly refusal?: string | undefined;
  /** Layout only: where the line stands, and whether it gives its room back while it says nothing. */
  readonly className?: string | undefined;
}) {
  return (
    <div aria-live="polite" className={className} id={id}>
      {refusal !== undefined ? (
        <Failure cause={refusal} size="line" />
      ) : waiting !== undefined ? (
        // Loading adds its own ellipsis to what it waits on.
        <Loading label={waiting.replace(/…$/u, "")} shape="words" />
      ) : null}
    </div>
  );
}
