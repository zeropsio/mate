/**
 * The pipeline dialog's address: `?pipeline=<appVersionId>` on whatever page is open, so a
 * pipeline opened in Mate survives a reload and travels as a link. Zerops' build e-mails name
 * the legacy app's path, `/service-stack/<serviceId>/deploy/<appVersionId>`, which lands here
 * too (`routes/service-stack.$serviceId.deploy.$appVersionId.tsx`).
 */
import { useNavigate, useRouter } from "@tanstack/react-router";
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

/**
 * The pipeline this tab's own press opened, as a history entry of its own: closing it goes back
 * over that entry, so Back after a close does not land on the same page twice. A pipeline the
 * address brought (a link, a reload) has no entry of ours under it, and closing replaces it.
 */
let pushed: { readonly versionId: string; readonly index: number } | null = null;

/** Opens a pipeline's dialog over the page: a history entry of its own, so Back closes it. */
export function useOpenPipeline(): (versionId: string) => void {
  const navigate = useNavigate();
  const router = useRouter();
  return useCallback(
    (versionId: string) => {
      void navigate({ to: ".", search: (previous) => ({ ...previous, pipeline: versionId }) }).then(
        () => {
          pushed = { versionId, index: router.history.location.state.__TSR_index };
        },
      );
    },
    [navigate, router],
  );
}

/** Closes the dialog, leaving the page under it as it was. */
export function useClosePipeline(): () => void {
  const navigate = useNavigate();
  const router = useRouter();
  return useCallback(() => {
    const here = router.history.location;
    const opened = pushed;
    pushed = null;
    if (
      opened !== null &&
      opened.index === here.state.__TSR_index &&
      pipelineOfSearch(router.state.location.search) === opened.versionId
    ) {
      router.history.back();
      return;
    }
    void navigate({
      to: ".",
      replace: true,
      search: ({ pipeline: _closed, ...rest }) => rest,
    });
  }, [navigate, router]);
}
