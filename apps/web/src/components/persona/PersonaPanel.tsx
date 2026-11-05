/**
 * The Persona page: how a Mate works and talks in every chat. Its persona, where it came from and
 * its text, then the templates to start from, from Zerops and from the organization. Every
 * persona passes through the editor before the Mate takes it: a template opens there on its text,
 * so it can be changed first, and writing one's own opens it empty.
 *
 * `PersonaPanelBody` draws the page's model (`PersonaPanel.logic.ts`) and reports what the person
 * does; `PersonaPanel` feeds it from the Mate's settings and HQ and writes through the Mate's
 * `updateSettings`, so what it shows is always what the server echoed back.
 */
import type { EnvironmentId, MatePersona, MatePersonaTemplateRef } from "@t3tools/contracts";
import { MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH } from "@t3tools/contracts";
import { PREMADE_PERSONA_TEMPLATES } from "@t3tools/shared/personaTemplates";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  Building2Icon,
  DramaIcon,
  EllipsisIcon,
  GraduationCapIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PenLineIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  SirenIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn, randomUUID } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useServerConfigs } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrgPersonaTemplates, usePersonaTemplateWriter } from "~/zerops/usePersonaTemplates";
import { RightPanelPageEdge } from "~/components/RightPanelPage";
import { ZeropsMateUpdateControl } from "~/components/zerops/ZeropsMateUpdateControl";

import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Row } from "../ui/row";
import { ScrollArea } from "../ui/scroll-area";
import { SectionHeader } from "../ui/section";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import {
  PERSONA_WORDS,
  mateIn,
  mateLeads,
  orgTemplateDraft,
  personaEditorOpening,
  personaFromEditor,
  personaLeavesTemplate,
  samePersona,
  savedTemplateLink,
  type MateName,
  type SavedTemplateLink,
  type SavingTemplate,
  personaInstructionsCount,
  personaPage,
  type PersonaDraft,
  type PersonaEditorOpening,
  type PersonaEditorStart,
  type PersonaDraftErrors,
  type PersonaGroupNote,
  type PersonaPageModel,
  type PersonaSummary,
  type PersonaTemplateRow,
} from "./PersonaPanel.logic";

export const PERSONA_PAGE_WORDS = {
  none: "No persona",
  noneLine: (mate: MateName) => `${mateLeads(mate)} works its own way.`,
  edit: "Edit",
  more: (name: string) => `More for ${name}`,
  remove: "Remove",
  removePersona: "Remove persona",
  removeAsk: (name: string, mate: MateName) =>
    `Remove ${name}? ${mateLeads(mate)} goes back to its own way.`,
  keep: "Keep",
  showAll: "Show all",
  showLess: "Show less",
  appliesNext: (mate: MateName) => `${mateLeads(mate)}'s chats follow it from their next message.`,
  newer: (name: string) => `${name} has a newer version.`,
  seeNewer: "See it",
  newerLine: "The template's newer version. Change it if you like before you use it.",
  inUseMark: "In use",
  writeOwn: "Write your own",
  back: "Back",
  manage: "Manage templates",
  noOrgTemplatesLine: (org: string | null, mayWrite: boolean) => {
    const whose = org ?? "your organization";
    // The name stays mid-sentence: "Mate s.r.o." ends in its own full stop.
    return mayWrite
      ? `Every Mate in ${whose} can start from the templates you add.`
      : `Owners and Admins of ${whose} add templates for every Mate.`;
  },
  name: "Name",
  instructions: "Instructions",
  namePlaceholder: "e.g. Terse",
  instructionsPlaceholder: (mate: MateName) =>
    `How ${mateIn(mate)} works and talks, in your words.`,
  leaves: (mate: MateName) =>
    `Changed, so it becomes ${mateIn(mate)}'s own: the template's newer versions won't be offered.`,
  cancel: "Cancel",
  saveAsOrg: (org: string | null) =>
    org === null ? "Save as your organization's template" : `Save as ${org}'s template`,
  savingAsOrg: (org: string | null) =>
    org === null ? "Saving to your organization's templates…" : `Saving to ${org}'s templates…`,
  savedAsOrg: (org: string | null) =>
    org === null ? "Saved to your organization's templates." : `Saved to ${org}'s templates.`,
  tryAgain: "Try again",
  readAgain: "Read again",
  orgConflict: "the template changed while it was being saved.",
  notShown: (mate: MateName) => `${mateLeads(mate)} took it but doesn't show it yet.`,
  writeFailed: "Couldn't save the persona:",
  orgSaveFailed: "Couldn't save the template:",
} as const;

/**
 * A write's outcome: `null` once the Mate shows what was written, else the sentence that tells the
 * person what happened.
 */
type PersonaWrite = (persona: MatePersona | null) => Promise<string | null>;

/** Where Save as the organization's template stands, through tying the Mate to it. */
export type OrgSaveView =
  | { readonly stage: "idle" | "pending" | "saved" }
  | { readonly stage: "failed"; readonly message: string; readonly retry: () => void }
  | { readonly stage: "unconfirmed"; readonly message: string };

/** How long a write waits for the Mate's settings to show it before saying it is not confirmed. */
const ECHO_WAIT_MS = 10_000;

/**
 * Waits for the Mate's settings to show a persona: `updateSettings` answers before its
 * `settingsUpdated` reaches this page, and the page shows only what the Mate shows.
 */
function usePersonaEcho(shown: MatePersona | null, mate: MateName) {
  const shownRef = useRef(shown);
  const waiters = useRef(
    new Set<{
      readonly persona: MatePersona | null;
      readonly settle: (failure: string | null) => void;
    }>(),
  );
  useEffect(() => {
    shownRef.current = shown;
    for (const waiter of waiters.current)
      if (samePersona(waiter.persona, shown)) waiter.settle(null);
  }, [shown]);
  return (persona: MatePersona | null) =>
    new Promise<string | null>((resolve) => {
      if (samePersona(persona, shownRef.current)) {
        resolve(null);
        return;
      }
      const waiter = {
        persona,
        settle: (failure: string | null) => {
          clearTimeout(timer);
          waiters.current.delete(waiter);
          resolve(failure);
        },
      };
      const timer = setTimeout(
        () => waiter.settle(PERSONA_PAGE_WORDS.notShown(mate)),
        ECHO_WAIT_MS,
      );
      waiters.current.add(waiter);
    });
}

export function PersonaPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly mate: MateName;
}) {
  const { environmentId, mate } = props;
  const config = useServerConfigs().get(environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const org = useOrgPersonaTemplates();
  const writer = usePersonaTemplateWriter();
  const navigate = useNavigate();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const persona = settings?.persona ?? null;
  const model = useMemo(
    () =>
      personaPage({
        mate,
        capability:
          config === undefined ? null : config.environment.capabilities.matePersona === true,
        settingsLoaded: settings !== null,
        persona,
        premade: PREMADE_PERSONA_TEMPLATES,
        org,
      }),
    [config, org, persona, mate, settings],
  );
  const shown = usePersonaEcho(persona, mate);
  const send: PersonaWrite = async (next) => {
    const result = await updateSettings({ environmentId, input: { patch: { persona: next } } });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      return `${PERSONA_PAGE_WORDS.writeFailed} ${failure instanceof Error ? failure.message : "the Mate did not take it."}`;
    }
    return shown(next);
  };
  // Every write a person makes on the page; a save as a template begun before one never ties.
  const [writes, setWrites] = useState(0);
  const write: PersonaWrite = (next) => {
    setWrites((count) => count + 1);
    return send(next);
  };

  // The persona being saved as a template, until the Mate is tied to it or that is abandoned.
  const [saving, setSaving] = useState<SavingTemplate>();
  // How tying the Mate to it went, by template id; absent while that write is under way.
  const [tied, setTied] = useState<{ readonly id: string; readonly failure: string | null }>();
  // Templates whose tie was decided: a list dropping out and back never ties one again.
  const decided = useRef(new Set<string>());
  const saveAsOrg = (current: MatePersona) => {
    const id = randomUUID();
    // HQ creates it at revision 1 (`PUT /api/persona-templates/{id}` with revision 0).
    setSaving({ id, persona: current, revision: 1, writesAtStart: writes });
    setTied(undefined);
    writer.save(orgTemplateDraft(current, id));
  };
  const tie = (id: string, next: MatePersona) =>
    void send(next).then((failure) => {
      setTied({ id, failure });
      if (failure === null) setSaving((current) => (current?.id === id ? undefined : current));
    });
  const found =
    saving === undefined ? null : savedTemplateLink(saving, org.templates, persona, writes);
  const link: SavedTemplateLink | null =
    found?.kind === "link" && writer.write.stage !== "done" ? { kind: "wait" } : found;
  const linkId = saving !== undefined && link?.kind === "link" ? saving.id : null;
  const abandonId = saving !== undefined && link?.kind === "abandon" ? saving.id : null;
  const onLink = useEffectEvent((id: string) => {
    if (decided.current.has(id) || link?.kind !== "link") return;
    decided.current.add(id);
    tie(id, link.persona);
  });
  const onAbandon = useEffectEvent((id: string) => {
    decided.current.add(id);
    // Forgotten once this render is done: nothing is left to tie.
    queueMicrotask(() => setSaving((current) => (current?.id === id ? undefined : current)));
  });
  useEffect(() => {
    if (linkId !== null) onLink(linkId);
  }, [linkId]);
  useEffect(() => {
    if (abandonId !== null) onAbandon(abandonId);
  }, [abandonId]);

  const stage = writer.write;
  const orgSave: OrgSaveView =
    saving === undefined || link === null || link.kind === "abandon"
      ? { stage: "idle" }
      : tied?.id === saving.id && tied.failure !== null
        ? {
            stage: "failed",
            message: tied.failure,
            retry: () => {
              if (link.kind !== "link") return;
              setTied(undefined);
              tie(saving.id, link.persona);
            },
          }
        : link.kind === "link"
          ? { stage: "pending" }
          : stage.stage === "pending"
            ? { stage: "pending" }
            : // Saved, and no current list will show it: the Mate stays as it is.
              stage.stage === "done"
              ? { stage: "saved" }
              : stage.stage === "unconfirmed"
                ? { stage: "unconfirmed", message: stage.reason }
                : stage.stage === "failed" || stage.stage === "conflict"
                  ? {
                      stage: "failed",
                      message: `${PERSONA_PAGE_WORDS.orgSaveFailed} ${
                        stage.stage === "failed" ? stage.reason : PERSONA_PAGE_WORDS.orgConflict
                      }`,
                      retry: () => saveAsOrg(saving.persona),
                    }
                  : { stage: "idle" };
  return (
    <PersonaPanelBody
      mate={mate}
      model={model}
      onManageTemplates={
        org.mayWrite ? () => void navigate({ to: "/settings/personas" }) : undefined
      }
      onReadOrgAgain={org.retry}
      onSaveAsOrg={() => {
        if (persona !== null) saveAsOrg(persona);
      }}
      orgName={org.orgName}
      orgSave={orgSave}
      persona={persona}
      update={
        <ZeropsMateUpdateControl environmentId={environmentId} mateName={mate ?? undefined}>
          {({ line }) => line}
        </ZeropsMateUpdateControl>
      }
      write={write}
    />
  );
}

/** Which press a write came from: its pending mark and its failure stand at that press. */
type PersonaAction = "remove" | "save";

interface PersonaFailure {
  readonly action: PersonaAction;
  readonly message: string;
  readonly retry: () => void;
}

/** The list of templates, or the editor open on one of them, on the persona or on nothing. */
type PersonaView =
  | { readonly kind: "list" }
  | {
      readonly kind: "editor";
      readonly start: PersonaEditorStart;
      /** What it opened on, held as it stood then: a change from elsewhere never swaps it. */
      readonly opening: PersonaEditorOpening;
      /** Each opening drafts afresh. */
      readonly session: number;
      /** The template tile it opened from, which takes focus back when it closes. */
      readonly from: string | null;
    };

const PREMADE_ICONS: Readonly<Record<string, LucideIcon>> = {
  explainer: MessagesSquareIcon,
  prototyper: ZapIcon,
  "careful-engineer": ShieldCheckIcon,
  reviewer: ScanSearchIcon,
  designer: PaletteIcon,
  "on-call": SirenIcon,
  teacher: GraduationCapIcon,
};

/** A persona's mark: its Zerops template's own, the organization's, or the pen of one written by hand. */
const personaIcon = (template: MatePersonaTemplateRef | undefined): LucideIcon =>
  template === undefined
    ? PenLineIcon
    : template.source === "org"
      ? Building2Icon
      : (PREMADE_ICONS[template.id] ?? DramaIcon);

export function PersonaPanelBody(props: {
  readonly mate: MateName;
  /** The Mate's update, where its server takes no persona (`ZeropsMateUpdateControl`). */
  readonly update?: ReactNode;
  readonly model: PersonaPageModel;
  readonly persona: MatePersona | null;
  readonly orgName: string | null;
  readonly write: PersonaWrite;
  readonly orgSave: OrgSaveView;
  readonly onSaveAsOrg: () => void;
  readonly onReadOrgAgain: () => void;
  /** Owners' and Admins' way to the organization's templates in Settings. */
  readonly onManageTemplates?: (() => void) | undefined;
}) {
  const { mate, model, persona } = props;
  const [pending, setPending] = useState<PersonaAction | null>(null);
  const [failure, setFailure] = useState<PersonaFailure | null>(null);
  const [view, setView] = useState<PersonaView>({ kind: "list" });
  const sessions = useRef(0);
  // Only a switch the person made moves: the page's first paint stands still.
  const [moved, setMoved] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // The tile to focus once the list is back, so the person lands where they left.
  const returnTo = useRef<string | null>(null);

  const toTop = () =>
    rootRef.current?.closest('[data-slot="scroll-area-viewport"]')?.scrollTo({ top: 0 });
  const show = (next: PersonaView) => {
    setFailure(null);
    setMoved(true);
    setView(next);
    if (next.kind === "editor") toTop();
  };
  const open = (start: PersonaEditorStart, from: string | null = null) => {
    if (model.kind !== "ready") return;
    const opening = personaEditorOpening(start, { mate, persona, page: model });
    if (opening === null) return;
    sessions.current += 1;
    show({ kind: "editor", start, opening, session: sessions.current, from });
  };
  const close = (focus: boolean) => {
    returnTo.current = focus && view.kind === "editor" ? view.from : null;
    show({ kind: "list" });
    if (!focus) toTop();
  };
  useLayoutEffect(() => {
    if (view.kind !== "list" || returnTo.current === null) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-persona-template="${CSS.escape(returnTo.current)}"]`)
      ?.focus();
    returnTo.current = null;
  }, [view]);

  const run = async (action: PersonaAction, attempt: () => Promise<string | null>) => {
    setPending(action);
    setFailure(null);
    const message = await attempt();
    setPending(null);
    if (message === null) {
      if (action === "save") close(false);
      return;
    }
    setFailure({ action, message, retry: () => void run(action, attempt) });
  };
  const writing = (action: PersonaAction, next: MatePersona | null) =>
    run(action, () => props.write(next));
  const failureAt = (action: PersonaAction) =>
    failure?.action === action ? (
      <FailureLine message={failure.message} onRetry={failure.retry} />
    ) : null;

  if (model.kind !== "ready") {
    return (
      <ScrollArea className="h-full">
        <div className="flex w-full max-w-3xl flex-col px-4 pt-3 pb-8" data-persona-panel>
          <RightPanelPageEdge>
            <span className="flex size-4 items-center justify-center">
              {model.kind === "loading" ? <Spinner size="sm" tone="muted" /> : null}
            </span>
          </RightPanelPageEdge>
          {model.kind === "update" ? (
            <div className="mt-3 flex flex-col gap-2" data-persona-update>
              <p className="text-line leading-4.5 text-muted-foreground">{model.line}</p>
              {/* The problem comes with its fix: the Mate's own update, where it may be updated. */}
              {props.update}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    );
  }

  const motion = moved ? "animate-rise-in motion-reduce:animate-run-fade" : undefined;
  return (
    <ScrollArea className="h-full">
      {/* Starts where the page's head does, however wide the panel is. */}
      <div
        className="flex w-full max-w-3xl flex-col px-4 pt-3 pb-8"
        data-persona-panel
        ref={rootRef}
      >
        {view.kind === "editor" ? (
          <div className={cn("flex flex-col gap-4", motion)} key={`editor:${String(view.session)}`}>
            <div className="-ms-2">
              <Button onClick={() => close(true)} size="sm" variant="ghost">
                <ArrowLeftIcon aria-hidden="true" />
                {PERSONA_PAGE_WORDS.back}
              </Button>
            </div>
            <EditorHead mate={mate} model={model} start={view.start} />
            <PersonaEditor
              base={view.opening.base}
              failure={failureAt("save")}
              initial={view.opening.draft}
              mate={mate}
              onCancel={() => close(true)}
              onSave={(draft) => {
                const read = personaFromEditor(view.opening.base, draft);
                if (read.ok) void writing("save", read.persona);
                return read.ok ? {} : read.errors;
              }}
              pending={pending === "save"}
              saveLabel={view.opening.save}
            />
          </div>
        ) : (
          <div className={cn("flex flex-col gap-8", motion)} key="list">
            <CurrentPersona
              mate={mate}
              model={model}
              onEdit={() => open({ kind: "edit" })}
              onNewer={() => open({ kind: "newer" })}
              onRemove={() => void writing("remove", null)}
              onSaveAsOrg={props.onSaveAsOrg}
              onWriteOwn={() => open({ kind: "blank" }, WRITE_OWN_KEY)}
              orgName={props.orgName}
              orgSave={props.orgSave}
              pending={pending}
              persona={persona}
              removeFailure={failureAt("remove")}
            />
            {model.groups.map((group) => (
              <section
                className="flex flex-col gap-2"
                data-persona-group={group.source}
                key={group.source}
              >
                <SectionHeader
                  action={
                    group.source === "org" && props.onManageTemplates !== undefined ? (
                      <Button onClick={props.onManageTemplates} size="sm" variant="ghost">
                        {PERSONA_PAGE_WORDS.manage}
                      </Button>
                    ) : null
                  }
                  level={3}
                  title={group.title}
                />
                <TemplateList
                  disabled={pending !== null}
                  mayWrite={props.onManageTemplates !== undefined}
                  note={group.note}
                  onOpen={(row) => open({ kind: "template", row }, row.key)}
                  onReadAgain={props.onReadOrgAgain}
                  orgName={props.orgName}
                  rows={group.rows}
                />
                {group.note?.kind === "stale" ? (
                  <p
                    className="text-xs leading-4.5 text-muted-foreground"
                    data-persona-group-note="stale"
                  >
                    {group.note.text}
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        )}
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

/** A persona's or a template's mark: the lead of its row, quiet where nothing is chosen. */
function PersonaMark(props: { readonly icon: LucideIcon; readonly quiet?: boolean | undefined }) {
  const Icon = props.icon;
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4.5", props.quiet ? "text-muted-foreground" : "text-foreground")}
    />
  );
}

/** A line under the persona's text, past a hairline, where the words start. */
const STRIP_CLASS =
  "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 ps-11 pe-3 text-xs leading-4.5";

function CurrentPersona(props: {
  readonly mate: MateName;
  readonly model: Extract<PersonaPageModel, { kind: "ready" }>;
  readonly persona: MatePersona | null;
  readonly pending: PersonaAction | null;
  readonly orgName: string | null;
  readonly orgSave: OrgSaveView;
  readonly removeFailure: ReactNode;
  readonly onEdit: () => void;
  readonly onNewer: () => void;
  readonly onRemove: () => void;
  readonly onSaveAsOrg: () => void;
  readonly onWriteOwn: () => void;
}) {
  const { mate, persona, pending } = props;
  const summary = props.model.persona;
  if (summary === null || persona === null)
    return (
      <Card data-persona-none variant="flat">
        <Row
          control={
            <Button
              data-persona-template={WRITE_OWN_KEY}
              disabled={pending !== null}
              onClick={props.onWriteOwn}
              size="sm"
              variant="secondary"
            >
              <PenLineIcon aria-hidden="true" />
              {PERSONA_PAGE_WORDS.writeOwn}
            </Button>
          }
          lead={<PersonaMark icon={DramaIcon} quiet />}
          line={PERSONA_PAGE_WORDS.noneLine(mate)}
          size="sm"
          title={PERSONA_PAGE_WORDS.none}
        />
      </Card>
    );
  return <PersonaCard {...props} persona={persona} summary={summary} />;
}

/** The persona the Mate follows: its name and source, its text, and what can be done with it. */
function PersonaCard(props: {
  readonly mate: MateName;
  readonly persona: MatePersona;
  readonly summary: PersonaSummary;
  readonly pending: PersonaAction | null;
  readonly orgName: string | null;
  readonly orgSave: OrgSaveView;
  readonly removeFailure: ReactNode;
  readonly onEdit: () => void;
  readonly onNewer: () => void;
  readonly onRemove: () => void;
  readonly onSaveAsOrg: () => void;
}) {
  const { mate, persona, summary, pending, orgSave } = props;
  // Removing is its own decision: the menu asks, the strip under the text removes.
  const [armed, setArmed] = useState(false);
  const busy = pending !== null;
  return (
    <div className="flex flex-col gap-2">
      <Card data-persona-current variant="flat">
        <Row
          control={
            <span className="flex items-center gap-1" data-persona-actions>
              <Button disabled={busy} onClick={props.onEdit} size="sm" variant="secondary">
                {PERSONA_PAGE_WORDS.edit}
              </Button>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      aria-label={PERSONA_PAGE_WORDS.more(summary.name)}
                      disabled={busy}
                      size="icon-sm"
                      variant="ghost"
                    />
                  }
                >
                  <EllipsisIcon aria-hidden="true" />
                </MenuTrigger>
                <MenuPopup align="end">
                  {summary.saveAsOrg ? (
                    <MenuItem
                      disabled={orgSave.stage === "pending" || orgSave.stage === "saved"}
                      onClick={props.onSaveAsOrg}
                    >
                      {PERSONA_PAGE_WORDS.saveAsOrg(props.orgName)}
                    </MenuItem>
                  ) : null}
                  <MenuItem onClick={() => setArmed(true)} variant="destructive">
                    {PERSONA_PAGE_WORDS.removePersona}
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </span>
          }
          lead={<PersonaMark icon={personaIcon(persona.template)} />}
          line={<span data-persona-origin>{summary.origin}</span>}
          size="sm"
          title={summary.name}
        />
        <div className="ps-11 pe-3 pb-3">
          <FoldedText key={summary.instructions} text={summary.instructions} />
        </div>
        {summary.newer === null ? null : (
          <div className={STRIP_CLASS} data-persona-newer>
            <span className="min-w-0 flex-1">
              {PERSONA_PAGE_WORDS.newer(summary.newer.template.name)}
            </span>
            <Button disabled={busy} onClick={props.onNewer} size="sm" variant="secondary">
              {PERSONA_PAGE_WORDS.seeNewer}
            </Button>
          </div>
        )}
        {armed ? (
          <div className={STRIP_CLASS} data-persona-remove>
            <span className="min-w-0 flex-1">
              {PERSONA_PAGE_WORDS.removeAsk(summary.name, mate)}
            </span>
            <span className="flex items-center gap-1">
              <Button disabled={busy} onClick={props.onRemove} size="sm" variant="destructive">
                {pending === "remove" ? <Spinner size="xs" /> : null}
                {PERSONA_PAGE_WORDS.remove}
              </Button>
              <Button disabled={busy} onClick={() => setArmed(false)} size="sm" variant="ghost">
                {PERSONA_PAGE_WORDS.keep}
              </Button>
            </span>
          </div>
        ) : null}
        {props.removeFailure === null ? null : (
          <div className={STRIP_CLASS}>{props.removeFailure}</div>
        )}
        {orgSave.stage === "idle" ? null : (
          <div className={STRIP_CLASS} data-persona-org-save={orgSave.stage}>
            {orgSave.stage === "pending" ? (
              <span className="flex items-center gap-2 text-muted-foreground" role="status">
                <Spinner size="xs" tone="muted" />
                {PERSONA_PAGE_WORDS.savingAsOrg(props.orgName)}
              </span>
            ) : orgSave.stage === "saved" ? (
              <span className="text-muted-foreground" role="status">
                {PERSONA_PAGE_WORDS.savedAsOrg(props.orgName)}
              </span>
            ) : orgSave.stage === "failed" ? (
              <FailureLine message={orgSave.message} onRetry={orgSave.retry} />
            ) : orgSave.stage === "unconfirmed" ? (
              // It may have been saved: nothing offers to send it again.
              <span className="text-muted-foreground" role="status">
                {orgSave.message}
              </span>
            ) : null}
          </div>
        )}
      </Card>
      <p className="text-xs leading-4.5 text-muted-foreground">
        {PERSONA_PAGE_WORDS.appliesNext(mate)}
      </p>
    </div>
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
          "whitespace-pre-wrap break-words text-line leading-5 text-muted-foreground",
          !whole && "line-clamp-4",
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

/** The press that opens the editor on nothing: written by hand. */
const WRITE_OWN_KEY = "write-own";

/**
 * A group's templates as rows in one card, or what stands in their place: a placeholder row while
 * they load, a row saying there are none, or why they couldn't be read.
 */
function TemplateList(props: {
  readonly rows: readonly PersonaTemplateRow[];
  readonly note: PersonaGroupNote | null;
  readonly orgName: string | null;
  /** Owners and Admins add the organization's templates; members are told who does. */
  readonly mayWrite: boolean;
  readonly disabled: boolean;
  readonly onOpen: (row: PersonaTemplateRow) => void;
  readonly onReadAgain: () => void;
}) {
  const { note } = props;
  return (
    <Card variant="flat">
      {note?.kind === "loading" ? (
        <div
          aria-busy="true"
          className="flex min-h-14 gap-3 px-3 py-2.5"
          data-persona-group-note="loading"
        >
          <Skeleton className="size-5" />
          <span className="flex flex-1 flex-col gap-1.5 py-0.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </span>
        </div>
      ) : note?.kind === "empty" ? (
        <Row
          data-persona-group-note="empty"
          lead={<PersonaMark icon={Building2Icon} quiet />}
          line={PERSONA_PAGE_WORDS.noOrgTemplatesLine(props.orgName, props.mayWrite)}
          lineWraps
          size="sm"
          title={note.text}
        />
      ) : note?.kind === "unavailable" || note?.kind === "failed" ? (
        <div className="flex gap-3 px-3 py-3" data-persona-group-note={note.kind}>
          <span className="flex size-5 shrink-0 items-center justify-center">
            <PersonaMark icon={Building2Icon} quiet />
          </span>
          <p
            className={cn(
              "min-w-0 text-xs leading-5",
              note.kind === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
            )}
            role={note.kind === "failed" ? "alert" : undefined}
          >
            {note.text}
            {note.kind === "failed" ? (
              <>
                {" "}
                <InlineButton onClick={props.onReadAgain} tone="muted">
                  {PERSONA_PAGE_WORDS.readAgain}
                </InlineButton>
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {props.rows.map((row) => (
            <li key={row.key}>
              <TemplateRow disabled={props.disabled} onOpen={() => props.onOpen(row)} row={row} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A template to start from: pressing it opens the editor on its text. */
function TemplateRow(props: {
  readonly row: PersonaTemplateRow;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  const { row } = props;
  return (
    <Row
      aria-current={row.current === null ? undefined : "true"}
      aria-disabled={props.disabled || undefined}
      badges={row.current === null ? null : <Badge>{PERSONA_PAGE_WORDS.inUseMark}</Badge>}
      data-persona-current={row.current ?? undefined}
      data-persona-template={row.key}
      lead={
        <PersonaMark icon={personaIcon({ source: row.source, id: row.template.id, revision: 0 })} />
      }
      line={row.template.description === "" ? null : row.template.description}
      lineWraps
      onClick={props.onOpen}
      pressable
      render={<button disabled={props.disabled} type="button" />}
      size="sm"
      title={row.template.name}
    />
  );
}

/** What the editor opened on: the template, the newer version, the persona or nothing. */
function EditorHead(props: {
  readonly mate: MateName;
  readonly model: Extract<PersonaPageModel, { kind: "ready" }>;
  readonly start: PersonaEditorStart;
}) {
  const { mate, model, start } = props;
  const summary = model.persona;
  const head: { icon: LucideIcon; title: string; line: string } =
    start.kind === "template"
      ? {
          icon: personaIcon({ source: start.row.source, id: start.row.template.id, revision: 0 }),
          title: start.row.template.name,
          line:
            start.row.template.description === ""
              ? (model.groups.find((group) => group.source === start.row.source)?.title ?? "")
              : start.row.template.description,
        }
      : start.kind === "newer" && summary?.newer
        ? {
            icon: personaIcon({
              source: summary.newer.source,
              id: summary.newer.template.id,
              revision: 0,
            }),
            title: summary.newer.template.name,
            line: PERSONA_PAGE_WORDS.newerLine,
          }
        : start.kind === "edit" && summary !== null
          ? { icon: PenLineIcon, title: summary.name, line: summary.origin }
          : {
              icon: PenLineIcon,
              title: PERSONA_PAGE_WORDS.writeOwn,
              line: PERSONA_WORDS.writtenFor(mate),
            };
  return (
    <div className="flex min-w-0 items-start gap-3" data-persona-editor-head>
      <span className="flex size-5 shrink-0 items-center justify-center">
        <PersonaMark icon={head.icon} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium text-sm leading-5">{head.title}</span>
        <span className="text-xs leading-4.5 text-muted-foreground">{head.line}</span>
      </span>
    </div>
  );
}

function PersonaEditor(props: {
  readonly initial: PersonaDraft;
  /** What an unchanged save writes: its template is left once the text changes. */
  readonly base: MatePersona | null;
  readonly mate: MateName;
  readonly saveLabel: string;
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
      className="flex flex-col gap-3"
      data-persona-editor
      onKeyDown={(event) => {
        if (event.key === "Escape" && !props.pending) props.onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        setErrors(props.onSave(draft));
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium text-xs">{PERSONA_PAGE_WORDS.name}</span>
        <Input
          autoComplete="off"
          autoFocus={props.initial.name === ""}
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
          rows={10}
          size="sm"
          value={draft.instructions}
        />
        {errors.instructions === undefined ? null : (
          <span className="text-xs text-destructive-foreground" role="alert">
            {errors.instructions}
          </span>
        )}
      </label>
      {personaLeavesTemplate(props.base, draft) ? (
        <p className="text-xs leading-4.5 text-muted-foreground" data-persona-leaves>
          {PERSONA_PAGE_WORDS.leaves(props.mate)}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button disabled={props.pending} size="sm" type="submit">
          {props.pending ? <Spinner size="xs" /> : null}
          {props.saveLabel}
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
