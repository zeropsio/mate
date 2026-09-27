/**
 * CrewDefinition — the crew home: its file format, its parser and its
 * validation. Pure: the caller reads and writes the files.
 *
 * ## The crew home
 *
 * A crew lives in one directory on the zcp container, next to the Mate's own
 * tree and outside every dev service:
 *
 * ```
 * <workspaceRoot>/.mate/crew/<crew>/      workspaceRoot = ServerConfig.cwd (/var/www)
 *   crew.yaml                             the team: name, brief title, members
 *   brief.md                              the brief's body (at most 16,000 characters)
 *   jobs/<handle>.md                      one job per crewmate
 * ```
 *
 * `<crew>` is the crew's id; it follows `CREW_HANDLE_PATTERN` because it names
 * `refs/t3/crew-state/<crew>` and every stint thread key. The same three files
 * are what `zerops.crew.files.get`/`put` carry and what the crew-state ref
 * mirrors, keyed by the relative paths above.
 *
 * ### crew.yaml
 *
 * ```yaml
 * name: Game team                   # the crew's display name
 * briefTitle: Space shooter MVP     # the brief's title (brief.md holds only its body)
 * members:
 *   - handle: backend               # required; CREW_HANDLE_PATTERN; unique; fixed after Apply
 *     displayName: Backend          # required; free to rename
 *     kind: writer                  # writer (default) | reader | lead
 *     readOnly: false               # the editor's switch; true makes a writer a reader
 *     tint: sky                     # one of MATE_TINT_IDS; unset = assigned by the client
 *     host: appdev                  # writers only: the dev service that holds its copy
 *     setup: npm ci                 # run in its copy at Apply and when the lockfile moves
 *     check: npm test               # run in its copy on the tree that will land
 *     run: npm run dev -- --port $CREW_PORT   # its own app on its crew port
 *     restartAfterMerge: false      # restart its app after a merge-in or a landing
 *     afterLandRestart: false       # after landing, restart the dev server from the tree
 *     login: claudeAgent            # provider instance id; unset = the Mate's default
 *     model: claude-opus-5-5        # unset = the login's default
 *     effort: high                  # unset = the login's default
 *     env: { DATABASE_URL: … }      # writers on a service with a database: env or …
 *     database: shared              # … this, never neither
 *     migrations: [migrations/**]   # paths only this crewmate may write (globs, repo-relative)
 *     context: 200000               # context window, 100,000–1,000,000
 *     rotateAfter: 3                # compactions before a fresh conversation; 0 = never
 * ```
 *
 * `kind` and `readOnly` are one fact written two ways: `readOnly: true` on a
 * member without a kind makes a reader, a lead is always read-only, and a
 * contradiction (`kind: writer` with `readOnly: true`) is an issue.
 *
 * ### brief.md
 *
 * Markdown. Two optional sections are read back out of it: `## Binding
 * decisions` (kept as written) and `## Done when` (one item per non-empty line,
 * list markers dropped). The whole file is the brief's text.
 *
 * ## A writer's copy of the code
 *
 * A writer's lane is branch `crew/<handle>` checked out in `.crew/<handle>`
 * inside its service's tree (PRD Δ11): `<remotePath>/.crew/<handle>` on the
 * service, `<mountPath>/.crew/<handle>` through the zcp container's mount.
 * `crewLane` derives both from the service's `ZeropsRepository`, never from a
 * literal `/var/www`.
 *
 * ## Validation
 *
 * `parseCrewHome` reports what the files alone can tell (shape, handles, at
 * most one lead, no host on a read-only crewmate, the brief's length, a job per
 * crewmate). `validateCrewTopology` adds what needs the project: a writer's
 * host is a dev service, and a writer on a service with a database declares
 * `env:` or `database: shared` (PRD §5.1). Apply needs both to be empty.
 *
 * @module CrewDefinition
 */
import { CREW_HANDLE_PATTERN, type CrewHandle, type CrewMemberKind } from "@t3tools/contracts";
import { MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { ZeropsRepository } from "../ZeropsRepositorySource.ts";

export const CREW_HOME_FILE = "crew.yaml";
export const CREW_BRIEF_FILE = "brief.md";
export const CREW_BRIEF_MAX_CHARS = 16_000;
export const CREW_CONTEXT_MIN = 100_000;
export const CREW_CONTEXT_MAX = 1_000_000;

export const crewJobFile = (handle: string): string => `jobs/${handle}.md`;

/** The crew home directory for crew `crew` under the zcp container's workspace root. */
export const crewHomeDir = (workspaceRoot: string, crew: string): string =>
  `${workspaceRoot.replace(/\/+$/u, "")}/.mate/crew/${crew}`;

/** A writer's copy of the code, in both of the paths that reach it. */
export interface CrewLane {
  readonly host: string;
  readonly handle: string;
  readonly branch: string;
  /** The service's tree through the zcp container's mount (`/var/www/<host>`). */
  readonly mountRoot: string;
  readonly mountDir: string;
  /** The service's tree on the service itself (`/var/www`). */
  readonly remoteRoot: string;
  readonly remoteDir: string;
}

export const crewLane = (
  repository: Pick<ZeropsRepository, "host" | "mountPath" | "remotePath">,
  handle: string,
): CrewLane => ({
  host: repository.host,
  handle,
  branch: `crew/${handle}`,
  mountRoot: repository.mountPath,
  mountDir: `${repository.mountPath}/.crew/${handle}`,
  remoteRoot: repository.remotePath,
  remoteDir: `${repository.remotePath}/.crew/${handle}`,
});

export interface CrewHomeFile {
  readonly path: string;
  readonly content: string;
}

export interface CrewBrief {
  readonly title: string;
  readonly text: string;
  readonly bindingDecisions?: string;
  readonly doneWhen: ReadonlyArray<string>;
}

export interface CrewMemberSpec {
  readonly handle: CrewHandle;
  readonly displayName: string;
  readonly kind: CrewMemberKind;
  readonly readOnly: boolean;
  readonly tint?: MateTintId;
  readonly host?: string;
  readonly setup?: string;
  readonly check?: string;
  readonly run?: string;
  readonly restartAfterMerge: boolean;
  readonly afterLandRestart: boolean;
  readonly login?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly database?: "shared";
  readonly migrations: ReadonlyArray<string>;
  readonly context?: number;
  readonly rotateAfter?: number;
  readonly job: string;
}

export interface CrewDefinition {
  readonly crew: string;
  readonly name: string;
  readonly brief: CrewBrief;
  readonly members: ReadonlyArray<CrewMemberSpec>;
}

export type CrewDefinitionIssueCode =
  | "crew-id"
  | "file-missing"
  | "yaml"
  | "field-type"
  | "field-missing"
  | "field-unknown"
  | "handle-pattern"
  | "handle-duplicate"
  | "lead-multiple"
  | "kind-conflict"
  | "host-missing"
  | "host-on-read-only"
  | "host-unknown"
  | "database-undeclared"
  | "database-and-env"
  | "brief-too-long"
  | "context-range";

export interface CrewDefinitionIssue {
  readonly code: CrewDefinitionIssueCode;
  /** The file the issue is in, relative to the crew home. */
  readonly path: string;
  readonly handle?: string;
  readonly message: string;
}

export interface CrewHomeParse {
  /** Present when the files could be read into a definition, even with issues. */
  readonly definition: CrewDefinition | undefined;
  readonly issues: ReadonlyArray<CrewDefinitionIssue>;
}

const MEMBER_FIELDS = new Set([
  "handle",
  "displayName",
  "kind",
  "readOnly",
  "tint",
  "host",
  "setup",
  "check",
  "run",
  "restartAfterMerge",
  "afterLandRestart",
  "login",
  "model",
  "effort",
  "env",
  "database",
  "migrations",
  "context",
  "rotateAfter",
]);
const CREW_FIELDS = new Set(["name", "briefTitle", "members"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

type Issues = Array<CrewDefinitionIssue>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read `brief.md`'s two optional sections out of its markdown. */
export const parseBrief = (title: string, text: string): CrewBrief => {
  const sections = new Map<string, Array<string>>();
  let current: Array<string> | undefined;
  for (const line of text.split(/\r?\n/u)) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading) {
      current = [];
      sections.set(heading[1]!.toLowerCase(), current);
    } else {
      current?.push(line);
    }
  }
  const binding = sections.get("binding decisions")?.join("\n").trim();
  const doneWhen = (sections.get("done when") ?? [])
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "").trim())
    .filter((line) => line.length > 0);
  return {
    title,
    text,
    ...(binding ? { bindingDecisions: binding } : {}),
    doneWhen,
  };
};

const readString = (
  source: Record<string, unknown>,
  field: string,
  path: string,
  issues: Issues,
  handle?: string,
): string | undefined => {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  issues.push({
    code: "field-type",
    path,
    ...(handle ? { handle } : {}),
    message: `${field} must be text.`,
  });
  return undefined;
};

const readBoolean = (
  source: Record<string, unknown>,
  field: string,
  path: string,
  issues: Issues,
  handle: string,
): boolean | undefined => {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  issues.push({ code: "field-type", path, handle, message: `${field} must be true or false.` });
  return undefined;
};

const readInteger = (
  source: Record<string, unknown>,
  field: string,
  path: string,
  issues: Issues,
  handle: string,
): number | undefined => {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  issues.push({ code: "field-type", path, handle, message: `${field} must be a whole number.` });
  return undefined;
};

const resolveKind = (
  kind: string | undefined,
  readOnly: boolean | undefined,
  path: string,
  handle: string,
  issues: Issues,
): CrewMemberKind => {
  if (kind !== undefined && kind !== "writer" && kind !== "reader" && kind !== "lead") {
    issues.push({
      code: "field-type",
      path,
      handle,
      message: "kind must be writer, reader or lead.",
    });
    return readOnly ? "reader" : "writer";
  }
  const resolved: CrewMemberKind = kind ?? (readOnly ? "reader" : "writer");
  if (readOnly !== undefined && readOnly !== (resolved !== "writer")) {
    issues.push({
      code: "kind-conflict",
      path,
      handle,
      message: `${handle} is a ${resolved} but says readOnly: ${readOnly}.`,
    });
  }
  return resolved;
};

const parseMember = (
  raw: unknown,
  index: number,
  jobs: ReadonlyMap<string, string>,
  issues: Issues,
): CrewMemberSpec | undefined => {
  const path = CREW_HOME_FILE;
  if (!isRecord(raw)) {
    issues.push({ code: "field-type", path, message: `members[${index}] must be a mapping.` });
    return undefined;
  }
  const handle = readString(raw, "handle", path, issues);
  if (handle === undefined) {
    issues.push({ code: "field-missing", path, message: `members[${index}] has no handle.` });
    return undefined;
  }
  for (const field of Object.keys(raw)) {
    if (!MEMBER_FIELDS.has(field)) {
      issues.push({ code: "field-unknown", path, handle, message: `Unknown field ${field}.` });
    }
  }
  if (!CREW_HANDLE_PATTERN.test(handle)) {
    issues.push({
      code: "handle-pattern",
      path,
      handle,
      message: `Handle "${handle}" must be 1–20 lowercase letters, digits or dashes.`,
    });
  }
  const displayName = readString(raw, "displayName", path, issues, handle);
  if (displayName === undefined || displayName.trim() === "") {
    issues.push({ code: "field-missing", path, handle, message: `${handle} has no displayName.` });
  }
  const readOnly = readBoolean(raw, "readOnly", path, issues, handle);
  const kind = resolveKind(
    readString(raw, "kind", path, issues, handle),
    readOnly,
    path,
    handle,
    issues,
  );

  const tint = readString(raw, "tint", path, issues, handle);
  if (tint !== undefined && !(MATE_TINT_IDS as ReadonlyArray<string>).includes(tint)) {
    issues.push({
      code: "field-type",
      path,
      handle,
      message: `tint must be one of ${MATE_TINT_IDS.join(", ")}.`,
    });
  }

  const envRaw = raw.env;
  const env: Record<string, string> = {};
  if (envRaw !== undefined && envRaw !== null) {
    if (!isRecord(envRaw)) {
      issues.push({ code: "field-type", path, handle, message: "env must be a mapping." });
    } else {
      for (const [name, value] of Object.entries(envRaw)) {
        if (!ENV_NAME.test(name) || (typeof value !== "string" && typeof value !== "number")) {
          issues.push({
            code: "field-type",
            path,
            handle,
            message: `env ${name} must be a variable name with a text value.`,
          });
        } else {
          env[name] = String(value);
        }
      }
    }
  }

  const database = readString(raw, "database", path, issues, handle);
  if (database !== undefined && database !== "shared") {
    issues.push({ code: "field-type", path, handle, message: "database can only be shared." });
  }
  if (database === "shared" && Object.keys(env).length > 0) {
    issues.push({
      code: "database-and-env",
      path,
      handle,
      message: `${handle} declares both env and database: shared; keep one.`,
    });
  }

  const migrationsRaw = raw.migrations;
  const migrations: Array<string> = [];
  if (migrationsRaw !== undefined && migrationsRaw !== null) {
    if (
      !Array.isArray(migrationsRaw) ||
      !migrationsRaw.every((entry) => typeof entry === "string")
    ) {
      issues.push({
        code: "field-type",
        path,
        handle,
        message: "migrations must be a list of paths.",
      });
    } else {
      migrations.push(...migrationsRaw);
    }
  }

  const context = readInteger(raw, "context", path, issues, handle);
  if (context !== undefined && (context < CREW_CONTEXT_MIN || context > CREW_CONTEXT_MAX)) {
    issues.push({
      code: "context-range",
      path,
      handle,
      message: `context must be between ${CREW_CONTEXT_MIN} and ${CREW_CONTEXT_MAX}.`,
    });
  }

  const host = readString(raw, "host", path, issues, handle);
  if (kind === "writer" && host === undefined) {
    issues.push({
      code: "host-missing",
      path,
      handle,
      message: `${handle} changes files, so it needs a host for its copy of the code.`,
    });
  }
  if (kind !== "writer" && host !== undefined) {
    issues.push({
      code: "host-on-read-only",
      path,
      handle,
      message: `${handle} is read-only and has no copy of the code; remove its host.`,
    });
  }

  const job = jobs.get(handle);
  if (job === undefined) {
    issues.push({
      code: "file-missing",
      path: crewJobFile(handle),
      handle,
      message: `${handle} has no job: ${crewJobFile(handle)} is missing.`,
    });
  }

  const optional = {
    tint: tint as MateTintId | undefined,
    host,
    setup: readString(raw, "setup", path, issues, handle),
    check: readString(raw, "check", path, issues, handle),
    run: readString(raw, "run", path, issues, handle),
    login: readString(raw, "login", path, issues, handle),
    model: readString(raw, "model", path, issues, handle),
    effort: readString(raw, "effort", path, issues, handle),
    database: database === "shared" ? ("shared" as const) : undefined,
    context,
    rotateAfter: readInteger(raw, "rotateAfter", path, issues, handle),
  };
  return {
    handle,
    displayName: displayName ?? handle,
    kind,
    readOnly: kind !== "writer",
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    restartAfterMerge: readBoolean(raw, "restartAfterMerge", path, issues, handle) ?? false,
    afterLandRestart: readBoolean(raw, "afterLandRestart", path, issues, handle) ?? false,
    env,
    migrations,
    job: job ?? "",
  };
};

/** Write a definition as crew home files, leaving out every field at its default. */
export const renderCrewHome = (definition: CrewDefinition): ReadonlyArray<CrewHomeFile> => {
  const members = definition.members.map((member) =>
    Object.fromEntries(
      Object.entries({
        handle: member.handle,
        displayName: member.displayName,
        kind: member.kind === "writer" ? undefined : member.kind,
        tint: member.tint,
        host: member.host,
        setup: member.setup,
        check: member.check,
        run: member.run,
        restartAfterMerge: member.restartAfterMerge || undefined,
        afterLandRestart: member.afterLandRestart || undefined,
        login: member.login,
        model: member.model,
        effort: member.effort,
        env: Object.keys(member.env).length > 0 ? member.env : undefined,
        database: member.database,
        migrations: member.migrations.length > 0 ? member.migrations : undefined,
        context: member.context,
        rotateAfter: member.rotateAfter,
      }).filter(([, value]) => value !== undefined),
    ),
  );
  return [
    {
      path: CREW_HOME_FILE,
      content: stringifyYaml({
        name: definition.name,
        briefTitle: definition.brief.title,
        members,
      }),
    },
    { path: CREW_BRIEF_FILE, content: definition.brief.text },
    ...definition.members.map((member) => ({
      path: crewJobFile(member.handle),
      content: member.job,
    })),
  ];
};

/** What `validateCrewTopology` needs to know about the project. */
export interface CrewTopology {
  /** The Mate's dev services: where a writer's copy may live. */
  readonly devHosts: ReadonlyArray<string>;
  /** Dev services whose ssh environment reaches a database. */
  readonly databaseHosts: ReadonlyArray<string>;
}

/** The checks that need the project's services (PRD §5.1, CONCEPT §3.3 *The shared database*). */
export const validateCrewTopology = (
  definition: CrewDefinition,
  topology: CrewTopology,
): ReadonlyArray<CrewDefinitionIssue> =>
  definition.members.flatMap((member): ReadonlyArray<CrewDefinitionIssue> => {
    if (member.kind !== "writer" || member.host === undefined) return [];
    if (!topology.devHosts.includes(member.host)) {
      return [
        {
          code: "host-unknown",
          path: CREW_HOME_FILE,
          handle: member.handle,
          message: `${member.handle}'s host ${member.host} is not a dev service of this Mate.`,
        },
      ];
    }
    const declared = member.database === "shared" || Object.keys(member.env).length > 0;
    if (topology.databaseHosts.includes(member.host) && !declared) {
      return [
        {
          code: "database-undeclared",
          path: CREW_HOME_FILE,
          handle: member.handle,
          message:
            `${member.handle} works on ${member.host}, which reaches a database: ` +
            "give it its own env: or say database: shared.",
        },
      ];
    }
    return [];
  });

/**
 * Read the crew home's files into a definition. `crew` is the directory name;
 * `files` are keyed by their path relative to the crew home.
 */
export const parseCrewHome = (crew: string, files: ReadonlyArray<CrewHomeFile>): CrewHomeParse => {
  const issues: Issues = [];
  if (!CREW_HANDLE_PATTERN.test(crew)) {
    issues.push({
      code: "crew-id",
      path: ".",
      message: `Crew id "${crew}" must be 1–20 lowercase letters, digits or dashes.`,
    });
  }
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const yamlText = byPath.get(CREW_HOME_FILE);
  const briefText = byPath.get(CREW_BRIEF_FILE);
  if (yamlText === undefined) {
    issues.push({ code: "file-missing", path: CREW_HOME_FILE, message: "crew.yaml is missing." });
  }
  if (briefText === undefined) {
    issues.push({ code: "file-missing", path: CREW_BRIEF_FILE, message: "brief.md is missing." });
  }
  if (yamlText === undefined || briefText === undefined) return { definition: undefined, issues };

  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (error) {
    issues.push({
      code: "yaml",
      path: CREW_HOME_FILE,
      message: `crew.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { definition: undefined, issues };
  }
  if (!isRecord(doc)) {
    issues.push({ code: "yaml", path: CREW_HOME_FILE, message: "crew.yaml must be a mapping." });
    return { definition: undefined, issues };
  }
  for (const field of Object.keys(doc)) {
    if (!CREW_FIELDS.has(field)) {
      issues.push({
        code: "field-unknown",
        path: CREW_HOME_FILE,
        message: `Unknown field ${field}.`,
      });
    }
  }
  const name = readString(doc, "name", CREW_HOME_FILE, issues);
  if (name === undefined || name.trim() === "") {
    issues.push({ code: "field-missing", path: CREW_HOME_FILE, message: "crew.yaml has no name." });
  }
  const briefTitle = readString(doc, "briefTitle", CREW_HOME_FILE, issues);
  if (briefTitle === undefined || briefTitle.trim() === "") {
    issues.push({
      code: "field-missing",
      path: CREW_HOME_FILE,
      message: "crew.yaml has no briefTitle.",
    });
  }
  if (briefText.length > CREW_BRIEF_MAX_CHARS) {
    issues.push({
      code: "brief-too-long",
      path: CREW_BRIEF_FILE,
      message: `The brief has ${briefText.length} characters; at most ${CREW_BRIEF_MAX_CHARS} fit.`,
    });
  }

  const jobs = new Map<string, string>();
  for (const [path, content] of byPath) {
    const match = /^jobs\/(.+)\.md$/u.exec(path);
    if (match) jobs.set(match[1]!, content);
  }

  const membersRaw = doc.members ?? [];
  const members: Array<CrewMemberSpec> = [];
  if (!Array.isArray(membersRaw)) {
    issues.push({ code: "field-type", path: CREW_HOME_FILE, message: "members must be a list." });
  } else {
    membersRaw.forEach((raw, index) => {
      const member = parseMember(raw, index, jobs, issues);
      if (member) members.push(member);
    });
  }

  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.handle)) {
      issues.push({
        code: "handle-duplicate",
        path: CREW_HOME_FILE,
        handle: member.handle,
        message: `Two crewmates use the handle @${member.handle}.`,
      });
    }
    seen.add(member.handle);
  }
  if (members.filter((member) => member.kind === "lead").length > 1) {
    issues.push({
      code: "lead-multiple",
      path: CREW_HOME_FILE,
      message: "A crew has at most one lead.",
    });
  }

  return {
    definition: {
      crew,
      name: name ?? "",
      brief: parseBrief(briefTitle ?? "", briefText),
      members,
    },
    issues,
  };
};
