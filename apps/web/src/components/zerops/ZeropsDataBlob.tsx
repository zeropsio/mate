/**
 * The Data panel's blob preview: renders a fetched blob's bytes read-only.
 *
 * NOT a protected root (design-system.md R2): like `ZeropsDataPanel`, this
 * is presentational over a value already fetched by its caller — it issues
 * no RPC of its own, mutating or otherwise.
 *
 * Every decision about *what* a payload is lives in `classifyBlob`
 * (client-runtime, UI-free per R1); this component only maps the seven kinds
 * it answers with onto markup, and every kind ends on the same meta line so
 * a value's content type, size and expiry read the same wherever it came
 * from.
 */
import { classifyBlob } from "@t3tools/client-runtime/zerops/dataBlob";
import type { BlobPreview } from "@t3tools/client-runtime/zerops/dataBlob";
import type { ZeropsDataConsoleBlob } from "@t3tools/contracts";

import { FlatCard } from "./primitives";

export interface ZeropsDataBlobProps {
  readonly blob: ZeropsDataConsoleBlob;
  /** The browsed node's name, used as an image's alt text. */
  readonly name?: string | undefined;
}

function TruncatedBanner({ size }: { readonly size: number }) {
  return (
    <p className="text-muted-foreground text-xs" data-zerops-data-blob-truncated>
      Preview truncated — the full value is {size.toLocaleString()} bytes.
    </p>
  );
}

function MetaLine({ text }: { readonly text: string }) {
  return (
    <p className="text-muted-foreground text-xs" data-zerops-data-blob-meta>
      {text}
    </p>
  );
}

function MoreBytes({ count }: { readonly count: number }) {
  return (
    <p className="text-muted-foreground text-xs" data-zerops-data-blob-more>
      … {count.toLocaleString()} more bytes
    </p>
  );
}

function Note({ text }: { readonly text: string }) {
  return (
    <p className="text-muted-foreground text-xs" data-zerops-data-blob-note>
      {text}
    </p>
  );
}

function Body({
  preview,
  name,
}: {
  readonly preview: BlobPreview;
  readonly name?: string | undefined;
}) {
  switch (preview.kind) {
    case "empty":
      return <Note text="Empty value" />;
    case "image":
      return (
        <img
          alt={name ?? "Preview"}
          className="max-h-64 max-w-full object-contain"
          data-zerops-data-blob-image
          src={preview.dataUri}
        />
      );
    case "hex":
      return (
        <>
          <pre className="overflow-x-auto font-mono text-xs" data-zerops-data-blob-hex>
            {preview.dump}
          </pre>
          {preview.moreBytes === undefined ? null : <MoreBytes count={preview.moreBytes} />}
        </>
      );
    case "vector-json":
      return (
        <>
          <Note text="Embedding collapsed" />
          <pre className="overflow-x-auto text-xs" data-zerops-data-blob-text>
            {preview.text}
          </pre>
        </>
      );
    case "stream-summary":
      return (
        <>
          <Note text="Stream summary, not message content" />
          <pre className="overflow-x-auto text-xs" data-zerops-data-blob-text>
            {preview.text}
          </pre>
        </>
      );
    case "text":
      return (
        <>
          <pre className="overflow-x-auto text-xs" data-zerops-data-blob-text>
            {preview.text}
          </pre>
          {preview.moreBytes === undefined ? null : <MoreBytes count={preview.moreBytes} />}
        </>
      );
    case "json":
      return (
        <pre className="overflow-x-auto text-xs" data-zerops-data-blob-text>
          {preview.text}
        </pre>
      );
  }
}

export function ZeropsDataBlob({ blob, name }: ZeropsDataBlobProps) {
  const preview = classifyBlob(blob);

  return (
    <FlatCard
      className="space-y-2 p-3"
      data-zerops-data-blob
      data-zerops-data-blob-kind={preview.kind}
    >
      {preview.truncated ? <TruncatedBanner size={preview.size} /> : null}
      <Body name={name} preview={preview} />
      <MetaLine text={preview.meta} />
    </FlatCard>
  );
}
