import { Text } from "~/components/ui/text";

/** The project HQ names after an environment placement failed. */
export function ZeropsUnplacedProject({ projectId }: { readonly projectId: string }) {
  return (
    <Text render={<p />} variant="note">
      The project could not be added to this application. Its Zerops project ID is:{" "}
      <span className="break-all">
        <Text variant="code">{projectId}</Text>
      </span>
      .
    </Text>
  );
}
