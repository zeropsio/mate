/**
 * A crewmate's job, as a view of the Crew tab: who it is — its face, its
 * name, one of the Mate's crew or its lead — its job, what it does (Builds,
 * in its own copy of the Mate's code, or Reviews, changing nothing), and
 * under More its name and face, what it runs on, its service and its
 * commands. The handle is never shown: a new crewmate's comes from its name
 * (`crewHandleFor`) and stays once it stands. The two restart switches keep
 * their values in the crew home and leave the view.
 *
 * One Save: it picks up its new job with its next message, in a fresh
 * conversation (`jobSave` `nextTurn`); a changed login starts one now
 * (`fresh`). A crewmate added to a standing crew joins it at once (`apply`);
 * before the crew stands a save only writes its files. *Remove from the
 * crew* stands at the footer's far end.
 */
import {
  CREW_JOB_WORDS,
  CREW_MENU,
  CREW_VIEW_WORDS,
  crewBuildsLine,
  crewMoreSummary,
  crewOneOfWord,
  crewRemoveLine,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewDevHost, ServerProvider } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import {
  CREW_HOME_FILE,
  crewJobFile,
  type CrewDefinition,
  type CrewDefinitionIssue,
} from "@t3tools/shared/crewHome";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { Radio, RadioGroup } from "../../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import {
  crewHandleFor,
  crewmateDraftOf,
  crewmateSpecOf,
  emptyCrewmateDraft,
  withMember,
  type CrewmateDraft,
} from "../../../zerops/crew/crewHome";
import type { UseCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useCrewHome, type CrewHomeRead } from "../../../zerops/crew/useCrewHome";
import { MateFace } from "../primitives";
import {
  crewEffortOptions,
  crewLoginLabel,
  crewLoginNote,
  crewLoginOptions,
  crewModelOptions,
  crewRewriteBlockers,
  crewServiceHint,
  crewWriterWithoutHost,
  freeTints,
} from "./CrewEditors.logic";
import { CrewPress } from "./CrewParts";
import {
  CrewIssues,
  CrewTextArea,
  CrewView,
  CrewViewField,
  CrewViewFoot,
  CrewViewReading,
} from "./CrewView";

/** The select's value for "the login's own default". */
const LOGIN_DEFAULT = "default";

export interface CrewmateJobTarget {
  /** The crewmate's handle; `null` adds one. */
  readonly handle: string | null;
  /** Adding the lead. */
  readonly lead: boolean;
}

export interface CrewmateJobProps {
  readonly target: CrewmateJobTarget;
  readonly commands: UseCrewCommand;
  /** Handles the standing crew has: their handle is fixed and a save applies their job. */
  readonly applied: ReadonlySet<string>;
  /** The Mate's coding agents; `undefined` while its config is not read. */
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  /** The dev services a copy may live on, with whether each reaches a database. */
  readonly devHosts: ReadonlyArray<CrewDevHost>;
  readonly mateName: string;
  readonly mateTint: MateTintId | undefined;
  /** The crewmate's crew port on its service, when it has one. */
  readonly crewPort: number | null;
  readonly onClose: () => void;
  /** *Remove from the crew*, for a crewmate of the standing crew. */
  readonly onRemove: (handle: string) => void;
}

export function CrewmateJob(props: CrewmateJobProps) {
  const home = useCrewHome(props.commands);
  return (
    <CrewView onBack={props.onClose}>
      {home.definition === null ? (
        <CrewViewReading error={props.commands.error} />
      ) : (
        <JobForm
          {...props}
          blockers={crewRewriteBlockers(home.issues)}
          definition={home.definition}
          save={home.save}
        />
      )}
    </CrewView>
  );
}

function JobForm({
  target,
  commands,
  applied,
  providers,
  devHosts,
  mateName,
  mateTint,
  crewPort,
  onClose,
  onRemove,
  blockers,
  definition,
  save,
}: CrewmateJobProps & {
  readonly blockers: ReadonlyArray<CrewDefinitionIssue>;
  readonly definition: CrewDefinition;
  readonly save: CrewHomeRead["save"];
}) {
  const before = definition.members.find((member) => member.handle === target.handle);
  const lead = target.lead || before?.kind === "lead";
  const tints = freeTints(definition, target.handle, mateTint);
  const [draft, setDraft] = useState<CrewmateDraft>(() => {
    if (before !== undefined) return crewmateDraftOf(before);
    const empty = emptyCrewmateDraft(target.lead);
    const onlyHost = devHosts.length === 1 ? (devHosts[0]?.host ?? "") : "";
    return { ...empty, tint: tints[0], host: onlyHost };
  });
  const [more, setMore] = useState(false);
  const set = <K extends keyof CrewmateDraft>(key: K, value: CrewmateDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const isNew = before === undefined;
  const isApplied = target.handle !== null && applied.has(target.handle);
  const catalog = providers ?? [];
  const logins = crewLoginOptions(catalog, lead);
  const loginNote = crewLoginNote(logins, draft.login);
  const models = crewModelOptions(catalog, draft.login);
  const efforts = crewEffortOptions(catalog, draft.login, draft.model);
  const loginChanged = before !== undefined && (before.login ?? "claudeAgent") !== draft.login;
  const writes = !lead && !draft.readOnly;
  const hostNames = devHosts.map((host) => host.host);
  const hostChoices =
    draft.host === "" || hostNames.includes(draft.host) ? hostNames : [...hostNames, draft.host];
  const nameTaken = definition.members.some(
    (member) =>
      member.handle !== target.handle &&
      member.displayName.trim().toLowerCase() === draft.displayName.trim().toLowerCase(),
  );
  const noHost = crewWriterWithoutHost(writes, draft.host);
  const ready =
    draft.displayName.trim() !== "" &&
    !nameTaken &&
    !noHost &&
    blockers.length === 0 &&
    !commands.pending;
  const tint = draft.tint ?? "slate";
  const runsOnLabel = crewLoginLabel(logins, draft.login);
  // A builder with nowhere for its copy, or a name taken, opens More: that is where it is fixed.
  const moreOpen = more || (writes && noHost && devHosts.length > 1) || (!isNew && nameTaken);

  const submit = async () => {
    if (!ready) return;
    const handle =
      before?.handle ??
      crewHandleFor(draft.displayName, new Set(definition.members.map((member) => member.handle)));
    const spec = crewmateSpecOf({ ...draft, handle }, lead, before);
    const saved = await save(withMember(definition, target.handle, spec), [
      CREW_HOME_FILE,
      crewJobFile(spec.handle),
    ]);
    if (!saved) return;
    if (isApplied) {
      const apply = loginChanged ? "fresh" : "nextTurn";
      if ((await commands.send({ _tag: "jobSave", handle: spec.handle, apply })) === null) return;
    } else if (applied.size > 0 && (await commands.send({ _tag: "apply" })) === null) {
      return;
    }
    onClose();
  };

  return (
    <>
      <div className="mt-3 flex items-center gap-3" data-crew-job-head>
        <MateFace className="size-10" size="lg" state="idle" tint={tint} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-base leading-6">
            {draft.displayName.trim() === ""
              ? lead
                ? CREW_JOB_WORDS.newLeadTitle
                : CREW_JOB_WORDS.newTitle
              : draft.displayName}
          </span>
          <span className="text-line leading-4.5 text-muted-foreground">
            {crewOneOfWord(mateName, lead)}
          </span>
        </span>
      </div>
      {isNew ? (
        <CrewViewField gap={24} label={CREW_JOB_WORDS.name}>
          <NameField draft={draft} nameTaken={nameTaken} set={set} />
        </CrewViewField>
      ) : null}
      <CrewViewField gap={isNew ? 20 : 24} label={CREW_JOB_WORDS.job} line={CREW_JOB_WORDS.jobLine}>
        <CrewTextArea
          aria-label={CREW_JOB_WORDS.job}
          lines={4}
          onChange={(event) => set("job", event.target.value)}
          value={draft.job}
        />
      </CrewViewField>
      {lead ? null : (
        <div className="mt-6 flex flex-col" data-crew-job-does>
          <span className="font-medium text-sm leading-5">{CREW_JOB_WORDS.does}</span>
          <div className="mt-2.5">
            <RadioGroup
              aria-label={CREW_JOB_WORDS.does}
              onValueChange={(value) => set("readOnly", value === "reviews")}
              value={draft.readOnly ? "reviews" : "builds"}
            >
              <label className="flex cursor-pointer items-start gap-2.5">
                <Radio className="mt-0.5" value="builds" />
                <span className="flex flex-col">
                  <span className="text-sm">{CREW_JOB_WORDS.builds}</span>
                  <span className="text-line leading-4.5 text-muted-foreground">
                    {crewBuildsLine(mateName)}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5">
                <Radio className="mt-0.5" value="reviews" />
                <span className="flex flex-col">
                  <span className="text-sm">{CREW_JOB_WORDS.reviews}</span>
                  <span className="text-line leading-4.5 text-muted-foreground">
                    {CREW_JOB_WORDS.reviewsLine}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
        </div>
      )}
      <button
        aria-expanded={moreOpen}
        className="crew-option mt-6"
        data-crew-job-more
        data-more=""
        onClick={() => setMore((open) => !open)}
        type="button"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-sm leading-5">{CREW_JOB_WORDS.more}</span>
          {moreOpen ? null : (
            <span className="truncate text-line leading-4.5 text-muted-foreground">
              {crewMoreSummary({
                runsOn: runsOnLabel,
                check: writes && draft.check.trim() !== "" ? draft.check.trim() : null,
                run: writes && draft.run.trim() !== "" ? draft.run.trim() : null,
              })}
            </span>
          )}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={
            moreOpen ? "size-4 rotate-180 text-muted-foreground" : "size-4 text-muted-foreground"
          }
        />
      </button>
      {moreOpen ? (
        <div className="flex flex-col" data-crew-job-more-open>
          {isNew ? null : (
            <CrewViewField label={CREW_JOB_WORDS.name}>
              <NameField draft={draft} nameTaken={nameTaken} set={set} />
            </CrewViewField>
          )}
          {tints.length === 0 ? null : (
            <CrewViewField label={CREW_JOB_WORDS.face}>
              <span className="flex flex-wrap gap-2" role="radiogroup">
                {tints.map((option) => (
                  <button
                    aria-checked={draft.tint === option}
                    aria-label={option}
                    className="rounded-full p-0.5 ring-offset-2 ring-offset-background aria-checked:ring-2 aria-checked:ring-ring"
                    key={option}
                    onClick={() => set("tint", option)}
                    role="radio"
                    type="button"
                  >
                    <MateFace size="md" state="idle" tint={option} />
                  </button>
                ))}
              </span>
            </CrewViewField>
          )}
          <CrewViewField label={CREW_JOB_WORDS.runsOn} line={loginNote}>
            <div className="flex flex-col gap-2">
              <Select
                onValueChange={(value) => {
                  if (typeof value !== "string") return;
                  setDraft((current) => ({ ...current, login: value, model: null, effort: null }));
                }}
                value={draft.login}
              >
                <SelectTrigger aria-label={CREW_JOB_WORDS.login} size="sm">
                  <SelectValue>{runsOnLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {logins.map((login) => (
                    <SelectItem key={login.id} value={login.id}>
                      {login.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
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
                <SelectTrigger aria-label={CREW_JOB_WORDS.model} size="sm">
                  <SelectValue>
                    {models.find((model) => model.slug === draft.model)?.name ??
                      CREW_JOB_WORDS.loginDefault}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={LOGIN_DEFAULT}>{CREW_JOB_WORDS.loginDefault}</SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model.slug} value={model.slug}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {efforts.length === 0 ? null : (
                <Select
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    set("effort", value === LOGIN_DEFAULT ? null : value);
                  }}
                  value={draft.effort ?? LOGIN_DEFAULT}
                >
                  <SelectTrigger aria-label={CREW_JOB_WORDS.effort} size="sm">
                    <SelectValue>
                      {efforts.find((effort) => effort.id === draft.effort)?.label ??
                        CREW_JOB_WORDS.modelDefault}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={LOGIN_DEFAULT}>{CREW_JOB_WORDS.modelDefault}</SelectItem>
                    {efforts.map((effort) => (
                      <SelectItem key={effort.id} value={effort.id}>
                        {effort.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              )}
            </div>
          </CrewViewField>
          {writes && (hostChoices.length !== 1 || noHost) ? (
            <CrewViewField
              label={CREW_JOB_WORDS.service}
              line={crewServiceHint(devHosts, draft.host, crewPort, mateName)}
            >
              <Select
                onValueChange={(value) => {
                  if (typeof value === "string") set("host", value);
                }}
                value={draft.host}
              >
                <SelectTrigger aria-label={CREW_JOB_WORDS.service} size="sm">
                  <SelectValue>{draft.host}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {hostChoices.map((host) => (
                    <SelectItem key={host} value={host}>
                      {host}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </CrewViewField>
          ) : null}
          {writes ? (
            <>
              <CrewViewField label={CREW_JOB_WORDS.setup}>
                <input
                  aria-label={CREW_JOB_WORDS.setup}
                  className="crew-field font-mono"
                  data-line=""
                  onChange={(event) => set("setup", event.target.value)}
                  placeholder="npm ci"
                  value={draft.setup}
                />
              </CrewViewField>
              <CrewViewField label={CREW_JOB_WORDS.check}>
                <input
                  aria-label={CREW_JOB_WORDS.check}
                  className="crew-field font-mono"
                  data-line=""
                  onChange={(event) => set("check", event.target.value)}
                  placeholder="npm test"
                  value={draft.check}
                />
              </CrewViewField>
              <CrewViewField label={CREW_JOB_WORDS.run}>
                <input
                  aria-label={CREW_JOB_WORDS.run}
                  className="crew-field font-mono"
                  data-line=""
                  onChange={(event) => set("run", event.target.value)}
                  placeholder="npm run dev -- --host 0.0.0.0 --port $CREW_PORT"
                  value={draft.run}
                />
              </CrewViewField>
            </>
          ) : null}
        </div>
      ) : null}
      <CrewViewFoot>
        <CrewIssues issues={blockers} />
        {commands.error === null ? null : (
          <p className="text-line leading-4.5 text-status-failed-text" role="alert">
            {commands.error}
          </p>
        )}
        <span className="text-line leading-4.5 text-muted-foreground">
          {loginChanged ? CREW_JOB_WORDS.freshLine : CREW_JOB_WORDS.saveLine}
        </span>
        <span className="flex items-center gap-1.5">
          <CrewPress
            disabled={!ready}
            label={isNew && applied.size > 0 ? CREW_JOB_WORDS.add : CREW_VIEW_WORDS.save}
            onPress={() => void submit()}
            size="view"
          />
          <CrewPress label={CREW_VIEW_WORDS.cancel} onPress={onClose} size="view" tone="muted" />
          <span className="grow" />
          {isApplied && target.handle !== null ? (
            <CrewPress
              label={CREW_MENU.removeFromCrew}
              line={crewRemoveLine(mateName)}
              onPress={() => {
                if (target.handle !== null) onRemove(target.handle);
              }}
              size="view"
              tone="failed"
            />
          ) : null}
        </span>
      </CrewViewFoot>
    </>
  );
}

function NameField({
  draft,
  nameTaken,
  set,
}: {
  readonly draft: CrewmateDraft;
  readonly nameTaken: boolean;
  readonly set: <K extends keyof CrewmateDraft>(key: K, value: CrewmateDraft[K]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <input
        aria-label={CREW_JOB_WORDS.name}
        className="crew-field"
        data-line=""
        onChange={(event) => set("displayName", event.target.value)}
        value={draft.displayName}
      />
      {nameTaken ? (
        <span className="text-line leading-4.5 text-status-failed-text">
          {CREW_JOB_WORDS.nameTaken}
        </span>
      ) : null}
    </div>
  );
}
