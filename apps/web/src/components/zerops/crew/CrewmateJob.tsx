/**
 * A crewmate's job, as a view of the Crew tab: who it is — its face, its
 * name, one of the Mate's crew or its lead — its job, what it does (Builds,
 * in its own copy of the Mate's code, or Reviews, changing nothing), and
 * under More its name and face, what it runs on, its service and its
 * commands. The handle is never shown: a new crewmate's comes from its name
 * (`crewHandleFor`) and stays once it stands. The two restart switches keep
 * their values in the crew home and leave the view.
 *
 * One Save: a running crewmate picks up its new job with its next message, in a fresh
 * conversation (`jobSave` `nextTurn`); a changed login starts one now
 * (`fresh`). A crewmate added to a standing crew joins it at once (`apply`);
 * before the crew stands a save only writes its files. *Remove from the
 * crew* stands at the footer's far end. A login the viewer may not run is
 * not saved onto a crewmate (D6): Save waits, saying why.
 */
import { Text } from "~/components/ui/text";
import type { CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import {
  CREW_JOB_WORDS,
  CREW_MENU,
  CREW_VIEW_WORDS,
  crewBuildsLine,
  crewLockWords,
  crewMoreSummary,
  crewRoleWord,
  crewPoolOptionWord,
  crewRemoveLine,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewDevHost, ServerProvider } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import {
  CREW_HOME_FILE,
  crewJobFile,
  crewTints,
  withSharedDatabase,
  type CrewDefinition,
  type CrewDefinitionIssue,
} from "@t3tools/shared/crewHome";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { Failure } from "../../ui/failure";
import { Input } from "../../ui/input";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group";
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
  crewJobFootLine,
  crewLoginLabel,
  crewLoginNote,
  crewLoginOptions,
  crewModelOptions,
  crewRewriteBlockers,
  crewServiceHint,
  crewWriterWithoutHost,
  crewmateSaveCommand,
  freeTints,
} from "./CrewEditors.logic";
import { CrewChoice, CrewPress } from "./CrewParts";
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

interface CrewmateJobTarget {
  /** The crewmate's handle; `null` adds one. */
  readonly handle: string | null;
  /** Adding the lead. */
  readonly lead: boolean;
}

interface CrewmateJobProps {
  readonly target: CrewmateJobTarget;
  readonly commands: UseCrewCommand;
  /** Handles the standing crew has: their handle is fixed and a save applies their job. */
  readonly applied: ReadonlySet<string>;
  /** The crew stands, even with nobody on it: a crewmate it lacks joins at Save. */
  readonly crewApplied: boolean;
  /** The Mate's coding agents; `undefined` while its config is not read. */
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  /** The dev services a copy may live on, with whether each reaches a database. */
  readonly devHosts: ReadonlyArray<CrewDevHost>;
  readonly pools: ReadonlyArray<string> | undefined;
  readonly mateName: string;
  readonly mateTint: MateTintId | undefined;
  /** The crewmate's crew port on its service, when it has one. */
  readonly crewPort: number | null;
  readonly onClose: () => void;
  /** *Remove from the crew*, for a crewmate of the standing crew. */
  readonly onRemove: (handle: string) => void;
  /** What a Save onto `login` meets for this viewer (D6); `null` where it is theirs. */
  readonly saveLock?: (login: string) => CrewLock | null;
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
  crewApplied,
  providers,
  devHosts,
  pools,
  mateName,
  mateTint,
  crewPort,
  onClose,
  onRemove,
  saveLock,
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
    return { ...emptyCrewmateDraft(target.lead), tint: tints[0] };
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
  const poolNames = pools ?? [];
  const poolChoices =
    draft.pool === "" || poolNames.includes(draft.pool) ? poolNames : [...poolNames, draft.pool];
  // A builder with nowhere for its copy takes the one place there is: a new one, or one drafted
  // before the services were read, and topology may arrive after its form opens.
  if (writes && !draft.host && !draft.pool && hostNames.length + poolNames.length === 1) {
    setDraft({
      ...draft,
      host: hostNames[0] ?? "",
      pool: hostNames[0] === undefined ? poolNames[0]! : "",
    });
  }
  const nameTaken = definition.members.some(
    (member) =>
      member.handle !== target.handle &&
      member.displayName.trim().toLowerCase() === draft.displayName.trim().toLowerCase(),
  );
  const noHost = crewWriterWithoutHost(writes, draft.host, draft.pool);
  const lock = saveLock?.(draft.login) ?? null;
  const ready =
    draft.displayName.trim() !== "" &&
    !nameTaken &&
    !noHost &&
    blockers.length === 0 &&
    lock === null &&
    !commands.pending;
  // A crewmate its crew.yaml gives no tint wears the one every surface gives it (`crewTints`).
  const tint =
    draft.tint ??
    (target.handle === null
      ? undefined
      : crewTints(definition.members, mateTint).get(target.handle)) ??
    "slate";
  const runsOnLabel = crewLoginLabel(logins, draft.login);
  // A builder with nowhere for its copy, or a name taken, opens More: that is where it is fixed.
  const moreOpen =
    more || (writes && noHost && devHosts.length + poolNames.length > 1) || (!isNew && nameTaken);

  const submit = async () => {
    if (!ready) return;
    const handle =
      before?.handle ??
      crewHandleFor(draft.displayName, new Set(definition.members.map((member) => member.handle)));
    const spec = crewmateSpecOf({ ...draft, handle }, lead, before);
    // A builder on a service with a database shares it, as the setup writes one.
    const databaseHosts = devHosts.flatMap((host) => (host.database === true ? [host.host] : []));
    const saved = await save(
      withSharedDatabase(withMember(definition, target.handle, spec), databaseHosts),
      [CREW_HOME_FILE, crewJobFile(spec.handle)],
    );
    if (!saved) return;
    const command = crewmateSaveCommand({
      handle: spec.handle,
      onRoster: isApplied,
      crewApplied,
      loginChanged,
    });
    if (command !== null && (await commands.send(command)) === null) return;
    onClose();
  };

  return (
    <>
      <div className="mt-3 flex items-center gap-3" data-crew-job-head>
        <MateFace size={32} state="idle" tint={tint} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-emphasis">
            {draft.displayName.trim() === ""
              ? lead
                ? CREW_JOB_WORDS.newLeadTitle
                : CREW_JOB_WORDS.newTitle
              : draft.displayName}
          </span>
          <span className="text-line leading-4.5 text-muted-foreground">
            {crewRoleWord(mateName, lead ? "lead" : draft.readOnly ? "reader" : "writer")}
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
          <span className="font-medium text-body leading-5">{CREW_JOB_WORDS.does}</span>
          <div className="mt-2.5">
            <RadioGroup
              aria-label={CREW_JOB_WORDS.does}
              onValueChange={(value) => set("readOnly", value === "reviews")}
              value={draft.readOnly ? "reviews" : "builds"}
            >
              <label className="flex cursor-pointer items-start gap-2.5">
                <Radio className="mt-0.5" value="builds" />
                <span className="flex flex-col">
                  <span className="text-body">{CREW_JOB_WORDS.builds}</span>
                  <span className="text-line leading-4.5 text-muted-foreground">
                    {crewBuildsLine(mateName)}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5">
                <Radio className="mt-0.5" value="reviews" />
                <span className="flex flex-col">
                  <span className="text-body">{CREW_JOB_WORDS.reviews}</span>
                  <span className="text-line leading-4.5 text-muted-foreground">
                    {CREW_JOB_WORDS.reviewsLine}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
        </div>
      )}
      <div className="mt-6">
        <CrewChoice
          end={
            <ChevronDownIcon
              aria-hidden="true"
              className={moreOpen ? "size-4 rotate-180" : "size-4"}
            />
          }
          line={
            moreOpen
              ? null
              : crewMoreSummary({
                  runsOn: runsOnLabel,
                  place: writes ? draft.pool || draft.host || null : null,
                  check: writes && draft.check.trim() !== "" ? draft.check.trim() : null,
                  run: writes && draft.run.trim() !== "" ? draft.run.trim() : null,
                })
          }
          render={
            <button
              aria-expanded={moreOpen}
              data-crew-job-more=""
              onClick={() => setMore((open) => !open)}
              type="button"
            />
          }
          title={CREW_JOB_WORDS.more}
        />
      </div>
      {moreOpen ? (
        <div className="flex flex-col" data-crew-job-more-open>
          {isNew ? null : (
            <CrewViewField label={CREW_JOB_WORDS.name}>
              <NameField draft={draft} nameTaken={nameTaken} set={set} />
            </CrewViewField>
          )}
          {tints.length === 0 ? null : (
            <CrewViewField label={CREW_JOB_WORDS.face}>
              <ToggleGroup
                aria-label={CREW_JOB_WORDS.face}
                className="flex-wrap"
                onValueChange={(picked) => {
                  const tint = tints.find((option) => picked.includes(option));
                  if (tint !== undefined) set("tint", tint);
                }}
                size="lg"
                value={draft.tint ? [draft.tint] : []}
                variant="ghost"
              >
                {tints.map((option) => (
                  <ToggleGroupItem aria-label={option} key={option} value={option}>
                    <MateFace size={24} state="idle" tint={option} />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </CrewViewField>
          )}
          {/* What it is told past its job: one place for the job, the row's words (run 2). */}
          <CrewViewField label={CREW_JOB_WORDS.howItWorks} line={CREW_JOB_WORDS.howItWorksLine}>
            <CrewTextArea
              aria-label={CREW_JOB_WORDS.howItWorks}
              lines={4}
              onChange={(event) => set("howItWorks", event.target.value)}
              value={draft.howItWorks}
            />
          </CrewViewField>
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
          {writes && (hostChoices.length !== 1 || poolChoices.length > 0 || noHost) ? (
            <CrewViewField
              label={CREW_JOB_WORDS.service}
              line={crewServiceHint(devHosts, draft.host, crewPort, mateName, pools, draft.pool)}
            >
              <Select
                onValueChange={(value) => {
                  if (typeof value !== "string") return;
                  const place = value.startsWith("pool:")
                    ? { host: "", pool: value.slice(5) }
                    : { host: value, pool: "" };
                  setDraft((current) => ({ ...current, ...place }));
                }}
                value={draft.pool ? `pool:${draft.pool}` : draft.host}
              >
                <SelectTrigger aria-label={CREW_JOB_WORDS.service} size="sm">
                  <SelectValue>
                    {draft.pool ? crewPoolOptionWord(draft.pool) : draft.host}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {hostChoices.map((host) => (
                    <SelectItem key={host} value={host}>
                      {host}
                    </SelectItem>
                  ))}
                  {poolChoices.map((pool) => (
                    <SelectItem key={`pool:${pool}`} value={`pool:${pool}`}>
                      {crewPoolOptionWord(pool)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </CrewViewField>
          ) : null}
          {writes ? (
            <>
              <CrewViewField label={CREW_JOB_WORDS.setup}>
                <Input
                  aria-label={CREW_JOB_WORDS.setup}
                  font="mono"
                  size="lg"
                  onChange={(event) => set("setup", event.target.value)}
                  placeholder="npm ci"
                  value={draft.setup}
                />
              </CrewViewField>
              <CrewViewField label={CREW_JOB_WORDS.check}>
                <Input
                  aria-label={CREW_JOB_WORDS.check}
                  font="mono"
                  size="lg"
                  onChange={(event) => set("check", event.target.value)}
                  placeholder="npm test"
                  value={draft.check}
                />
              </CrewViewField>
              <CrewViewField label={CREW_JOB_WORDS.run}>
                <Input
                  aria-label={CREW_JOB_WORDS.run}
                  font="mono"
                  size="lg"
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
          <Failure cause={commands.error} role="alert" size="line" />
        )}
        <span className="text-line leading-4.5 text-muted-foreground">
          {lock !== null
            ? crewLockWords(lock.ownership)
            : crewJobFootLine({ applied: isApplied, crewApplied, loginChanged })}
        </span>
        <span className="flex items-center gap-1.5">
          <CrewPress
            disabled={!ready}
            label={!isApplied && crewApplied ? CREW_JOB_WORDS.add : CREW_VIEW_WORDS.save}
            onPress={() => void submit()}
            size="md"
          />
          <CrewPress label={CREW_VIEW_WORDS.cancel} onPress={onClose} size="md" variant="ghost" />
          <span className="grow" />
          {isApplied && target.handle !== null ? (
            <CrewPress
              label={CREW_MENU.removeFromCrew}
              line={crewRemoveLine(mateName)}
              onPress={() => {
                if (target.handle !== null) onRemove(target.handle);
              }}
              size="md"
              variant="destructive"
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
      <Input
        aria-label={CREW_JOB_WORDS.name}
        size="lg"
        onChange={(event) => set("displayName", event.target.value)}
        value={draft.displayName}
      />
      {nameTaken ? (
        <Text role="alert" variant="error">
          {CREW_JOB_WORDS.nameTaken}
        </Text>
      ) : null}
    </div>
  );
}
