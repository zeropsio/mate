/**
 * *Set up a crew* (PRD §4.7, §5.1): pick one of three templates — or describe
 * the crew to Fen, who writes the files — then edit the brief and the
 * crewmates (saved, not yet applied), then **Apply**, which creates each
 * writer's copy of the code and reports per crewmate as it goes.
 */
import { crewDescribeAsk, crewNoDevHostWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { Crewmate } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { renderCrewHome } from "@t3tools/shared/crewHome";
import { crewFromTemplate, type CrewTemplateId } from "@t3tools/shared/crewTemplates";
import { useState } from "react";

import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import type { UseCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useCrewHome } from "../../../zerops/crew/useCrewHome";
import { MateFace, Pill, ProcessSteps } from "../primitives";
import { crewApplyProgress } from "./CrewEditors.logic";
import { CrewIssues, CrewSheet, CrewSheetBody, CrewSheetFooter } from "./CrewSheetParts";

const TEMPLATES: ReadonlyArray<{
  readonly id: CrewTemplateId;
  readonly title: string;
  readonly description: string;
}> = [
  {
    id: "feature-team",
    title: "Feature team",
    description: "Two builders and a reviewer, each builder with its own copy of the code.",
  },
  { id: "solo-reviewer", title: "Solo + reviewer", description: "One builder and a reviewer." },
  { id: "empty", title: "Start empty", description: "A brief, and crewmates you add yourself." },
];

interface SetupProps {
  readonly onOpenChange: (open: boolean) => void;
  readonly commands: UseCrewCommand;
  /** The applied crew's crewmates, for Apply's progress. */
  readonly crewmates: ReadonlyArray<Crewmate>;
  readonly applied: boolean;
  readonly devHosts: ReadonlyArray<string>;
  readonly mateName: string;
  readonly mateTint: MateTintId | undefined;
  /** Hands Fen the description, confirmed first. */
  readonly onDescribe: (ask: string) => void;
  readonly onEditBrief: () => void;
  readonly onEditCrewmate: (handle: string | null) => void;
}

export function CrewSetupSheet({
  open,
  homeVersion,
  ...props
}: SetupProps & {
  readonly open: boolean;
  /** Bumped when the brief or a crewmate editor saved, so the draft reads the files again. */
  readonly homeVersion: number;
}) {
  return (
    <CrewSheet onOpenChange={props.onOpenChange} open={open} title="Set up a crew">
      {props.applied ? (
        <>
          <CrewSheetBody>
            <ProcessSteps density="compact" steps={crewApplyProgress(props.crewmates)} />
          </CrewSheetBody>
          <CrewSheetFooter error={null}>
            <Pill label="Done" onClick={() => props.onOpenChange(false)} />
          </CrewSheetFooter>
        </>
      ) : (
        <CrewSetupDraft key={homeVersion} {...props} />
      )}
    </CrewSheet>
  );
}

function CrewSetupDraft({
  commands,
  devHosts,
  mateName,
  mateTint,
  onDescribe,
  onEditBrief,
  onEditCrewmate,
}: SetupProps) {
  const home = useCrewHome(commands);
  const [description, setDescription] = useState("");
  const definition = home.definition;

  const start = (template: CrewTemplateId) => {
    const next = crewFromTemplate({
      template,
      crew: "crew",
      devHosts,
      withLead: false,
      ...(mateTint === undefined ? {} : { mateTint }),
    });
    void home.save(
      next,
      renderCrewHome(next).map((file) => file.path),
    );
  };

  // Before the Mate mounted a dev service, a writer has nowhere for its copy:
  // Apply waits on the format's `host-missing` issue, and this says why.
  const noDevHost =
    devHosts.length === 0 ? (
      <p className="text-sm text-muted-foreground" data-crew-no-dev-host>
        {crewNoDevHostWord(mateName)}
      </p>
    ) : null;

  if (definition === null) {
    return (
      <>
        <CrewSheetBody>
          {noDevHost}
          <ul className="space-y-2">
            {TEMPLATES.map((template) => (
              <li key={template.id}>
                <button
                  className="w-full cursor-pointer rounded-md border border-border p-3 text-left transition-colors hover:bg-muted"
                  disabled={commands.pending}
                  onClick={() => start(template.id)}
                  type="button"
                >
                  <span className="block text-sm font-medium text-foreground">
                    {template.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {template.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">
              {`Describe it to ${mateName}`}
            </span>
            <Textarea
              aria-label={`Describe the crew to ${mateName}`}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Who should be on it, and what each of them owns."
              rows={4}
              value={description}
            />
            <Pill
              disabled={description.trim() === ""}
              label={`Ask ${mateName}`}
              onClick={() => onDescribe(crewDescribeAsk(description))}
              size="sm"
              tone="outline"
            />
          </div>
        </CrewSheetBody>
        <CrewSheetFooter error={commands.error}>{null}</CrewSheetFooter>
      </>
    );
  }

  return (
    <>
      <CrewSheetBody>
        {noDevHost}
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block text-xs text-muted-foreground">Brief</span>
            <span className="block truncate text-sm text-foreground">{definition.brief.title}</span>
          </span>
          <Button onClick={onEditBrief} size="xs" variant="ghost">
            Edit
          </Button>
        </div>
        <ul className="space-y-1">
          {definition.members.map((member) => (
            <li className="flex items-center gap-3" key={member.handle}>
              {member.tint === undefined ? null : (
                <MateFace size="sm" state="idle" tint={member.tint} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {member.displayName}{" "}
                  <span className="text-xs text-muted-foreground">@{member.handle}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.readOnly ? "Read only" : (member.host ?? "No service yet")}
                </span>
              </span>
              <Button onClick={() => onEditCrewmate(member.handle)} size="xs" variant="ghost">
                Edit
              </Button>
            </li>
          ))}
        </ul>
        <Button onClick={() => onEditCrewmate(null)} size="xs" variant="ghost">
          + Add crewmate
        </Button>
        <CrewIssues issues={home.issues} />
      </CrewSheetBody>
      <CrewSheetFooter error={commands.error}>
        <Pill
          disabled={home.issues.length > 0 || commands.pending}
          label="Apply"
          onClick={() => void commands.send({ _tag: "apply" })}
        />
      </CrewSheetFooter>
    </>
  );
}
