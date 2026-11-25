import { CheckIcon, CopyIcon } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

import { DETAILS_TEXT_CLASS, MateStateDetails } from "./MateStateDetails";

/**
 * Zerops' whole answer to a refused step behind the stage's Details, for people to read or hand to
 * support: the text as given, and one Copy that copies exactly it.
 */
export function ZeropsAnswerDetails({
  text,
  align,
}: {
  readonly text: string;
  /** Where its disclosure stands on its line (`MateStateDetails`). */
  readonly align?: "center" | "start";
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "Zerops' answer" });
  return (
    <MateStateDetails {...(align === undefined ? {} : { align })}>
      <div className="flex items-start gap-2">
        <pre className={cn(DETAILS_TEXT_CLASS, "min-w-0 flex-1")}>{text}</pre>
        <Button onClick={() => copyToClipboard(text)} size="sm" variant="secondary">
          {isCopied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          Copy
        </Button>
      </div>
    </MateStateDetails>
  );
}
