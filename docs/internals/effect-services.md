# Effect services

Server features are Effect services. Transports call them: the WebSocket RPC handlers in
[`ws.ts`](../../apps/server/src/ws.ts), HTTP routes, and the CLI. This page holds the rules for
writing them.

## Where a feature lives

A server capability is a method on a service in its domain folder (`project/`, `workspace/`, `git/`,
`provider/`, `zerops/`, ...). Extend the service that already owns the domain; add a new one only
when none does.

A transport handler does three things: decode the request, call one service method, and map the
service's typed errors to the transport's error. Nothing else. Filesystem, Git, or process work,
folder naming, multi-step dispatch, retries, and rollback belong in the service.

The reason is reach. A capability one transport reaches is soon wanted by another, and logic
written into one handler is missing from the others; testing it needs a socket. Plain functions for
pure work (a slug, an SVG, a message) are fine next to the service; the capability itself is the
method.

```ts
// ws.ts: a thin handler
[ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
  observeRpcEffect(
    ORCHESTRATION_WS_METHODS.getTurnDiff,
    checkpointDiffQuery.getTurnDiff(input).pipe(
      Effect.mapError((cause) => new OrchestrationGetTurnDiffError({ message: "…", cause })),
    ),
    { "rpc.aggregate": "orchestration" },
  ),
```

## Shape of a service module

A new service is one module, in this order: imports, errors and schemas, the `Context.Service` tag
with its interface inline, `make`, then `layer`.
[`WorkspacePaths.ts`](../../apps/server/src/workspace/WorkspacePaths.ts) and
[`T3ProjectFileLoader.ts`](../../apps/server/src/project/T3ProjectFileLoader.ts) are good
references.

```ts
export class FooWriteError extends Schema.TaggedError<FooWriteError>()("FooWriteError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Failed to write the foo file.";
  }
}

export class Foo extends Context.Service<
  Foo,
  { readonly write: (input: { readonly path: string }) => Effect.Effect<void, FooWriteError> }
>()("t3/area/Foo") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  // ...
  return Foo.of({ write });
});

export const layer = Layer.effect(Foo, make);
```

- **Imports.** Consumers use the module as a namespace: `import * as Foo from "./Foo.ts"`, then
  `yield* Foo.Foo` and `Foo.layer`. Never `import { layer as fooLayer }`.
- **Dependencies** come from the environment (`yield* FileSystem.FileSystem`), never as parameters to
  `make`.
- **`make`** stays private unless another module imports it.
- **Errors** are `Schema.TaggedError` classes with structured attributes and a `cause` when they wrap
  a failure. The message is fixed or built from attributes, never from `cause`. Construct the error
  where the failure happens; map it to a transport error only in the transport.
- **Tests** exercise behavior through the service, with test layers only for external dependencies.
  Don't mock the logic under test.

## Before you push

- Does any handler you touched do more than decode, call, and map errors?
- Could another transport use this capability? If not, is that deliberate?
- Did you extend the domain's existing service before adding a new one?
