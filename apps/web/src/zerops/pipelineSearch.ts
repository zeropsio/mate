/**
 * The pipeline dialog's address: `?pipeline=<appVersionId>` on whatever page is open, so a
 * pipeline opened in Mate survives a reload and travels as a link. Zerops' build e-mails name
 * the legacy app's path, `/service-stack/<serviceId>/deploy/<appVersionId>`, which lands here
 * too (`routes/service-stack.$serviceId.deploy.$appVersionId.tsx`).
 */
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

export interface PipelineSearch {
  readonly pipeline?: string;
}

/** A platform id: letters, digits, `-` and `_`. Anything else names no pipeline. */
const VERSION_ID = /^[A-Za-z0-9_-]{6,64}$/u;

export function validatePipelineSearch(raw: Record<string, unknown>): PipelineSearch {
  const value = raw.pipeline;
  return typeof value === "string" && VERSION_ID.test(value) ? { pipeline: value } : {};
}

/** The pipeline the address opens, if any. */
export function pipelineOfSearch(search: Record<string, unknown>): string | null {
  return validatePipelineSearch(search).pipeline ?? null;
}

/** Opens a pipeline's dialog over the page: a history entry of its own, so Back closes it. */
export function useOpenPipeline(): (versionId: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (versionId: string) => {
      void navigate({ to: ".", search: (previous) => ({ ...previous, pipeline: versionId }) });
    },
    [navigate],
  );
}

/** Closes the dialog, leaving the page under it as it was. */
export function useClosePipeline(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({
      to: ".",
      replace: true,
      search: ({ pipeline: _closed, ...rest }) => rest,
    });
  }, [navigate]);
}
