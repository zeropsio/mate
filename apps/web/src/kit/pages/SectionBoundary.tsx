import type { ReactNode } from "react";

import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";

import type { KitSection } from "../kitSection";

/** A section's specimens; one that throws says so in place and leaves the page standing. */
export function SectionBoundary({
  section,
  children,
}: {
  readonly section: KitSection;
  readonly children?: ReactNode;
}) {
  return (
    <RenderErrorBoundary
      fallback={
        <Alert variant="error">
          <AlertTitle>{section.title} failed to render</AlertTitle>
          <AlertDescription>The browser console has the error.</AlertDescription>
        </Alert>
      }
    >
      {children ?? section.render()}
    </RenderErrorBoundary>
  );
}
