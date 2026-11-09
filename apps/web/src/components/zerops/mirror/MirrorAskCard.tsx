/**
 * The Mate asks the person to connect one of the project's code repositories to GitHub, on the ask
 * card: the verb and the repository, the agent's why, and — while it waits — the picker that
 * connects it, with Not now beside it. Done once HQ shows the repository's remote, however it got
 * there, with a way to open it. Compact, above the composer, it names the ask and takes the person
 * to the card, where the picker is. Props only: the container reads the engine's record and HQ,
 * and tells the engine how it ended.
 */
import type { ReactNode } from "react";

import { type AskState, NOT_NOW } from "../../ask/ask.logic";
import { AskCard, type AskDensity, AskFooter } from "../../ask/AskCard";
import { Button } from "../../ui/button";
import { mirrorAskTitle } from "./mirrorAsk.logic";

export interface MirrorAskCardProps {
  /** The ask's request: what "Show in conversation" lands on. */
  readonly askId: string;
  readonly repo: string;
  readonly reason: string | null;
  /** The card's state, from the engine's record and HQ (`mirrorAskState`). */
  readonly state: AskState;
  readonly mateName: string;
  readonly density: AskDensity;
  /** Full, while it waits: the picker that connects the repository. */
  readonly picker?: ReactNode;
  /** Done: the remote's address, opened from the card. */
  readonly remoteUrl: string | null;
  readonly onNotNow: () => void;
  /** Failed: tells the engine again. */
  readonly onRetry: () => void;
  /** Compact: the asking Mate's face. */
  readonly face?: ReactNode;
  /** Compact: goes to the card in the conversation, where the picker is. */
  readonly onShowInConversation?: (() => void) | undefined;
}

export function MirrorAskCard(props: MirrorAskCardProps) {
  const { state, density } = props;
  const size = density === "compact" ? "sm" : "md";
  const action =
    state.kind === "failed" ? (
      <Button onClick={props.onRetry} size={size} variant="secondary">
        Try again
      </Button>
    ) : state.kind === "othersToAnswer" ? (
      <Button onClick={props.onNotNow} size={size} variant="ghost">
        {NOT_NOW}
      </Button>
    ) : state.kind === "done" && props.remoteUrl !== null ? (
      <Button
        render={<a href={props.remoteUrl} rel="noreferrer" target="_blank" />}
        size={size}
        variant="ghost"
      >
        Open on GitHub
      </Button>
    ) : undefined;
  return (
    <div data-mirror-request={props.repo} data-mirror-request-face={state.kind}>
      <AskCard
        askId={props.askId}
        density={density}
        face={props.face}
        footer={
          <AskFooter
            action={action}
            density={density}
            main={
              density === "compact" && props.onShowInConversation !== undefined
                ? { label: "Connect…", onPress: props.onShowInConversation }
                : null
            }
            onNotNow={props.onNotNow}
            state={state}
          />
        }
        kind="mirror"
        state={state.kind}
        title={mirrorAskTitle(props.repo)}
        where={{ scope: "project", detail: props.repo }}
        why={props.reason === null ? null : { who: props.mateName, words: props.reason }}
      >
        {density === "full" && state.kind === "waiting" ? props.picker : null}
      </AskCard>
    </div>
  );
}
