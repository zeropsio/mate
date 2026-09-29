/**
 * An empty crewmate conversation (PRD §4.5): a crewmate fresh from its start,
 * or one whose conversation was just cleared, opens with the crewmate — its
 * face in its tint, its name and its job in the person's words — and the
 * invite its composer carries, never the Mate's own question. The
 * conversation's seams (why it began, and the one before it) stand on top.
 */
import {
  crewJobSentence,
  crewMessagePlaceholder,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewSeam, Crewmate } from "@t3tools/contracts";

import { MateFace } from "../primitives";
import { CrewSeamActivity } from "./CrewTaskCard";

export function CrewmateEmptyState({
  crewmate,
  seams,
}: {
  readonly crewmate: { readonly handle: string; readonly profile: Crewmate | null };
  readonly seams: ReadonlyArray<{
    readonly id: string;
    readonly seam: CrewSeam;
    readonly words: string;
  }>;
}) {
  const { handle, profile } = crewmate;
  const name = profile?.displayName ?? handle;
  return (
    <div className="flex h-full flex-col px-5 sm:px-6" data-zerops-surface="crewmate-empty-state">
      {seams.length === 0 ? null : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 pt-4">
          {seams.map((row) => (
            <CrewSeamActivity key={row.id} seam={row.seam} words={row.words} />
          ))}
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        {profile === null ? null : <MateFace size="lg" state="idle" tint={profile.tint} />}
        <h1 className="text-2xl font-normal tracking-tight text-foreground sm:text-3xl">{name}</h1>
        {profile === null ? null : (
          <p className="max-w-md text-sm text-muted-foreground">
            {crewJobSentence(profile.jobFirstLine, profile.displayName)}
          </p>
        )}
        <p className="text-placeholder text-sm">{crewMessagePlaceholder(name)}</p>
      </div>
    </div>
  );
}
