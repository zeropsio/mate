/**
 * One pipeline as Zerops keeps it: its app version read by id (`GET /app-version/{id}`), whatever
 * its status and whichever organization holds it. What started the pipeline (its source,
 * repository and who started it) never changes after it begins; its name and zerops.yaml come from
 * `pipelineConfig`, as this read leaves them out. Its steps' timestamps are as this read found them, and a running pipeline's progress comes from its
 * process instead. Read once while the pipeline dialog holds it, and again when the version's
 * pushed status moves past the one held. The platform
 * answers a version it does not have, or one the account cannot open, with a refusal
 * (`400 appVersionNotFound`), which refuses the read.
 *
 * @module data/families/pipeline
 */
import { readActivityAppVersion, type ActivityAppVersion } from "../../zerops/activity/dto.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** The repository Zerops pulled the version from itself (a GitHub, GitLab or public git build). */
export interface PipelineGit {
  readonly repository: string | null;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly tag: string | null;
}

/** Who started the pipeline, as Zerops names them: a person, or an access token by its name. */
export interface PipelineStarter {
  readonly name: string;
  readonly token: boolean;
}

export interface PipelineValue {
  readonly id: string;
  /** The organization that holds it: a link can name a pipeline of any of the person's. */
  readonly organizationId: string;
  readonly projectId: string;
  readonly serviceId: string;
  /** One of the platform's `AppVersionStatusEnum` values as this read found it. */
  readonly status: string;
  readonly created: string | null;
  /** `CLI`, `GUI`, `GITHUB`, `GITLAB` or `GIT`; `null` where unstated. */
  readonly source: string | null;
  readonly startedBy: PipelineStarter | null;
  readonly git: PipelineGit | null;
  /** Its steps' timestamps as this read found them. */
  readonly appVersion: ActivityAppVersion;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly pipeline: PipelineValue;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** An access token is a member whose address Zerops makes up: `token-<id>@zerops.io`. */
const TOKEN_ADDRESS = /^token-[a-z0-9]+@zerops\.io$/iu;

function readStarter(value: unknown): PipelineStarter | null {
  if (!isRecord(value)) return null;
  const email = text(value.email);
  const name =
    text(value.fullName) ??
    ([text(value.firstName), text(value.lastName)].filter((part) => part !== null).join(" ") ||
      email);
  if (name === null || name === "") return null;
  return { name, token: email !== null && TOKEN_ADDRESS.test(email) };
}

function readGit(row: Record<string, unknown>): PipelineGit | null {
  const integration = [row.githubIntegration, row.gitlabIntegration].find(isRecord);
  if (integration !== undefined) {
    return {
      repository: text(integration.repositoryFullName),
      branch: text(integration.branchName),
      commit: text(integration.commit),
      tag: text(integration.tagName),
    };
  }
  const publicGit = isRecord(row.publicGitSource) ? row.publicGitSource : null;
  if (publicGit === null) return null;
  return {
    repository: text(publicGit.gitUrl),
    branch: text(publicGit.branchName),
    commit: null,
    tag: null,
  };
}

/** The pipeline a row states; `null` for a row missing its identity. */
export function readPipelineRow(raw: unknown): PipelineValue | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const organizationId = text(raw.clientId);
  const projectId = text(raw.projectId);
  const serviceId = text(raw.serviceStackId);
  const status = text(raw.status);
  const appVersion = readActivityAppVersion(raw);
  if (
    id === null ||
    organizationId === null ||
    projectId === null ||
    serviceId === null ||
    status === null ||
    appVersion === undefined
  ) {
    return null;
  }
  return {
    id,
    organizationId,
    projectId,
    serviceId,
    status,
    created: text(raw.created),
    source: text(raw.source),
    startedBy: readStarter(raw.createdByUser),
    git: readGit(raw),
    appVersion,
  };
}

export const pipelineFamily: FamilySpec<"pipeline"> = {
  family: "pipeline",
  authority: "zerops",
  scope: { source: "zerops", suffix: "pipeline", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/app-version/${encodeURIComponent(ownerId)}`,
    decode: readPipelineRow,
    // What started it never changes: read once while held, and again when the organization's
    // version updates push this version in a status other than the one held.
    freshMs: null,
    refreshOn: ({ ownerId }, row, previous) => {
      if (row.family !== "version" || row.id !== ownerId) return false;
      const held = previous.fact("pipeline", ownerId);
      return held.kind !== "known" || held.value.status !== row.value.status;
    },
  },
};

/** One pipeline read by id under the organization the account observes. */
export const pipelineScope = (orgId: string, versionId: string): ScopeKey =>
  scopeOf(pipelineFamily, orgId, versionId);
