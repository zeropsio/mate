/**
 * A new Mate's ask for its persona where it stands (`matePersonaAsked`): its choices, the one
 * picked, and its state. The main press writes the persona to the Mate's settings, as the Persona
 * page does; the ask reads done once the Mate shows a persona, so what it says is always what the
 * Mate holds. Asked on this screen, it stays to say how it was answered until the screen goes.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { PREMADE_PERSONA_TEMPLATES } from "@t3tools/shared/personaTemplates";
import { useState } from "react";

import type { AskState } from "~/components/ask/ask.logic";
import { matePersonaAsked } from "~/components/zerops/matePersonaAsk.logic";
import { useRightPanelStore } from "~/rightPanelStore";
import {
  useEnvironmentConversationsRead,
  useServerConfigs,
  useThreadShells,
} from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { zeropsMateAt } from "~/zerops/mateIdentities";
import { useZeropsMateDirectory } from "~/zerops/useZeropsMates";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { personaFromTemplate } from "./PersonaPanel.logic";

/** When the Mate asks: while it sets its project up, or before its person's first message. */
export type PersonaAskMoment = "setup" | "start";

/** How long a saved persona may take to show on the Mate before the ask says it has not. */
const SHOWN_WAIT_MS = 10_000;

export interface MatePersonaAskView {
  readonly mateName: string;
  readonly project: string;
  readonly moment: PersonaAskMoment;
  /** The template picked (`PERSONA_CHOICES`), not yet saved. */
  readonly picked: string | null;
  readonly onPick: (key: string) => void;
  readonly state: AskState;
  readonly onChoose: () => void;
  readonly onOpenPersonaPage: () => void;
}

export function useMatePersonaAsk(input: {
  readonly environmentId: EnvironmentId;
  /** The conversation it stands in, a draft's included: where the Persona page opens. */
  readonly threadRef: ScopedThreadRef | null;
  readonly moment: PersonaAskMoment;
  /** The place can hold the ask: the setup's ask is on screen, or the Mate's first draft is. */
  readonly here: boolean;
  /** Its person has written to it where the ask stands. */
  readonly written: boolean;
}): MatePersonaAskView | null {
  const { environmentId, threadRef } = input;
  const found = zeropsMateAt(useZeropsMateDirectory(), environmentId);
  const mate = found?.kind === "mate" ? found.mate : undefined;
  const viewer = useZeropsSessionOptional()?.user?.id;
  const config = useServerConfigs().get(environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const persona = settings === null ? undefined : settings.persona;
  const asked =
    input.here &&
    mate !== undefined &&
    matePersonaAsked({
      takesPersona:
        config === undefined ? null : config.environment.capabilities.matePersona === true,
      persona,
      madeBy: mate.madeBy ?? mate.standUp?.by,
      viewer,
      written: input.written,
    });
  const [seen, setSeen] = useState(false);
  if (asked && !seen) setSeen(true);
  const [picked, setPicked] = useState<string | null>(null);
  // The press's own state while it saves, or how it failed; done is the Mate's persona.
  const [pressed, setPressed] = useState<AskState | null>(null);

  if (
    mate === undefined ||
    threadRef === null ||
    !input.here ||
    !(asked || (seen && persona != null))
  )
    return null;
  const mateName = mate.name;
  const state: AskState =
    persona != null
      ? { kind: "done", words: `${mateName} works as ${persona.name}`, told: null }
      : (pressed ?? { kind: "waiting" });
  const failed = (words: string) => setPressed({ kind: "failed", words });
  const onChoose = () => {
    const template = PREMADE_PERSONA_TEMPLATES.find((candidate) => candidate.id === picked);
    if (template === undefined) return;
    setPressed({ kind: "working", words: "Saving…", pressed: "main" });
    void updateSettings({
      environmentId,
      input: { patch: { persona: personaFromTemplate("premade", template) } },
    }).then((result) => {
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return setPressed(null);
        const failure = squashAtomCommandFailure(result);
        return failed(
          `Couldn't save it: ${failure instanceof Error ? failure.message : `${mateName} did not take it.`}`,
        );
      }
      // Saved: done once the Mate shows it, which outranks this.
      window.setTimeout(
        () =>
          setPressed((current) =>
            current?.kind === "working"
              ? { kind: "failed", words: `${mateName} has not shown it yet.` }
              : current,
          ),
        SHOWN_WAIT_MS,
      );
    });
  };
  return {
    mateName,
    project: mate.project ?? "this project",
    moment: input.moment,
    picked,
    onPick: setPicked,
    state,
    onChoose,
    onOpenPersonaPage: () => useRightPanelStore.getState().open(threadRef, "persona"),
  };
}

/** The Mate is read to hold no conversation yet: a draft on screen is its first. */
export function useMateHoldsNoConversation(environmentId: EnvironmentId): boolean {
  const read = useEnvironmentConversationsRead(environmentId);
  const threads = useThreadShells();
  return read && !threads.some((thread) => thread.environmentId === environmentId);
}
