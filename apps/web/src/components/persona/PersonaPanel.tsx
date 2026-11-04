/**
 * The Persona page: how a Mate works and talks in every chat. Its persona, where it came from and
 * its text, then the templates to start from, from Zerops and from the organization, each opening
 * on its text with one action, and an editor to write one by hand.
 *
 * `PersonaPanelBody` draws the page's model (`PersonaPanel.logic.ts`) and reports what the person
 * does; `PersonaPanel` feeds it from the Mate's settings and HQ and writes through the Mate's
 * `updateSettings`, so what it shows is always what the server echoed back.
 */
import type { EnvironmentId, MatePersona } from "@t3tools/contracts";
import { MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH } from "@t3tools/contracts";
import { PREMADE_PERSONA_TEMPLATES } from "@t3tools/shared/personaTemplates";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { ChevronRightIcon, PencilIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn, randomUUID } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useServerConfigs } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrgPersonaTemplates, useSaveOrgPersonaTemplate } from "~/zerops/usePersonaTemplates";
import { RightPanelPageEdge } from "~/components/RightPanelPage";

import { Button, InlineButton } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import {
  PERSONA_WORDS,
  orgTemplateFromPersona,
  personaFromEditor,
  personaFromTemplate,
  personaInstructionsCount,
  personaPage,
  type PersonaDraft,
  type PersonaDraftErrors,
  type PersonaPageModel,
  type PersonaTemplateRow,
} from "./PersonaPanel.logic";

export const PERSONA_PAGE_WORDS = {
  edit: "Edit",
  remove: "Remove",
  removeAsk: (name: string, mate: string) => `Remove ${name}? ${mate} goes back to its own way.`,
  keep: "Keep",
  showAll: "Show all",
  showLess: "Show less",
  appliesNext: (mate: string) => `${mate}'s chats follow it from their next message.`,
  newer: (name: string) => `${name} has a newer version.`,
  takeNewer: "Use it",
  chooseFor: (mate: string) => `Use for ${mate}`,
  inUse: (mate: string) => `${mate} uses this.`,
  inUseMark: "In use",
  templates: "Templates",
  writeOwn: "Write your own",
  name: "Name",
  instructions: "Instructions",
  namePlaceholder: "e.g. Terse",
  instructionsPlaceholder: (mate: string) => `How ${mate} works and talks, in your words.`,
  save: "Save",
  cancel: "Cancel",
  saveAsOrg: (org: string | null) =>
    org === null ? "Save as your organization's template" : `Save as ${org}'s template`,
  savedAsOrg: (org: string | null) =>
    org === null ? "Saved to your organization's templates." : `Saved to ${org}'s templates.`,
  tryAgain: "Try again",
  writeFailed: "Couldn't save the persona:",
  orgSaveFailed: "Couldn't save the template:",
} as const;

/** A write's outcome: `null` once the server took it, else what to tell the person. */
type PersonaWrite = (persona: MatePersona | null) => Promise<string | null>;
type OrgSave = (persona: MatePersona) => Promise<string | null>;

export function PersonaPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly mate: string;
}) {
  const { environmentId } = props;
  const config = useServerConfigs().get(environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const org = useOrgPersonaTemplates();
  const saveOrgTemplate = useSaveOrgPersonaTemplate();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const persona = settings?.persona ?? null;
  const model = useMemo(
    () =>
      personaPage({
        mate: props.mate,
        capability:
          config === undefined ? null : config.environment.capabilities.matePersona === true,
        settingsLoaded: settings !== null,
        persona,
        premade: PREMADE_PERSONA_TEMPLATES,
        org,
      }),
    [config, org, persona, props.mate, settings],
  );
  const write: PersonaWrite = async (next) => {
    const result = await updateSettings({ environmentId, input: { patch: { persona: next } } });
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
    const failure = squashAtomCommandFailure(result);
    return failure instanceof Error ? failure.message : "The Mate did not take it.";
  };
  const saveAsOrg: OrgSave = async (current) => {
    const result = await saveOrgTemplate(randomUUID(), orgTemplateFromPersona(current));
    return result.ok ? null : result.message;
  };
  return (
    <PersonaPanelBody
      mate={props.mate}
      model={model}
      orgName={org.orgName}
      persona={persona}
      saveAsOrg={saveAsOrg}
      write={write}
    />
  );
}

/** Which press a write came from: its pending mark and its failure stand at that press. */
type PersonaAction = "remove" | "newer" | "edit" | "write" | "org" | `use:${string}`;

interface PersonaFailure {
  readonly action: PersonaAction;
  readonly message: string;
  readonly retry: () => void;
}

export function PersonaPanelBody(props: {
  readonly mate: string;
  readonly model: PersonaPageModel;
  readonly persona: MatePersona | null;
  readonly orgName: string | null;
  readonly write: PersonaWrite;
  readonly saveAsOrg: OrgSave;
}) {
  const { mate, model, persona } = props;
  const [pending, setPending] = useState<PersonaAction | null>(null);
  const [failure, setFailure] = useState<PersonaFailure | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [editor, setEditor] = useState<"edit" | "write" | null>(null);
  // Each opening drafts afresh; the key outlives the closing so the closing editor keeps its text.
  const [editorSession, setEditorSession] = useState(0);
  const [savedAsOrg, setSavedAsOrg] = useState<string | null>(null);

  const run = async (action: PersonaAction, attempt: () => Promise<string | null>) => {
    setPending(action);
    setFailure(null);
    const message = await attempt();
    setPending(null);
    if (message === null) {
      setPreview(null);
      if (action === "edit" || action === "write") setEditor(null);
      return true;
    }
    setFailure({ action, message, retry: () => void run(action, attempt) });
    return false;
  };
  const writing = (action: PersonaAction, next: MatePersona | null) =>
    run(action, () => props.write(next));
  const failureAt = (action: PersonaAction) =>
    failure?.action === action ? (
      <FailureLine
        message={`${PERSONA_PAGE_WORDS.writeFailed} ${failure.message}`}
        onRetry={failure.retry}
      />
    ) : null;
  const openEditor = (which: "edit" | "write" | null) => {
    setEditor(which);
    setFailure(null);
    if (which === null) return;
    setPreview(null);
    setEditorSession((current) => current + 1);
  };
  const personaKey = persona === null ? null : `${persona.name}\u0000${persona.instructions}`;

  if (model.kind !== "ready") {
    return (
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-3 pb-8" data-persona-panel>
          <RightPanelPageEdge>
            <span className="flex size-4 items-center justify-center">
              {model.kind === "loading" ? <Spinner size="sm" tone="muted" /> : null}
            </span>
          </RightPanelPageEdge>
          {model.kind === "update" ? (
            <p className="mt-3 text-line leading-4.5 text-muted-foreground" data-persona-update>
              {PERSONA_WORDS.update(mate)}
            </p>
          ) : null}
        </div>
      </ScrollArea>
    );
  }

  const summary = model.persona;
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-3 pb-8" data-persona-panel>
        {summary === null || persona === null ? (
          <p className="mt-3 text-line leading-4.5 text-muted-foreground" data-persona-none>
            {PERSONA_WORDS.ownWay(mate)}
          </p>
        ) : (
          <section className="mt-3 flex flex-col gap-2" data-persona-current>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-sm leading-5">{summary.name}</span>
              <span
                className="truncate text-xs leading-4.5 text-muted-foreground"
                data-persona-origin
              >
                {summary.origin}
              </span>
            </div>
            {/* Editing, its text and presses give way to the editor, which opens in their place. */}
            <EditorReveal open={editor !== "edit"}>
              <div className="flex flex-col gap-2">
                <FoldedText key={summary.instructions} text={summary.instructions} />
                <PersonaActions
                  mate={mate}
                  name={summary.name}
                  editing={editor === "edit"}
                  onEdit={() => openEditor(editor === "edit" ? null : "edit")}
                  onRemove={() => void writing("remove", null)}
                  pending={pending}
                  saveAsOrg={
                    !summary.saveAsOrg ? null : savedAsOrg === personaKey ? (
                      <span className="text-xs text-muted-foreground" role="status">
                        {PERSONA_PAGE_WORDS.savedAsOrg(props.orgName)}
                      </span>
                    ) : (
                      <Button
                        disabled={pending !== null}
                        onClick={() =>
                          void run("org", () => props.saveAsOrg(persona)).then((saved) => {
                            if (saved) setSavedAsOrg(personaKey);
                          })
                        }
                        size="sm"
                        variant="ghost"
                      >
                        {pending === "org" ? <Spinner size="xs" /> : null}
                        {PERSONA_PAGE_WORDS.saveAsOrg(props.orgName)}
                      </Button>
                    )
                  }
                />
                {failureAt("remove")}
                {summary.newer === null ? null : (
                  <div className="flex min-h-7 flex-wrap items-center gap-2" data-persona-newer>
                    <span className="text-xs">
                      {PERSONA_PAGE_WORDS.newer(summary.newer.template.name)}
                    </span>
                    <Button
                      disabled={pending !== null}
                      onClick={() => {
                        const newer = summary.newer;
                        if (newer !== null)
                          void writing("newer", personaFromTemplate(newer.source, newer.template));
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      {pending === "newer" ? <Spinner size="xs" /> : null}
                      {PERSONA_PAGE_WORDS.takeNewer}
                    </Button>
                  </div>
                )}
                {failureAt("newer")}
                {failure?.action === "org" ? (
                  <FailureLine
                    message={`${PERSONA_PAGE_WORDS.orgSaveFailed} ${failure.message}`}
                    onRetry={failure.retry}
                  />
                ) : null}
              </div>
            </EditorReveal>
            <EditorReveal open={editor === "edit"}>
              <PersonaEditor
                // Prefilled from the persona as it stood when the editor opened.
                key={`edit:${String(editorSession)}`}
                failure={failureAt("edit")}
                initial={{ name: persona.name, instructions: persona.instructions }}
                mate={mate}
                onCancel={() => openEditor(null)}
                onSave={(draft) => {
                  const read = personaFromEditor(persona, draft);
                  if (read.ok) void writing("edit", read.persona);
                  return read.ok ? {} : read.errors;
                }}
                pending={pending === "edit"}
              />
            </EditorReveal>
            <p className="text-xs leading-4.5 text-muted-foreground">
              {PERSONA_PAGE_WORDS.appliesNext(mate)}
            </p>
          </section>
        )}

        <div className="mt-8 flex flex-col gap-6">
          {model.groups.map((group) => (
            <section className="flex flex-col" data-persona-group={group.source} key={group.source}>
              <h3 className="font-semibold text-sm leading-5">{group.title}</h3>
              {group.note === null ? null : group.note.kind === "loading" ? (
                <span className="mt-2 flex h-5 items-center">
                  <Spinner size="sm" tone="muted" />
                </span>
              ) : (
                <p
                  className={cn(
                    "mt-1 text-xs leading-4.5",
                    group.note.kind === "failed"
                      ? "text-destructive-foreground"
                      : "text-muted-foreground",
                  )}
                  data-persona-group-note={group.note.kind}
                  role={group.note.kind === "failed" ? "alert" : undefined}
                >
                  {group.note.text}
                </p>
              )}
              {group.rows.length === 0 ? null : (
                <ul className="-mx-2 mt-1 flex flex-col">
                  {group.rows.map((row) => (
                    <TemplateRow
                      failure={failureAt(`use:${row.key}`)}
                      key={row.key}
                      mate={mate}
                      onOpenChange={(next) => {
                        setPreview(next ? row.key : null);
                        if (next) setEditor((current) => (current === "write" ? null : current));
                      }}
                      onUse={() =>
                        void writing(
                          `use:${row.key}`,
                          personaFromTemplate(row.source, row.template),
                        )
                      }
                      open={preview === row.key}
                      pending={pending}
                      row={row}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section className="flex flex-col" data-persona-write>
            <div className="-ms-2">
              <Button
                disabled={pending !== null && pending !== "write"}
                onClick={() => openEditor(editor === "write" ? null : "write")}
                size="sm"
                variant="ghost"
              >
                <PencilIcon aria-hidden="true" />
                {PERSONA_PAGE_WORDS.writeOwn}
              </Button>
            </div>
            <EditorReveal open={editor === "write"}>
              <PersonaEditor
                key={`write:${String(editorSession)}`}
                failure={failureAt("write")}
                initial={{ name: "", instructions: "" }}
                mate={mate}
                onCancel={() => openEditor(null)}
                onSave={(draft) => {
                  const read = personaFromEditor(null, draft);
                  if (read.ok) void writing("write", read.persona);
                  return read.ok ? {} : read.errors;
                }}
                pending={pending === "write"}
              />
            </EditorReveal>
          </section>
        </div>
      </div>
    </ScrollArea>
  );
}

function FailureLine(props: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <p className="text-xs leading-4.5 text-destructive-foreground" role="alert">
      {props.message}{" "}
      <InlineButton onClick={props.onRetry} tone="muted">
        {PERSONA_PAGE_WORDS.tryAgain}
      </InlineButton>
    </p>
  );
}

/** The persona's text, folded past a few lines; Show all opens the rest in place. */
function FoldedText(props: { readonly text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [whole, setWhole] = useState(false);
  const [folds, setFolds] = useState(false);
  // Measured while folded, again as the panel's width changes the lines it takes.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || whole) return;
    const measure = () => setFolds(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [whole]);
  return (
    <div className="flex flex-col items-start gap-0.5 text-xs">
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-line leading-5",
          !whole && "line-clamp-6",
        )}
        data-persona-instructions
        ref={ref}
      >
        {props.text}
      </p>
      {folds ? (
        <InlineButton onClick={() => setWhole((current) => !current)} tone="muted">
          {whole ? PERSONA_PAGE_WORDS.showLess : PERSONA_PAGE_WORDS.showAll}
        </InlineButton>
      ) : null}
    </div>
  );
}

function PersonaActions(props: {
  readonly mate: string;
  readonly name: string;
  readonly editing: boolean;
  readonly pending: PersonaAction | null;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
  /** Owners' and Admins' Save as the organization's template, last in the row. */
  readonly saveAsOrg: ReactNode;
}) {
  // Removing is its own decision: the first press asks, the second removes.
  const [armed, setArmed] = useState(false);
  if (armed)
    return (
      <div className="flex min-h-7 flex-wrap items-center gap-2" data-persona-actions>
        <span className="text-xs">{PERSONA_PAGE_WORDS.removeAsk(props.name, props.mate)}</span>
        <Button
          disabled={props.pending !== null}
          onClick={props.onRemove}
          size="sm"
          variant="destructive"
        >
          {props.pending === "remove" ? <Spinner size="xs" /> : null}
          {PERSONA_PAGE_WORDS.remove}
        </Button>
        <Button
          disabled={props.pending !== null}
          onClick={() => setArmed(false)}
          size="sm"
          variant="ghost"
        >
          {PERSONA_PAGE_WORDS.keep}
        </Button>
      </div>
    );
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-2" data-persona-actions>
      <Button
        aria-expanded={props.editing}
        disabled={props.pending !== null}
        onClick={props.onEdit}
        size="sm"
        variant="secondary"
      >
        {PERSONA_PAGE_WORDS.edit}
      </Button>
      <Button
        disabled={props.pending !== null}
        onClick={() => setArmed(true)}
        size="sm"
        variant="ghost"
      >
        {PERSONA_PAGE_WORDS.remove}
      </Button>
      {props.saveAsOrg}
    </div>
  );
}

function TemplateRow(props: {
  readonly row: PersonaTemplateRow;
  readonly mate: string;
  readonly open: boolean;
  readonly pending: PersonaAction | null;
  readonly failure: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
  readonly onUse: () => void;
}) {
  const { row, mate } = props;
  const action: PersonaAction = `use:${row.key}`;
  return (
    <li data-persona-template={row.key} data-persona-current={row.current ?? undefined}>
      <Collapsible onOpenChange={props.onOpenChange} open={props.open}>
        <CollapsibleTrigger className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex h-5 min-w-0 items-center gap-2">
              <span className="min-w-0 shrink truncate font-medium text-sm">
                {row.template.name}
              </span>
              {row.current === null ? null : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {PERSONA_PAGE_WORDS.inUseMark}
                </span>
              )}
            </span>
            {row.template.description === "" ? null : (
              <span className="line-clamp-2 text-xs leading-4.5 text-muted-foreground">
                {row.template.description}
              </span>
            )}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="flex flex-col gap-3 pt-1 pr-2 pb-4 pl-2" data-persona-preview={row.key}>
            <p className="whitespace-pre-wrap break-words text-line leading-5">
              {row.template.instructions}
            </p>
            <div className="flex min-h-7 flex-wrap items-center gap-2">
              {row.current === "same" ? (
                <span className="text-xs text-muted-foreground">
                  {PERSONA_PAGE_WORDS.inUse(mate)}
                </span>
              ) : (
                <Button disabled={props.pending !== null} onClick={props.onUse} size="sm">
                  {props.pending === action ? <Spinner size="xs" /> : null}
                  {PERSONA_PAGE_WORDS.chooseFor(mate)}
                </Button>
              )}
            </div>
            {props.failure}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

/** The editor opens in place, the rows below moving down with it rather than jumping. */
function EditorReveal(props: { readonly open: boolean; readonly children: ReactNode }) {
  return (
    <Collapsible open={props.open}>
      <CollapsiblePanel>{props.children}</CollapsiblePanel>
    </Collapsible>
  );
}

function PersonaEditor(props: {
  readonly initial: PersonaDraft;
  readonly mate: string;
  readonly pending: boolean;
  readonly failure: ReactNode;
  readonly onSave: (draft: PersonaDraft) => PersonaDraftErrors;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PersonaDraft>(props.initial);
  const [errors, setErrors] = useState<PersonaDraftErrors>({});
  const count = personaInstructionsCount(draft.instructions);
  const over = count > MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH;
  return (
    <form
      className="flex flex-col gap-3 pt-2 pb-1"
      data-persona-editor
      onSubmit={(event) => {
        event.preventDefault();
        setErrors(props.onSave(draft));
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium text-xs">{PERSONA_PAGE_WORDS.name}</span>
        <Input
          autoComplete="off"
          nativeInput
          onChange={(event) => {
            setDraft((current) => ({ ...current, name: event.target.value }));
            setErrors(({ name: _name, ...rest }) => rest);
          }}
          placeholder={PERSONA_PAGE_WORDS.namePlaceholder}
          size="sm"
          value={draft.name}
        />
        {errors.name === undefined ? null : (
          <span className="text-xs text-destructive-foreground" role="alert">
            {errors.name}
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium">{PERSONA_PAGE_WORDS.instructions}</span>
          <span
            className={cn(
              "tabular-nums",
              over ? "text-destructive-foreground" : "text-muted-foreground",
            )}
            data-persona-count
          >
            {count.toLocaleString("en-US")} /{" "}
            {MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-US")}
          </span>
        </span>
        <Textarea
          onChange={(event) => {
            setDraft((current) => ({ ...current, instructions: event.target.value }));
            setErrors(({ instructions: _instructions, ...rest }) => rest);
          }}
          placeholder={PERSONA_PAGE_WORDS.instructionsPlaceholder(props.mate)}
          rows={8}
          size="sm"
          value={draft.instructions}
        />
        {errors.instructions === undefined ? null : (
          <span className="text-xs text-destructive-foreground" role="alert">
            {errors.instructions}
          </span>
        )}
      </label>
      <div className="flex items-center gap-3">
        <Button disabled={props.pending} size="sm" type="submit">
          {props.pending ? <Spinner size="xs" /> : null}
          {PERSONA_PAGE_WORDS.save}
        </Button>
        <Button
          disabled={props.pending}
          onClick={props.onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          {PERSONA_PAGE_WORDS.cancel}
        </Button>
      </div>
      {props.failure}
    </form>
  );
}
