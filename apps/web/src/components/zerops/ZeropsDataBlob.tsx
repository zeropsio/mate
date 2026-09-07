/**
 * The Data panel's blob preview: renders a fetched blob's bytes read-only.
 *
 * NOT a protected root (design-system.md R2): like `ZeropsDataPanel`, this
 * is presentational over a value already fetched by its caller — it issues
 * no RPC of its own, mutating or otherwise.
 *
 * `resolveBlobPreview` (client-runtime, kind-only) classifies the fetched
 * blob; one extra refinement is layered on top here, deliberately kept out
 * of client-runtime (UI-free, R1): a `"text"` preview whose `contentType` is
 * `application/json` is pretty-printed via `JSON.parse` + `JSON.stringify`,
 * falling back to the plain decoded text if it does not parse (a truncated
 * body, for one, is not valid JSON on its own).
 */
import { resolveBlobPreview } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleBlob } from "@t3tools/contracts";

import { FlatCard } from "./primitives";

export interface ZeropsDataBlobProps {
  readonly blob: ZeropsDataConsoleBlob;
}

function formatSize(size: number): string {
  return `${size.toLocaleString()} bytes`;
}

function prettyJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return undefined;
  }
}

function TruncatedBanner({ size }: { readonly size: number }) {
  return (
    <p className="text-muted-foreground text-xs" data-zerops-data-blob-truncated>
      Preview truncated — the full value is {formatSize(size)}.
    </p>
  );
}

export function ZeropsDataBlob({ blob }: ZeropsDataBlobProps) {
  const preview = resolveBlobPreview(blob);

  if (preview.kind === "text") {
    const pretty = blob.contentType === "application/json" ? prettyJson(preview.text) : undefined;
    return (
      <FlatCard
        className="space-y-2 p-3"
        data-zerops-data-blob
        data-zerops-data-blob-kind={pretty !== undefined ? "json" : "text"}
      >
        {preview.truncated ? <TruncatedBanner size={preview.size} /> : null}
        <pre className="overflow-x-auto text-xs" data-zerops-data-blob-text>
          {pretty ?? preview.text}
        </pre>
      </FlatCard>
    );
  }

  if (preview.kind === "binary") {
    return (
      <FlatCard className="space-y-2 p-3" data-zerops-data-blob data-zerops-data-blob-kind="binary">
        {preview.truncated ? <TruncatedBanner size={preview.size} /> : null}
        <p className="text-muted-foreground text-xs" data-zerops-data-blob-binary>
          {preview.contentType} · {formatSize(preview.size)}
        </p>
      </FlatCard>
    );
  }

  if (preview.kind === "vector") {
    return (
      <FlatCard className="space-y-2 p-3" data-zerops-data-blob data-zerops-data-blob-kind="vector">
        {preview.truncated ? <TruncatedBanner size={preview.size} /> : null}
        <p className="text-muted-foreground text-xs" data-zerops-data-blob-vector>
          Vector data, not shown.
        </p>
      </FlatCard>
    );
  }

  if (preview.kind === "streamMetadata") {
    return (
      <FlatCard
        className="space-y-2 p-3"
        data-zerops-data-blob
        data-zerops-data-blob-kind="streamMetadata"
      >
        {preview.truncated ? <TruncatedBanner size={preview.size} /> : null}
        <p className="text-muted-foreground text-xs" data-zerops-data-blob-stream-metadata>
          Stream metadata.
        </p>
      </FlatCard>
    );
  }

  return (
    <FlatCard
      className="space-y-2 p-3"
      data-zerops-data-blob
      data-zerops-data-blob-kind="tooLargeForPreview"
    >
      <p className="text-muted-foreground text-xs" data-zerops-data-blob-too-large>
        Too large to preview here — {preview.contentType} · {formatSize(preview.size)}
      </p>
    </FlatCard>
  );
}
