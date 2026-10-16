import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderInstanceConfig } from "@t3tools/contracts";
import {
  OPENCODE_KEY_PROVIDERS,
  type OpenCodeKeyProvider,
} from "@t3tools/shared/openCodeKeyProviders";
import { useId, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  defaultOpenCodeInstance,
  openCodeInstancePatch,
  openCodeKeyIsSet,
  withOpenCodeKey,
  withoutOpenCodeKey,
} from "./openCodeKeys.logic";

/**
 * The model providers OpenCode signs in to with an API key, each one line:
 * its name and whether a key is set — never the key — with a way to add,
 * replace or remove it. The key goes to the server once, as a secret variable
 * of the default OpenCode instance; the server keeps it in its secret store
 * and restarts OpenCode with it, and sends back only that one is set.
 */
export function OpenCodeProviderKeys({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const instance = defaultOpenCodeInstance(settings);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  if (instance === undefined) return null;
  const write = async (next: ProviderInstanceConfig): Promise<string | null> => {
    const result = await updateSettings({
      environmentId,
      input: { patch: openCodeInstancePatch(settings, next) },
    });
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
    const failure = squashAtomCommandFailure(result);
    return failure instanceof Error ? failure.message : "The key could not be saved.";
  };
  return (
    <div className="grid gap-2" data-opencode-provider-keys>
      {OPENCODE_KEY_PROVIDERS.map((provider) => (
        <OpenCodeProviderKeyRow
          key={provider.id}
          provider={provider}
          keySet={openCodeKeyIsSet(instance, provider)}
          readOnly={readOnly}
          onSave={(key) => write(withOpenCodeKey(instance, provider, key))}
          onRemove={() => write(withoutOpenCodeKey(instance, provider))}
        />
      ))}
    </div>
  );
}

export function OpenCodeProviderKeyRow({
  provider,
  keySet,
  readOnly,
  onSave,
  onRemove,
}: {
  readonly provider: OpenCodeKeyProvider;
  readonly keySet: boolean;
  readonly readOnly: boolean;
  /** Resolves with the failure's words, or null once the server took the write. */
  readonly onSave: (key: string) => Promise<string | null>;
  readonly onRemove: () => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  // What the person just asked for, held until the settings say it: the line never flips back
  // to the old state between the server's answer and its settings arriving.
  const [expected, setExpected] = useState<boolean | null>(null);
  const keyId = useId();
  // Once the settings say it, nothing is held (adjusted while rendering, not after).
  if (expected !== null && keySet === expected) setExpected(null);
  const shownSet = expected ?? keySet;
  const pending = expected !== null;

  const run = (want: boolean, request: () => Promise<string | null>) => {
    setError(null);
    setExpected(want);
    void request().then((failure) => {
      if (failure === null) return;
      setExpected(null);
      setError(failure);
    });
  };

  if (editing && !readOnly) {
    return (
      <form
        className="grid gap-2"
        data-opencode-key-form={provider.id}
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim().length === 0) return;
          const typed = key;
          setEditing(false);
          setKey("");
          run(true, () => onSave(typed));
        }}
      >
        <Label htmlFor={keyId}>{provider.name} API key</Label>
        <Input
          autoComplete="off"
          autoFocus
          id={keyId}
          onChange={(event) => {
            setKey(event.target.value);
          }}
          spellCheck={false}
          type="password"
          value={key}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            onClick={() => {
              setEditing(false);
              setKey("");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button disabled={key.trim().length === 0} size="sm" type="submit" variant="primary">
            Save key
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid gap-1" data-opencode-key={provider.id} data-key-set={shownSet}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="min-w-0 text-xs leading-4">
          <span className="font-medium text-foreground">{provider.name}</span>
          <span className="text-muted-foreground"> · {shownSet ? "key set" : "no key"}</span>
        </p>
        {readOnly ? null : (
          <div className="flex shrink-0 gap-1.5">
            {shownSet ? (
              <>
                <Button
                  disabled={pending}
                  onClick={() => {
                    setEditing(true);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Replace
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => {
                    run(false, onRemove);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Remove key
                </Button>
              </>
            ) : (
              <Button
                disabled={pending}
                onClick={() => {
                  setEditing(true);
                }}
                size="sm"
                variant="secondary"
              >
                Add key
              </Button>
            )}
          </div>
        )}
      </div>
      {shownSet ? null : (
        <p className="text-xs leading-4 text-muted-foreground">
          Runs OpenCode on {provider.models}, billed to your key.
        </p>
      )}
      {error === null ? null : <p className="text-xs leading-4 text-destructive">{error}</p>}
    </div>
  );
}
