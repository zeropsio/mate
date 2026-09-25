import { flowVerbKey, flowVerbLabel, type FlowReleaseRow } from "@t3tools/client-runtime/zerops";

import { StatusDot } from "./primitives";
import { ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import { releaseRowTone } from "./ZeropsProjectRow.logic";

/**
 * A project's releases, newest first, each with its word and, on an earlier
 * approved one, the way back to it — the same rows on the projects page and on
 * a production's own page. The rows only: the list around them is the caller's.
 */
export function ZeropsReleaseRows({
  groupId,
  releases,
  pending,
  onRollBack,
}: {
  readonly groupId: string;
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /** The verbs under way (`flowVerbKey`): a release rolling back holds its verb. */
  readonly pending: ReadonlySet<string>;
  readonly onRollBack: (tag: string) => void;
}) {
  return (
    <>
      {releases.map((release) => {
        const tone = releaseRowTone(release);
        const rollingBack = pending.has(
          flowVerbKey({ kind: "roll-back", groupId, tag: release.tag }),
        );
        return (
          <ZeropsEnvironmentRow
            action={
              release.rollBack ? (
                <ZeropsMateVerb
                  disabled={rollingBack}
                  label={flowVerbLabel("roll-back", rollingBack)}
                  onClick={() => {
                    onRollBack(release.tag);
                  }}
                />
              ) : undefined
            }
            key={`release-${groupId}-${release.tag}`}
            name={release.tag}
            status={
              tone === undefined || release.word === undefined ? undefined : (
                <StatusDot label={release.word} sentence tone={tone} />
              )
            }
            summary={release.line}
            tag="release"
          />
        );
      })}
    </>
  );
}
