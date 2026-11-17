import { Button } from "~/components/ui/button";
import { Failure } from "~/components/ui/failure";

/** What the page says when the account's data cannot start: why, with Try again and Sign out. */
export function ZeropsDataStartupFailure({
  message,
  retry,
  signOut,
}: {
  readonly message: string;
  readonly retry: () => void;
  readonly signOut: () => void;
}) {
  return (
    <Failure
      action={
        <>
          <Button onClick={retry}>Try again</Button>
          <Button onClick={signOut} variant="ghost">
            Sign out
          </Button>
        </>
      }
      cause="Couldn't read your Zerops account."
      details={message}
      size="page"
    />
  );
}
