import { Failure } from "~/components/ui/failure";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProviderInstanceConfig,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  defaultOpenCodeInstance,
  OPENCODE_KEY_PROVIDERS,
  openCodeFreeModelChosen,
  openCodeFreeModelSelection,
  openCodeInstancePatch,
  openCodeKeyIsSet,
  type OpenCodeKeyProvider,
  withOpenCodeKey,
  withoutOpenCodeKey,
} from "@t3tools/shared/openCodeKeyProviders";
import { useId, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Text } from "~/components/ui/text";

/**
 * How OpenCode runs, each one line: its free models, chosen or not, and the model providers it
 * signs in to with an API key — its name and whether a key is set, never the key — with a way to
 * add, replace or remove it. The key goes to the server once, as a secret variable of the default
 * OpenCode instance; the server keeps it in its secret store and restarts OpenCode with it, and
 * sends back only that one is set.
 */
export function OpenCodeProviderKeys({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironment(environmentId)?.serverConfig?.providers;
  const instance = defaultOpenCodeInstance(settings);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  if (instance === undefined) return null;
  const write = async (patch: ServerSettingsPatch, refused: string): Promise<string | null> => {
    const result = await updateSettings({ environmentId, input: { patch } });
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
    const failure = squashAtomCommandFailure(result);
    return failure instanceof Error ? failure.message : refused;
  };
  const writeInstance = (next: ProviderInstanceConfig) =>
    write(openCodeInstancePatch(settings, next), "The key could not be saved.");
  const chosen = openCodeFreeModelChosen(providers, settings.defaultModelSelection);
  const free = chosen ? settings.defaultModelSelection : openCodeFreeModelSelection(providers);
  return (
    <div className="grid gap-2" data-opencode-provider-keys>
      {free === null || free === undefined ? null : (
        <OpenCodeFreeModelsRow
          chosen={chosen}
          modelName={
            providers
              ?.find((provider) => provider.instanceId === free.instanceId)
              ?.models.find((model) => model.slug === free.model)?.name ?? free.model
          }
          onChoose={() =>
            write({ defaultModelSelection: free }, "The free models could not be chosen.")
          }
          onStop={() =>
            write({ defaultModelSelection: null }, "The free models could not be stopped.")
          }
          readOnly={readOnly}
        />
      )}
      {OPENCODE_KEY_PROVIDERS.map((provider) => (
        <OpenCodeProviderKeyRow
          key={provider.id}
          provider={provider}
          keySet={openCodeKeyIsSet(instance, provider)}
          readOnly={readOnly}
          onSave={(key) => writeInstance(withOpenCodeKey(instance, provider, key))}
          onRemove={() => writeInstance(withoutOpenCodeKey(instance, provider))}
        />
      ))}
    </div>
  );
}

/**
 * OpenCode's free models: chosen, one is the Mate's default model (`openCodeFreeModelSelection`),
 * which signs a Mate nobody signed in (`admissionNeedsSignIn`) and starts its conversations on it;
 * stopped, the Mate has no default model again.
 */
function OpenCodeFreeModelsRow({
  chosen,
  modelName,
  readOnly,
  onChoose,
  onStop,
}: {
  readonly chosen: boolean;
  readonly modelName: string;
  readonly readOnly: boolean;
  /** Resolves with the failure's words, or null once the server took the write. */
  readonly onChoose: () => Promise<string | null>;
  readonly onStop: () => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  // What the person just asked for, held until the settings say it, as a key row holds it.
  const [expected, setExpected] = useState<boolean | null>(null);
  if (expected !== null && chosen === expected) setExpected(null);
  const shownChosen = expected ?? chosen;
  const run = (want: boolean, request: () => Promise<string | null>) => {
    setError(null);
    setExpected(want);
    void request().then((failure) => {
      if (failure === null) return;
      setExpected(null);
      setError(failure);
    });
  };
  return (
    <div className="grid gap-1" data-opencode-free data-free-chosen={shownChosen}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="min-w-0 text-caption leading-4">
          <span className="font-medium text-foreground">Free models</span>
          <span className="text-muted-foreground"> · {shownChosen ? "in use" : "no key"}</span>
        </p>
        {readOnly ? null : shownChosen ? (
          <Button
            disabled={expected !== null}
            onClick={() => {
              run(false, onStop);
            }}
            size="sm"
            variant="ghost"
          >
            Stop using
          </Button>
        ) : (
          <Button
            disabled={expected !== null}
            onClick={() => {
              run(true, onChoose);
            }}
            size="sm"
            variant="secondary"
          >
            Use free models
          </Button>
        )}
      </div>
      <Text render={<p />} variant="note">
        {shownChosen
          ? `New conversations start on ${modelName}. Nothing is billed.`
          : `Runs OpenCode on its free models, ${modelName} first. Nothing is billed.`}
      </Text>
      {error === null ? null : <Failure cause={error} role="alert" size="line" />}
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
        <p className="min-w-0 text-caption leading-4">
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
        <Text render={<p />} variant="note">
          Runs OpenCode on {provider.models}, billed to your key.
        </Text>
      )}
      {error === null ? null : <Failure cause={error} role="alert" size="line" />}
    </div>
  );
}
