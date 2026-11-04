/**
 * Settings › Zerops › Persona templates: the organization's own starting points for a Mate's
 * persona, from HQ. Every member reads them; an Owner or Admin adds, edits and deletes them. A
 * Mate copies a template's text, so changing one here changes no Mate.
 */
import {
  MATE_PERSONA_DESCRIPTION_MAX_LENGTH,
  MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH,
  MATE_PERSONA_NAME_MAX_LENGTH,
} from "@t3tools/contracts";
import type { PersonaTemplateWrite } from "@t3tools/client-runtime/data";
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { useState } from "react";

import {
  useOrgPersonaTemplates,
  usePersonaTemplateWriter,
  type OrgPersonaTemplatesView,
  type PersonaTemplateDraft,
} from "~/zerops/usePersonaTemplates";

import { Button } from "../ui/button";
import { Failure } from "../ui/failure";
import { Field, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Loading } from "../ui/loading";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function PersonaTemplatesSettings() {
  const read = useOrgPersonaTemplates();
  const writer = usePersonaTemplateWriter();
  return (
    <PersonaTemplatesView
      read={read}
      write={writer.write}
      onSave={writer.save}
      onDelete={writer.remove}
      onReset={writer.reset}
    />
  );
}

const count = (value: number) => value.toLocaleString("en-US");

/** A draft HQ would take: lengths as HQ counts them, after trimming. */
function draftProblem(draft: PersonaTemplateDraft): string | null {
  const name = draft.name.trim().length;
  const instructions = draft.instructions.trim().length;
  if (name === 0) return "Give the template a name.";
  if (instructions === 0) return "Write the instructions a Mate's coding agents follow.";
  if (instructions > MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH)
    return `Instructions have at most ${count(MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH)} characters.`;
  return null;
}

const draftOf = (template: PersonaTemplate): PersonaTemplateDraft => ({
  templateId: template.id,
  revision: template.revision,
  name: template.name,
  description: template.description,
  instructions: template.instructions,
});

const NEW_DRAFT: PersonaTemplateDraft = {
  revision: 0,
  name: "",
  description: "",
  instructions: "",
};

export function PersonaTemplatesView({
  read,
  write,
  onSave,
  onDelete,
  onReset,
}: {
  readonly read: OrgPersonaTemplatesView;
  readonly write: PersonaTemplateWrite;
  readonly onSave: (draft: PersonaTemplateDraft) => void;
  readonly onDelete: (template: PersonaTemplate) => void;
  readonly onReset: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<PersonaTemplateDraft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // A write HQ finished and the list shows closes what asked for it.
  const finished = write.stage === "done";
  const editor = finished ? null : editing;
  const confirming = finished ? null : deleting;
  const start = (draft: PersonaTemplateDraft | null, confirm: string | null = null) => {
    onReset();
    setEditing(draft);
    setDeleting(confirm);
  };
  const mayWrite = read.mayWrite && read.state === "ready";

  return (
    <SettingsSection
      {...searchableSetting("zerops-persona-templates")}
      title="Persona templates"
      headerAction={
        mayWrite && editor === null ? (
          <Button size="sm" variant="secondary" onClick={() => start(NEW_DRAFT)}>
            Add template
          </Button>
        ) : null
      }
    >
      <p className="px-3 text-xs text-muted-foreground">
        Starting points for each Mate&rsquo;s persona. A Mate keeps its own copy, so changing a
        template here changes no Mate.
        {read.mayWrite ? null : " Owners and Admins edit these."}
      </p>
      {editor !== null && editor.templateId === undefined ? (
        <TemplateEditor
          draft={editor}
          write={write}
          onChange={setEditing}
          onSave={onSave}
          onCancel={() => start(null)}
          onTakeTheirs={(theirs) => start(draftOf(theirs))}
        />
      ) : null}
      {read.state === "loading" ? (
        <div className="px-3">
          <Loading count={2} label="The organization's persona templates" shape="rows" />
        </div>
      ) : read.state === "unavailable" ? (
        <p className="px-3 text-sm text-muted-foreground">
          {read.orgName ?? "This organization"}&rsquo;s HQ doesn&rsquo;t offer persona templates
          yet.
        </p>
      ) : read.state === "failed" ? (
        <div className="px-3">
          <Failure
            cause="HQ could not read the persona templates."
            details={read.failure}
            action={
              <Button size="sm" variant="secondary" onClick={read.retry}>
                Read again
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {read.failure === null ? null : (
            <div className="px-3">
              <Failure
                cause="This list may be out of date: HQ is not answering."
                details={read.failure}
                action={
                  <Button size="sm" variant="secondary" onClick={read.retry}>
                    Read again
                  </Button>
                }
              />
            </div>
          )}
          {read.templates.length === 0 && editor === null ? (
            <p className="px-3 text-sm text-muted-foreground">No templates yet.</p>
          ) : null}
          {read.templates.map((template) =>
            editor?.templateId === template.id ? (
              <TemplateEditor
                key={template.id}
                draft={editor}
                write={write}
                onChange={setEditing}
                onSave={onSave}
                onCancel={() => start(null)}
                onTakeTheirs={(theirs) => start(draftOf(theirs))}
                onSaveAsNew={() =>
                  start({
                    revision: 0,
                    name: editor.name,
                    description: editor.description,
                    instructions: editor.instructions,
                  })
                }
              />
            ) : (
              <SettingsRow
                key={template.id}
                title={template.name}
                description={template.description === "" ? undefined : template.description}
                control={
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open === template.id}
                    onClick={() => setOpen(open === template.id ? null : template.id)}
                  >
                    {open === template.id ? "Hide instructions" : "Show instructions"}
                  </Button>
                }
              >
                {open === template.id ? (
                  <div className="flex flex-col gap-2 px-3 pb-2">
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {template.instructions}
                    </p>
                    {!mayWrite ? null : confirming === template.id ? (
                      <TemplateDeletion
                        template={template}
                        write={write}
                        onDelete={onDelete}
                        onKeep={() => start(null)}
                      />
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => start(draftOf(template))}
                        >
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => start(null, template.id)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </SettingsRow>
            ),
          )}
        </>
      )}
    </SettingsSection>
  );
}

function TemplateDeletion({
  template,
  write,
  onDelete,
  onKeep,
}: {
  readonly template: PersonaTemplate;
  readonly write: PersonaTemplateWrite;
  readonly onDelete: (template: PersonaTemplate) => void;
  readonly onKeep: () => void;
}) {
  const pending = write.stage === "pending";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Delete {template.name}? Mates that started from it keep their own copy.
      </p>
      <WriteProblem write={write} />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => onDelete(template)}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onKeep}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/** A refused, conflicting or unconfirmed write, said beside the form that sent it. */
function WriteProblem({
  write,
  onTakeTheirs,
  onSaveAsNew,
}: {
  readonly write: PersonaTemplateWrite;
  readonly onTakeTheirs?: (theirs: PersonaTemplate) => void;
  readonly onSaveAsNew?: () => void;
}) {
  if (write.stage === "failed" || write.stage === "unconfirmed")
    return <Failure cause={write.reason} />;
  if (write.stage !== "conflict") return null;
  const { current } = write;
  if (current === null)
    return (
      <Failure
        cause="Someone else deleted this template meanwhile."
        action={
          onSaveAsNew === undefined ? undefined : (
            <Button size="sm" variant="secondary" onClick={onSaveAsNew}>
              Keep it as a new template
            </Button>
          )
        }
      />
    );
  return (
    <Failure
      cause="Someone else changed this template meanwhile."
      action={
        current === undefined || onTakeTheirs === undefined ? undefined : (
          <Button size="sm" variant="secondary" onClick={() => onTakeTheirs(current)}>
            Use their version
          </Button>
        )
      }
    >
      {current === undefined ? "Reading their version…" : null}
    </Failure>
  );
}

function TemplateEditor({
  draft,
  write,
  onChange,
  onSave,
  onCancel,
  onTakeTheirs,
  onSaveAsNew,
}: {
  readonly draft: PersonaTemplateDraft;
  readonly write: PersonaTemplateWrite;
  readonly onChange: (draft: PersonaTemplateDraft) => void;
  readonly onSave: (draft: PersonaTemplateDraft) => void;
  readonly onCancel: () => void;
  readonly onTakeTheirs: (theirs: PersonaTemplate) => void;
  readonly onSaveAsNew?: () => void;
}) {
  const pending = write.stage === "pending";
  const problem = draftProblem(draft);
  const over = draft.instructions.trim().length > MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH;
  return (
    <form
      className="flex flex-col gap-3 px-3 py-2"
      aria-label={draft.templateId === undefined ? "New persona template" : `Edit ${draft.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !pending) onSave(draft);
      }}
    >
      <Field className="w-full">
        <FieldLabel>Name</FieldLabel>
        <Input
          size="sm"
          value={draft.name}
          maxLength={MATE_PERSONA_NAME_MAX_LENGTH}
          disabled={pending}
          onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
        />
      </Field>
      <Field className="w-full">
        <FieldLabel>Description</FieldLabel>
        <Input
          size="sm"
          value={draft.description}
          maxLength={MATE_PERSONA_DESCRIPTION_MAX_LENGTH}
          disabled={pending}
          placeholder="One line on how a Mate with it works"
          onChange={(event) => onChange({ ...draft, description: event.currentTarget.value })}
        />
      </Field>
      <Field className="w-full" invalid={over}>
        <FieldLabel>Instructions</FieldLabel>
        <Textarea
          size="sm"
          value={draft.instructions}
          disabled={pending}
          onChange={(event) => onChange({ ...draft, instructions: event.currentTarget.value })}
        />
        <span className="text-xs text-muted-foreground" data-persona-instructions-count="">
          {count(draft.instructions.trim().length)} / {count(MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH)}
        </span>
        {over ? <FieldError match>{problem}</FieldError> : null}
      </Field>
      <WriteProblem
        write={write}
        onTakeTheirs={onTakeTheirs}
        {...(onSaveAsNew ? { onSaveAsNew } : {})}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit" disabled={pending || problem !== null}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
