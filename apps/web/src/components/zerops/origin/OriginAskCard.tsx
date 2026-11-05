/**
 * The Mate asks where the code of the repository it started from is kept, on the ask card: the
 * question, the agent's why, and the two ways as its choices — on GitHub, the sheet that mounts it
 * through the organization's GitHub app, or in Mate, GitHub only followed. Both are answers, so
 * there is no Not now. A repository outside GitHub is only kept in Mate. Closing the sheet before
 * HQ mounts it leaves the ask open. Answered, its line says where the code is kept, who picked and
 * when. Props only: the container reads the engine's record and HQ, and tells the engine the pick.
 */
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import type { AskState } from "../../ask/ask.logic";
import { AskCard, AskFooter } from "../../ask/AskCard";
import { Button } from "../../ui/button";
import { Dialog, DialogPopup } from "../../ui/dialog";
import { githubName } from "../gitMirror.logic";
import { OriginGithubSheet, type OriginGithubProps } from "./OriginGithubSheet";
import { type OriginAskSaid, originAddress, originAskQuestion } from "./originAsk.logic";
import type { OriginAskActivityPayload } from "@t3tools/client-runtime/data";

export interface OriginAskCardProps {
  readonly ask: Pick<OriginAskActivityPayload, "url" | "repo" | "reason">;
  /** The card's state, from the engine's record and HQ (`originAskState`). */
  readonly state: AskState;
  readonly mateName: string;
  /**
   * Keeping the code on GitHub, as HQ answers it for the Mate's application; `undefined` while
   * HQ has not placed the Mate, and the GitHub way waits.
   */
  readonly github: OriginGithubProps | undefined;
  /** Tells the engine the pick; `null` once it took it, else why not. */
  readonly onAnswer: (outcome: OriginAskSaid) => Promise<string | null>;
}

export function OriginAskCard({ ask, state, mateName, github, onAnswer }: OriginAskCardProps) {
  const [sheet, setSheet] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const answer = async (outcome: OriginAskSaid) => {
    setRefusal(null);
    setRefusal(await onAnswer(outcome));
  };
  const repository = githubName(ask.url);
  const address = originAddress(ask.url);
  const waiting = state.kind === "waiting";
  const inMate = { label: "Keep the code in Mate", onPress: () => void answer("declined") };

  // The sheet outlives the card's answer: HQ's mount answers on GitHub, and the sheet goes on to
  // say what GitHub still lets through, so it stands at one place whatever the card draws.
  return (
    <>
      <div data-origin-request={ask.url} data-origin-request-face={state.kind}>
        <AskCard
          askId={ask.url}
          density="full"
          footer={
            <AskFooter
              also={
                repository === null ? undefined : (
                  <Button onClick={inMate.onPress} variant="secondary">
                    {inMate.label}
                  </Button>
                )
              }
              density="full"
              main={
                repository === null
                  ? inMate
                  : {
                      label: "Keep the code on GitHub",
                      onPress: () => setSheet(true),
                      disabled: github === undefined,
                    }
              }
              state={state}
            />
          }
          kind="origin"
          state={state.kind}
          title={originAskQuestion(ask.url)}
          where={{ scope: "mate", detail: null }}
          why={ask.reason === null ? null : { who: mateName, words: ask.reason }}
        >
          {waiting ? (
            <p className="text-body text-muted-foreground">
              {repository === null
                ? `${address} isn't on GitHub, so ${mateName} keeps the code in Mate and only reads from it.`
                : `On GitHub, ${mateName} pushes its branches there and its changes open there for review. In Mate, it keeps the code here and only reads from GitHub.`}
            </p>
          ) : null}
          {refusal === null ? null : <Refusal words={refusal} />}
        </AskCard>
      </div>
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
