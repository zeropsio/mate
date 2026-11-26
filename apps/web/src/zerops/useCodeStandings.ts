import {
  hqKeptGitQuestions,
  hqOperationOf,
  operationFailureWords,
  type KeptGitQuestionView,
} from "@t3tools/client-runtime/data";
import {
  codeStanding,
  codeStandingOffers,
  type CodeStanding,
  type CodeStandingOffers,
} from "@t3tools/client-runtime/zerops";
import { Atom } from "effect/reactivity";
import { useCallback } from "react";
import { useAccountOrgId, useProjection } from "./accountData";
import { useAddMateDoor } from "./addMateDoor";
import { useHqStructure, useOrgOffers } from "./useHqOffers";

const NO_QUESTIONS = Atom.make<ReadonlyArray<KeptGitQuestionView>>([]);

export interface CodeStandingView {
  readonly standing: CodeStanding;
  readonly offers: CodeStandingOffers;
  readonly addMateWhy?: string | undefined;
  readonly stopped?: string | undefined;
}

/** One wiring of HQ's facts and existing doors to the code-standing decision. */
export function useCodeStandings(): (appId: string) => CodeStandingView {
  const structure = useHqStructure();
  const orgId = useAccountOrgId();
  const questions = useProjection(hqKeptGitQuestions, orgId, NO_QUESTIONS);
  const orgOffers = useOrgOffers();
  const addMateDoor = useAddMateDoor();
  return useCallback(
    (appId) => {
      const app = structure?.apps.find(({ id }) => id === appId);
      const deletion = hqOperationOf(app?.operation, "app_deletion");
      const births = app?.births?.length ?? 0;
      const standing =
        app === undefined
          ? { kind: "unread" as const }
          : codeStanding({
              placed:
                app.projects.length +
                births +
                (app.environments?.length ?? 0) +
                (app.hiddenEnvironments?.length ?? 0),
              mates:
                app.projects.filter(({ kind }) => kind === "mate" || kind === "devstage").length +
                births,
              contents: app.contents,
              asked: questions.some(({ question }) => question.appId === appId),
              deletion: deletion.kind,
            });
      const door = addMateDoor(appId);
      const offers = codeStandingOffers(standing, {
        deleteApp: orgOffers("delete_app").kind,
        addMate: door.kind === "unknown" ? "none" : door.kind,
      });
      return {
        standing,
        offers,
        ...(door.kind === "off" ? { addMateWhy: door.why } : {}),
        ...(deletion.kind === "failed" ? { stopped: operationFailureWords(deletion.failure) } : {}),
      };
    },
    [structure, questions, orgOffers, addMateDoor],
  );
}
