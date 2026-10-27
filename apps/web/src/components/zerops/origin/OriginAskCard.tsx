/**
 * The Mate asks where the code of the repository it started from is kept: the question, the
 * agent's why, and the two ways — on GitHub, the sheet that mounts it through the organization's
 * GitHub app, or in Mate, GitHub only followed. A repository outside GitHub is only kept in Mate.
 * Closing the sheet before HQ mounts it leaves the ask open on the card. Answered, it folds to one
 * line. Props only: the container reads the engine's record and HQ, and tells the engine the pick.
 */
import type { OriginAskActivityPayload } from "@t3tools/client-runtime/data";
import { CircleAlertIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Dialog, DialogPopup } from "../../ui/dialog";
import { githubName } from "../gitMirror.logic";
import { OriginGithubSheet, type OriginGithubProps } from "./OriginGithubSheet";
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
   * Keeping the code on GitHub, as HQ answers it for the Mate's application; `undefined` while
   * HQ has not placed the Mate, and the GitHub way waits.
   */
  readonly github: OriginGithubProps | undefined;
  /** Tells the engine the pick; `null` once it took it, else why not. */
  readonly onAnswer: (outcome: OriginAskSaid) => Promise<string | null>;
}

export function OriginAskCard({ ask, face, mateName, github, onAnswer }: OriginAskCardProps) {
  const [sheet, setSheet] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const answer = async (outcome: OriginAskSaid) => {
    setRefusal(null);
    setRefusal(await onAnswer(outcome));
  };
  const repository = githubName(ask.url);
  const address = originAddress(ask.url);

  // The sheet outlives the card's fold: HQ's mount answers on GitHub, and the sheet goes on to say
  // what GitHub still lets through, so it stands at one place whatever the card draws.
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
                  {repository === null
                    ? `${address} isn't on GitHub, so ${mateName} keeps the code in Mate and only reads from it.`
                    : `On GitHub, ${mateName} pushes its branches there and its changes open there for review. In Mate, it keeps the code here and only reads from GitHub.`}
                </p>
              </div>
              {refusal === null ? null : <Refusal words={refusal} />}
              <div className="flex items-center gap-2">
                {repository === null ? null : (
                  <Button disabled={github === undefined} onClick={() => setSheet(true)} size="sm">
                    Keep the code on GitHub
                  </Button>
                )}
                <Button
                  onClick={() => void answer("declined")}
                  size="sm"
                  variant={repository === null ? "primary" : "secondary"}
                >
                  Keep the code in Mate
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
              <span className="text-foreground">{address}</span> ·{" "}
              {face === "connected" ? "Kept on GitHub" : "Kept in Mate"}
            </span>
          </div>
          {refusal === null ? null : <Refusal words={refusal} />}
        </Card>
      )}
      {github === undefined ? null : (
        <Dialog onOpenChange={setSheet} open={sheet}>
          <DialogPopup className="max-w-lg" data-origin-github-sheet="">
            <OriginGithubSheet
              {...github}
              ask={ask}
              mateName={mateName}
              onClose={() => setSheet(false)}
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
