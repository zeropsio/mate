/**
 * The crew's goal (the brief), as a view of the Crew tab: its title, what
 * it's for, the rules every crewmate follows and when it is done — the last
 * two optional (`CrewGoal.logic.ts` maps them onto the brief's markdown).
 * One Save: each crewmate picks the goal up with its next message, in a
 * fresh conversation (`briefSave` `nextTurn`); before the crew stands, a
 * save only writes its files.
 */
import { CREW_GOAL_WORDS, CREW_VIEW_WORDS } from "@t3tools/client-runtime/zerops/crew/phrases";
import {
  CREW_BRIEF_FILE,
  CREW_BRIEF_MAX_CHARS,
  CREW_HOME_FILE,
  type CrewDefinition,
  type CrewDefinitionIssue,
} from "@t3tools/shared/crewHome";
import { useState } from "react";

import { withBrief } from "../../../zerops/crew/crewHome";
import type { UseCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useCrewHome, type CrewHomeRead } from "../../../zerops/crew/useCrewHome";
import { crewRewriteBlockers } from "./CrewEditors.logic";
import { crewGoalFields, crewGoalMarkdown, type CrewGoalFields } from "./CrewGoal.logic";
import { CrewPress } from "./CrewParts";
import {
  CrewIssues,
  CrewTextArea,
  CrewView,
  CrewViewField,
  CrewViewFoot,
  CrewViewReading,
} from "./CrewView";

export function CrewGoal({
  commands,
  applied,
  onClose,
}: {
  readonly commands: UseCrewCommand;
  /** The crew stands: a save reaches its crewmates too. */
  readonly applied: boolean;
  readonly onClose: () => void;
}) {
  const home = useCrewHome(commands);
  return (
    <CrewView onBack={onClose}>
      <GoalHeading />
      {home.definition === null ? (
        <CrewViewReading error={commands.error} />
      ) : (
        <GoalForm
          applied={applied}
          blockers={crewRewriteBlockers(home.issues)}
          commands={commands}
          definition={home.definition}
          onClose={onClose}
          save={home.save}
        />
      )}
    </CrewView>
  );
}

function GoalHeading() {
  return (
    <>
      <h2 className="mt-2.5 font-semibold text-base leading-6">{CREW_GOAL_WORDS.title}</h2>
      <p className="mt-0.5 text-line leading-4.5 text-muted-foreground">{CREW_GOAL_WORDS.line}</p>
    </>
  );
}

function GoalForm({
  commands,
  applied,
  definition,
  blockers,
  save,
  onClose,
}: {
  readonly commands: UseCrewCommand;
  readonly applied: boolean;
  readonly definition: CrewDefinition;
  readonly blockers: ReadonlyArray<CrewDefinitionIssue>;
  readonly save: CrewHomeRead["save"];
  readonly onClose: () => void;
}) {
  const [fields, setFields] = useState<CrewGoalFields>(() => crewGoalFields(definition.brief));
  const set = (key: keyof CrewGoalFields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const markdown = crewGoalMarkdown(fields);
  const tooLong = markdown.text.length > CREW_BRIEF_MAX_CHARS;
  const blocked = tooLong || fields.title.trim() === "" || blockers.length > 0 || commands.pending;

  const submit = async () => {
    if (blocked) return;
    const saved = await save(withBrief(definition, markdown.title, markdown.text), [
      CREW_HOME_FILE,
      CREW_BRIEF_FILE,
    ]);
    if (!saved) return;
    if (applied && (await commands.send({ _tag: "briefSave", apply: "nextTurn" })) === null) return;
    onClose();
  };

  return (
    <>
      <CrewViewField gap={22} label={CREW_GOAL_WORDS.titleField}>
        <input
          className="crew-field"
          data-line=""
          onChange={(event) => set("title", event.target.value)}
          value={fields.title}
        />
      </CrewViewField>
      <CrewViewField label={CREW_GOAL_WORDS.body}>
        <CrewTextArea
          aria-label={CREW_GOAL_WORDS.body}
          lines={6}
          onChange={(event) => set("body", event.target.value)}
          value={fields.body}
        />
      </CrewViewField>
      <CrewViewField label={CREW_GOAL_WORDS.rules} optional>
        <CrewTextArea
          aria-label={CREW_GOAL_WORDS.rules}
          onChange={(event) => set("rules", event.target.value)}
          value={fields.rules}
        />
      </CrewViewField>
      <CrewViewField label={CREW_GOAL_WORDS.doneWhen} optional>
        <CrewTextArea
          aria-label={CREW_GOAL_WORDS.doneWhen}
          onChange={(event) => set("doneWhen", event.target.value)}
          value={fields.doneWhen}
        />
      </CrewViewField>
      <CrewViewFoot>
        <CrewIssues issues={blockers} />
        {commands.error === null ? null : (
          <p className="text-line leading-4.5 text-status-failed-text" role="alert">
            {commands.error}
          </p>
        )}
        <span className="text-line leading-4.5 text-muted-foreground">
          {tooLong
            ? `At most ${CREW_BRIEF_MAX_CHARS.toLocaleString("en")} characters.`
            : CREW_GOAL_WORDS.saveLine}
        </span>
        <span className="flex items-center gap-1.5">
          <CrewPress
            disabled={blocked}
            label={CREW_VIEW_WORDS.save}
            onPress={() => void submit()}
            size="view"
          />
          <CrewPress label={CREW_VIEW_WORDS.cancel} onPress={onClose} size="view" tone="muted" />
        </span>
      </CrewViewFoot>
    </>
  );
}
