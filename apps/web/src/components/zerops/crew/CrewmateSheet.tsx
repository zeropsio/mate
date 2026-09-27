/**
 * The Crewmate editor (PRD §4.7): name, handle (until Apply), face tint, job,
 * *Runs on* — login, model and effort from the login's catalog, *Read only* —
 * and, for a crewmate that changes files, its service and its setup, check and
 * run commands with the two restart switches. The lead is always read only.
 *
 * Before Apply a save only writes the files. On an applied crew a new
 * crewmate is applied at once (`apply`), and an edit applies with the chosen
 * `jobSave` — only *Save and start fresh* once its login changed (§2.3). A job
 * rewritten for the most part pre-selects a fresh conversation and says why.
 */
import { CREW_HANDLE_PATTERN, type CrewApplyChoice, type ServerProvider } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import {
  CREW_HOME_FILE,
  crewJobFile,
  type CrewDefinition,
  type CrewMemberSpec,
} from "@t3tools/shared/crewHome";
import { useState } from "react";

import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { Textarea } from "../../ui/textarea";
import type { UseCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useCrewHome, type CrewHomeRead } from "../../../zerops/crew/useCrewHome";
import { MateFace, Pill } from "../primitives";
import {
  crewEffortOptions,
  crewLoginOptions,
  crewModelOptions,
  freeTints,
  jobChangedMostly,
  withMember,
} from "./CrewEditors.logic";
import {
  CrewField,
  CrewSaveButton,
  CrewSheet,
  CrewSheetBody,
  CrewSheetFooter,
  CrewSheetReading,
} from "./CrewSheetParts";

/** The select's value for "the login's own default". */
const LOGIN_DEFAULT = "default";

interface Draft {
  readonly displayName: string;
  readonly handle: string;
  readonly tint: MateTintId | undefined;
  readonly job: string;
  readonly login: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly readOnly: boolean;
  readonly host: string;
  readonly setup: string;
  readonly check: string;
  readonly run: string;
  readonly restartAfterMerge: boolean;
  readonly afterLandRestart: boolean;
}

const emptyDraft = (lead: boolean): Draft => ({
  displayName: lead ? "Lead" : "",
  handle: lead ? "lead" : "",
  tint: undefined,
  job: "",
  login: "claudeAgent",
  model: null,
  effort: null,
  readOnly: lead,
  host: "",
  setup: "",
  check: "",
  run: "",
  restartAfterMerge: false,
  afterLandRestart: false,
});

const draftOf = (member: CrewMemberSpec): Draft => ({
  displayName: member.displayName,
  handle: member.handle,
  tint: member.tint,
  job: member.job,
  login: member.login ?? "claudeAgent",
  model: member.model ?? null,
  effort: member.effort ?? null,
  readOnly: member.readOnly,
  host: member.host ?? "",
  setup: member.setup ?? "",
  check: member.check ?? "",
  run: member.run ?? "",
  restartAfterMerge: member.restartAfterMerge,
  afterLandRestart: member.afterLandRestart,
});

const optional = (value: string) => (value.trim() === "" ? undefined : value.trim());

function specOf(draft: Draft, lead: boolean, before: CrewMemberSpec | undefined): CrewMemberSpec {
  const writes = !lead && !draft.readOnly;
  const host = writes ? optional(draft.host) : undefined;
  const setup = writes ? optional(draft.setup) : undefined;
  const check = writes ? optional(draft.check) : undefined;
  const run = writes ? optional(draft.run) : undefined;
  return {
    handle: draft.handle,
    displayName: draft.displayName.trim(),
    kind: lead ? "lead" : writes ? "writer" : "reader",
    readOnly: !writes,
    ...(draft.tint === undefined ? {} : { tint: draft.tint }),
    ...(host === undefined ? {} : { host }),
    ...(setup === undefined ? {} : { setup }),
    ...(check === undefined ? {} : { check }),
    ...(run === undefined ? {} : { run }),
    restartAfterMerge: writes && draft.restartAfterMerge,
    afterLandRestart: writes && draft.afterLandRestart,
    login: draft.login,
    ...(draft.model === null ? {} : { model: draft.model }),
    ...(draft.effort === null ? {} : { effort: draft.effort }),
    env: writes ? (before?.env ?? {}) : {},
    ...(writes && before?.database !== undefined ? { database: before.database } : {}),
    migrations: writes ? (before?.migrations ?? []) : [],
    ...(before?.context === undefined ? {} : { context: before.context }),
    ...(before?.rotateAfter === undefined ? {} : { rotateAfter: before.rotateAfter }),
    job: draft.job,
  };
}

export interface CrewmateSheetTarget {
  /** The crewmate's handle; `null` adds one. */
  readonly handle: string | null;
  /** Adding the lead (C). */
  readonly lead: boolean;
}

interface CrewmateSheetProps {
  readonly onOpenChange: (open: boolean) => void;
  readonly target: CrewmateSheetTarget;
  readonly commands: UseCrewCommand;
  /** Handles already applied: their handle is fixed and a save applies their job. */
  readonly applied: ReadonlySet<string>;
  /** The Mate's coding agents; `undefined` while its config is not read. */
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly devHosts: ReadonlyArray<string>;
  readonly mateTint: MateTintId | undefined;
  /** The crewmate's crew port on its service, when it has one. */
  readonly crewPort: number | null;
}

export function CrewmateSheet({ open, ...props }: CrewmateSheetProps & { readonly open: boolean }) {
  const { target } = props;
  return (
    <CrewSheet
      onOpenChange={props.onOpenChange}
      open={open}
      title={target.handle !== null ? "Edit crewmate" : target.lead ? "Add lead" : "Add crewmate"}
    >
      <CrewmateContents {...props} />
    </CrewSheet>
  );
}

function CrewmateContents(props: CrewmateSheetProps) {
  const home = useCrewHome(props.commands);
  return home.definition === null ? (
    <CrewSheetReading error={props.commands.error} />
  ) : (
    <CrewmateForm {...props} definition={home.definition} save={home.save} />
  );
}

function CrewmateForm({
  onOpenChange,
  target,
  commands,
  applied,
  providers,
  devHosts,
  mateTint,
  crewPort,
  definition,
  save,
}: CrewmateSheetProps & {
  readonly definition: CrewDefinition;
  readonly save: CrewHomeRead["save"];
}) {
  const before = definition.members.find((member) => member.handle === target.handle);
  const lead = target.lead || before?.kind === "lead";
  const isApplied = target.handle !== null && applied.has(target.handle);
  const [draft, setDraft] = useState<Draft>(() =>
    before === undefined ? emptyDraft(target.lead) : draftOf(before),
  );
  /** `null` until the person picks one: the default follows the edit. */
  const [picked, setPicked] = useState<CrewApplyChoice | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const catalog = providers ?? [];
  const logins = crewLoginOptions(catalog);
  const models = crewModelOptions(catalog, draft.login);
  const efforts = crewEffortOptions(catalog, draft.login, draft.model);
  const tints = freeTints(definition, target.handle, mateTint);
  const loginChanged = before !== undefined && (before.login ?? "claudeAgent") !== draft.login;
  const rewritten = before !== undefined && jobChangedMostly(before.job, draft.job);
  const choice: CrewApplyChoice = loginChanged
    ? "fresh"
    : (picked ?? (rewritten ? "fresh" : "nextTurn"));
  const hostChoices =
    draft.host === "" || devHosts.includes(draft.host) ? devHosts : [...devHosts, draft.host];

  const handleTaken = definition.members.some(
    (member) => member.handle === draft.handle && member.handle !== target.handle,
  );
  const handleValid = CREW_HANDLE_PATTERN.test(draft.handle) && !handleTaken;
  const ready = draft.displayName.trim() !== "" && handleValid && !commands.pending;

  const submit = async (apply: CrewApplyChoice) => {
    if (!ready) return;
    const spec = specOf(draft, lead, before);
    const saved = await save(withMember(definition, target.handle, spec), [
      CREW_HOME_FILE,
      crewJobFile(spec.handle),
    ]);
    if (!saved) return;
    if (isApplied) {
      const sent = await commands.send({ _tag: "jobSave", handle: spec.handle, apply });
      if (sent === null) return;
    } else if (applied.size > 0 && (await commands.send({ _tag: "apply" })) === null) {
      return;
    }
    onOpenChange(false);
  };

  const writes = !lead && !draft.readOnly;
  return (
    <>
      <CrewSheetBody>
        <CrewField label="Name">
          <Input
            onChange={(event) => set("displayName", event.target.value)}
            value={draft.displayName}
          />
        </CrewField>
        <CrewField
          hint={
            isApplied
              ? "Fixed after Apply."
              : handleTaken
                ? "That handle is already taken."
                : "Lowercase letters, digits and dashes; fixed after Apply."
          }
          label="Handle"
        >
          <Input
            disabled={isApplied}
            onChange={(event) => set("handle", event.target.value.toLowerCase())}
            value={draft.handle}
          />
        </CrewField>
        {tints.length === 0 ? null : (
          <CrewField label="Tint">
            <span className="flex flex-wrap gap-2" role="radiogroup">
              {tints.map((tint) => (
                <button
                  aria-checked={draft.tint === tint}
                  aria-label={tint}
                  className="rounded-full p-0.5 ring-offset-2 ring-offset-background aria-checked:ring-2 aria-checked:ring-ring"
                  key={tint}
                  onClick={() => set("tint", tint)}
                  role="radio"
                  type="button"
                >
                  <MateFace size="sm" state="idle" tint={tint} />
                </button>
              ))}
            </span>
          </CrewField>
        )}
        <CrewField hint="Markdown: what this crewmate owns and how it works." label="Job">
          <Textarea
            onChange={(event) => set("job", event.target.value)}
            rows={6}
            value={draft.job}
          />
        </CrewField>
        <div className="space-y-3 rounded-md border border-border p-3">
          <span className="block text-sm font-medium text-foreground">Runs on</span>
          <CrewField label="Login">
            <Select
              onValueChange={(value) => {
                if (typeof value !== "string") return;
                setDraft((current) => ({ ...current, login: value, model: null, effort: null }));
              }}
              value={draft.login}
            >
              <SelectTrigger aria-label="Login" size="sm">
                <SelectValue>
                  {logins.find((login) => login.id === draft.login)?.label ?? draft.login}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {logins.map((login) => (
                  <SelectItem key={login.id} value={login.id}>
                    {login.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </CrewField>
          <CrewField label="Model">
            <Select
              onValueChange={(value) => {
                if (typeof value !== "string") return;
                setDraft((current) => ({
                  ...current,
                  model: value === LOGIN_DEFAULT ? null : value,
                  effort: null,
                }));
              }}
              value={draft.model ?? LOGIN_DEFAULT}
            >
              <SelectTrigger aria-label="Model" size="sm">
                <SelectValue>
                  {models.find((model) => model.slug === draft.model)?.name ??
                    "The login's default"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value={LOGIN_DEFAULT}>The login's default</SelectItem>
                {models.map((model) => (
                  <SelectItem key={model.slug} value={model.slug}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </CrewField>
          {efforts.length === 0 ? null : (
            <CrewField label="Effort">
              <Select
                onValueChange={(value) => {
                  if (typeof value !== "string") return;
                  set("effort", value === LOGIN_DEFAULT ? null : value);
                }}
                value={draft.effort ?? LOGIN_DEFAULT}
              >
                <SelectTrigger aria-label="Effort" size="sm">
                  <SelectValue>
                    {efforts.find((effort) => effort.id === draft.effort)?.label ??
                      "The model's default"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={LOGIN_DEFAULT}>The model's default</SelectItem>
                  {efforts.map((effort) => (
                    <SelectItem key={effort.id} value={effort.id}>
                      {effort.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </CrewField>
          )}
          {lead ? (
            <p className="text-xs text-muted-foreground">The lead is always read only.</p>
          ) : (
            <label className="flex items-start gap-3">
              <Switch
                checked={draft.readOnly}
                onCheckedChange={(checked) => set("readOnly", checked)}
              />
              <span className="space-y-0.5">
                <span className="block text-sm text-foreground">Read only</span>
                <span className="block text-xs text-muted-foreground">
                  No copy of the code, no writes: it reads files, changes and the board.
                </span>
              </span>
            </label>
          )}
        </div>
        {writes ? (
          <>
            <CrewField
              hint={crewPort === null ? undefined : `Crew port ${crewPort}`}
              label="Service"
            >
              <Select
                onValueChange={(value) => {
                  if (typeof value === "string") set("host", value);
                }}
                value={draft.host}
              >
                <SelectTrigger aria-label="Service" size="sm">
                  <SelectValue>{draft.host === "" ? "Pick a dev service" : draft.host}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {hostChoices.map((host) => (
                    <SelectItem key={host} value={host}>
                      {host}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </CrewField>
            <CrewField
              hint="Runs in its copy at Apply and when the lockfile moves."
              label="Setup command"
            >
              <Input
                onChange={(event) => set("setup", event.target.value)}
                placeholder="npm ci"
                value={draft.setup}
              />
            </CrewField>
            <CrewField hint="Runs in its copy on the tree that will land." label="Check command">
              <Input
                onChange={(event) => set("check", event.target.value)}
                placeholder="npm test"
                value={draft.check}
              />
            </CrewField>
            <CrewField hint="Its own app; $CREW_PORT is its crew port." label="Run command">
              <Input
                onChange={(event) => set("run", event.target.value)}
                placeholder="npm run dev -- --host 0.0.0.0 --port $CREW_PORT"
                value={draft.run}
              />
            </CrewField>
            <label className="flex items-center gap-3">
              <Switch
                checked={draft.restartAfterMerge}
                onCheckedChange={(checked) => set("restartAfterMerge", checked)}
              />
              <span className="text-sm text-foreground">Restart after merge</span>
            </label>
            <label className="flex items-center gap-3">
              <Switch
                checked={draft.afterLandRestart}
                onCheckedChange={(checked) => set("afterLandRestart", checked)}
              />
              <span className="text-sm text-foreground">After landing: restart the dev server</span>
            </label>
          </>
        ) : null}
      </CrewSheetBody>
      <CrewSheetFooter error={commands.error}>
        {rewritten && !loginChanged ? (
          <p className="text-xs text-muted-foreground">
            A large change to the job — a fresh conversation follows it better.
          </p>
        ) : null}
        {loginChanged ? (
          <p className="text-xs text-muted-foreground">
            Changing the login starts a fresh conversation. Memory and the handoff carry over.
          </p>
        ) : null}
        {isApplied ? (
          <CrewSaveButton
            choice={choice}
            disabled={!ready}
            onChoice={setPicked}
            onSave={(apply) => void submit(apply)}
            only={loginChanged ? ["fresh"] : undefined}
          />
        ) : (
          <Pill
            disabled={!ready}
            label={applied.size > 0 ? "Add and apply" : "Save"}
            onClick={() => void submit("nextTurn")}
          />
        )}
      </CrewSheetFooter>
    </>
  );
}
