import { useAtomValue } from "@effect/atom-react";
import { mateHealthAtom, mateHealthCopy, type MateHealthRead } from "@t3tools/client-runtime/data";

/** The same keyed projection covers live evidence and HQ's retained report. */
export function MateHealthNotice({
  projectId,
  name,
}: {
  readonly projectId: string;
  readonly name: string;
}) {
  const read = useAtomValue(mateHealthAtom(projectId));
  return <MateHealthMessage name={name} read={read} />;
}

export function MateHealthMessage({
  name,
  read,
}: {
  readonly name: string;
  readonly read: MateHealthRead;
}) {
  const copy = mateHealthCopy(name, read);
  if (copy === null) return null;
  return (
    <div role="status" className="px-4 py-3 text-sm">
      <p className={copy.severity === "critical" ? "text-destructive" : "text-warning"}>
        {copy.title}
      </p>
      <p className="mt-1 text-muted-foreground">{copy.description}</p>
    </div>
  );
}
