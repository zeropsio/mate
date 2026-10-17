/**
 * The Mate asks whether finished work goes back to the repository it started from: the question,
 * the agent's why, and Connect — the Git sheet, prefilled — or Not now. Closing the sheet before
 * production is added leaves the ask open on the card. Answered, it folds to one line. Props only:
 * the container reads the engine's record and HQ, and tells the engine the outcome.
 */
import type { OriginAskActivityPayload } from "@t3tools/client-runtime/data";
import { CircleAlertIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Dialog, DialogPopup } from "../../ui/dialog";
import type { GitEnvironmentFormInputs } from "~/zerops/useGitEnvironmentFormInputs";
import { OriginGitSheet } from "./OriginGitSheet";
import {
  type OriginAskFace,
  type OriginAskSaid,
  originAddress,
  originAskQuestion,
} from "./originAsk.logic";

export interface OriginAskCardProps {
  readonly ask: Pick<OriginAskActivityPayload, "url" | "repo" | "reason">;
  readonly face: OriginAskFace;
  readonly mateName: string;
  /**
   * The application the Mate is in, where the sheet adds the environments; `undefined` while HQ
   * has not placed it, and Connect waits.
   */
  readonly application:
    | { readonly name: string; readonly git: GitEnvironmentFormInputs }
    | undefined;
  /** Tells the engine how the ask ended; `null` once it took it, else why not. */
  readonly onAnswer: (outcome: OriginAskSaid) => Promise<string | null>;
}

export function OriginAskCard({ ask, face, mateName, application, onAnswer }: OriginAskCardProps) {
  const [sheet, setSheet] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const answer = async (outcome: OriginAskSaid) => {
    setRefusal(null);
    setRefusal(await onAnswer(outcome));
  };

  // The sheet outlives the card's fold: production added answers connected, and stage follows
  // in the same sheet, so it stands at one place whatever the card draws.
  return (
    <>
      {face === "closed" ? null : face === "open" ? (
        <Card
          data-origin-request={ask.url}
          data-origin-request-face={face}
          size="sm"
          variant="flat"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <GitBranchIcon
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
            <div className="grid min-w-0 flex-1 gap-2.5">
              <div className="grid min-w-0 gap-0.5">
                <p className="text-sm text-foreground">{originAskQuestion(ask.url)}</p>
                {ask.reason === null ? null : (
                  <p
                    className="text-xs leading-4.5 text-muted-foreground"
                    data-origin-request-reason
                  >
                    {mateName}: <q className="italic">{ask.reason}</q>
                  </p>
                )}
                <p className="text-xs leading-4.5 text-muted-foreground">
                  You connect it in HQ with your own token. {mateName} never sees it.
                </p>
              </div>
              {refusal === null ? null : <Refusal words={refusal} />}
              <div className="flex items-center gap-2">
                <Button
                  disabled={application === undefined}
                  onClick={() => setSheet(true)}
                  size="sm"
                >
                  Connect
                </Button>
                <Button onClick={() => void answer("declined")} size="sm" variant="ghost">
                  Not now
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card
          data-origin-request={ask.url}
          data-origin-request-face={face}
          size="sm"
          variant="flat"
        >
          <div className="flex items-start gap-2 text-xs">
            <GitBranchIcon
              aria-hidden="true"
              className="mt-px size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate text-muted-foreground">
              <span className="text-foreground">{originAddress(ask.url)}</span> ·{" "}
              {face === "connected" ? "Connected" : "Not delivering back"}
            </span>
          </div>
          {refusal === null ? null : <Refusal words={refusal} />}
        </Card>
      )}
      {application === undefined ? null : (
        <Dialog onOpenChange={setSheet} open={sheet}>
          <DialogPopup className="max-w-lg">
            <OriginGitSheet
              git={application.git}
              groupName={application.name}
              onClose={() => setSheet(false)}
              onConnected={() => void answer("connected")}
              repo={ask.repo}
              url={ask.url}
            />
          </DialogPopup>
        </Dialog>
      )}
    </>
  );
}

function Refusal({ words }: { readonly words: string }) {
  return (
    <p
      className="flex items-center gap-1.5 text-xs leading-4 text-destructive-foreground"
      role="alert"
    >
      <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {words}
    </p>
  );
}
