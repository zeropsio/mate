/**
 * The Brief editor (PRD §4.7, §5.6): title and the brief's markdown, with its
 * two optional sections, and the save choice. Before Apply a save only writes
 * the files; once a crew is applied it also applies the brief with the chosen
 * `briefSave`, and every crewmate shows the new version as pending until then.
 */
import type { CrewApplyChoice } from "@t3tools/contracts";
import {
  CREW_BRIEF_FILE,
  CREW_BRIEF_MAX_CHARS,
  CREW_HOME_FILE,
  type CrewDefinition,
  type CrewDefinitionIssue,
} from "@t3tools/shared/crewHome";
import { useState } from "react";

import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import type { UseCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useCrewHome, type CrewHomeRead } from "../../../zerops/crew/useCrewHome";
import { Pill } from "../primitives";
import { CREW_APPLY_COST_LINE, crewRewriteBlockers, withBrief } from "./CrewEditors.logic";
import {
  CrewField,
  CrewIssues,
  CrewSaveButton,
  CrewSheet,
  CrewSheetBody,
  CrewSheetFooter,
  CrewSheetReading,
} from "./CrewSheetParts";

interface BriefSheetProps {
  readonly onOpenChange: (open: boolean) => void;
  readonly commands: UseCrewCommand;
  /** The applied brief's version; `null` before Apply, when a save only writes the files. */
  readonly version: number | null;
  readonly crewmateCount: number;
}

export function CrewBriefSheet({ open, ...props }: BriefSheetProps & { readonly open: boolean }) {
  const { version, crewmateCount } = props;
  return (
    <CrewSheet
      description={
        version === null
          ? undefined
          : `Applies to ${crewmateCount} ${crewmateCount === 1 ? "crewmate" : "crewmates"}.`
      }
      onOpenChange={props.onOpenChange}
      open={open}
      title={version === null ? "Brief" : `Brief · v${version}`}
    >
      <CrewBriefContents {...props} />
    </CrewSheet>
  );
}

function CrewBriefContents(props: BriefSheetProps) {
  const home = useCrewHome(props.commands);
  return home.definition === null ? (
    <CrewSheetReading error={props.commands.error} />
  ) : (
    <CrewBriefForm
      {...props}
      blockers={crewRewriteBlockers(home.issues)}
      definition={home.definition}
      save={home.save}
    />
  );
}

function CrewBriefForm({
  onOpenChange,
  commands,
  version,
  blockers,
  definition,
  save,
}: BriefSheetProps & {
  readonly blockers: ReadonlyArray<CrewDefinitionIssue>;
  readonly definition: CrewDefinition;
  readonly save: CrewHomeRead["save"];
}) {
  const [title, setTitle] = useState(definition.brief.title);
  const [text, setText] = useState(definition.brief.text);
  const [choice, setChoice] = useState<CrewApplyChoice>("nextTurn");
  const tooLong = text.length > CREW_BRIEF_MAX_CHARS;
  const blocked = tooLong || title.trim() === "" || blockers.length > 0 || commands.pending;

  const submit = async (apply: CrewApplyChoice) => {
    if (blocked) return;
    const saved = await save(withBrief(definition, title.trim(), text), [
      CREW_HOME_FILE,
      CREW_BRIEF_FILE,
    ]);
    if (!saved) return;
    if (version !== null && (await commands.send({ _tag: "briefSave", apply })) === null) return;
    onOpenChange(false);
  };

  return (
    <>
      <CrewSheetBody>
        <CrewField label="Title">
          <Input onChange={(event) => setTitle(event.target.value)} value={title} />
        </CrewField>
        <CrewField
          hint={
            tooLong
              ? `At most ${CREW_BRIEF_MAX_CHARS.toLocaleString("en")} characters.`
              : "Markdown. Optional sections: ## Binding decisions and ## Done when."
          }
          label="Brief"
        >
          <Textarea onChange={(event) => setText(event.target.value)} rows={14} value={text} />
        </CrewField>
      </CrewSheetBody>
      <CrewSheetFooter error={commands.error}>
        <CrewIssues issues={blockers} />
        {version === null ? (
          <Pill disabled={blocked} label="Save" onClick={() => void submit("nextTurn")} />
        ) : (
          <>
            <CrewSaveButton
              choice={choice}
              disabled={blocked}
              onChoice={setChoice}
              onSave={(apply) => void submit(apply)}
            />
            <p className="text-xs text-muted-foreground">{CREW_APPLY_COST_LINE}</p>
          </>
        )}
      </CrewSheetFooter>
    </>
  );
}
