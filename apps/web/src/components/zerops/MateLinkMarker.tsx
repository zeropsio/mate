import { InlineButton } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Text } from "~/components/ui/text";

/**
 * A Mate whose link is being made again, beside its name in the conversation's header: a small
 * spinner and one word, in the seat its status takes, so nothing in the conversation moves when it
 * comes or goes. `onTryNow` is there once the link is slow: asking again is the person's to press.
 */
export function MateLinkMarker({
  words,
  cause,
  onTryNow,
}: {
  /** The link's one line in the Mate's name ("Reconnecting to Juno…"), read out and on hover. */
  readonly words: string;
  /** The raw cause, where the link said one: on hover only. */
  readonly cause?: string | undefined;
  readonly onTryNow?: (() => void) | undefined;
}) {
  return (
    <Text className="inline-flex min-w-0 items-center gap-1.5" variant="label">
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label={words}
              className="inline-flex min-w-0 items-center gap-1.5"
              data-mate-link="reconnecting"
              role="status"
            />
          }
        >
          <Spinner size="xs" />
          {/* On a phone's header the words would draw over the Mate's name: the spinner stays. */}
          <span className="truncate @max-md/header-actions:hidden">Reconnecting…</span>
        </TooltipTrigger>
        <TooltipPopup>{cause === undefined ? words : `${words} ${cause}`}</TooltipPopup>
      </Tooltip>
      {onTryNow === undefined ? null : (
        <InlineButton data-mate-link-try="" onClick={onTryNow}>
          Try now
        </InlineButton>
      )}
    </Text>
  );
}
