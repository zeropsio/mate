# Effect services

A server capability belongs to the service that owns its domain. Extend that service before
adding another. Transports decode requests, call one service method and map typed errors;
filesystem, process, persistence, retries and rollback belong in the service. Pure helpers can
live beside it.

## Service modules

A service module orders imports, errors and schemas, the `Context.Service` tag with its interface,
private construction and its layer.

- **Imports.** Use namespace imports from Effect subpaths and service modules. Do not rename
  service layers. Named imports are fine for packages and pure helpers, errors, schemas,
  configuration and types. A barrel exports whole service modules rather than renamed construction
  and layer functions.
- **Dependencies** come from the environment (`yield* FileSystem.FileSystem`), never as parameters
  to `make`, so the types of `make` and `layer` show what they need. Never hide one in a module
  global, a closure over a singleton, or a `Layer.succeed` that calls runtime-backed or imperative
  APIs. Tests may pass service instances directly. Configuration, immutable values, and deliberate
  callbacks are fine as parameters; they aren't services.
- **`make`** exists when the module owns construction and stays private unless another module
  imports it. Don't write `make = Effect.succeed(...)` to force `Layer.effect`; use the constructor
  that fits, like `Layer.succeed` or `Layer.sync`.
- **Moves.** Moving a service deletes the old files and updates every consumer, tests and harnesses
  included. No re-export shims.
- **Tests** exercise behavior through the service, with test layers only for external dependencies.
  Don't mock the logic under test.

## Runtime boundaries

`ManagedRuntime.make`, `runPromise`, and `runPromiseExit` belong at application and framework
boundaries: React, native callbacks, the CLI, HTTP adapters. Never in a domain service, repository,
persistence code, or service constructor. A named adapter may bridge a service into a Promise API,
but no Effect service depends on it.

Compose a shared resource once in an application-owned layer and provide its context to integration
runtimes. Don't create a managed or Atom runtime per feature to hand it out. When acquisition can
fail and callers need a fallback, keep the failure typed: an error on the operation or an explicit
optional-service layer. Don't route around the layer with an imperative runtime.

## Errors

- **Attributes.** Failures are `Schema.TaggedError` classes with structured attributes: the
  operation or stage, the resource path or entity id, a normalized category or status. The message
  is fixed or built from those attributes, never from `cause`, `cause.message`, or a stringified
  defect. No `detail` field that copies `cause.message`.
- **Cause.** An error that wraps a failure keeps the immediate underlying error as `cause`; make it
  required when every construction wraps one. Validation and domain errors with nothing underneath
  have none.
- **Safe values.** Attributes and log annotations stay bounded: no raw payloads, command arguments
  or output, signed URLs, credentials, query strings, or arbitrary defect text. The exact value
  lives only in `cause`. Expose a category, length, count, or a URL's protocol and host instead.
- **Translation.** Construct the error where the failure happens, and map it to a transport error
  only in the transport. A translation boundary passes through domain errors already in the target
  channel and wraps only unknown or lower-level failures. Map each failure where its context is
  known; don't wrap a whole pipeline in one generic error.
- **Discriminators.** Don't encode one distinction twice, as a specific tag and a single-value
  `operation`, `reason`, `kind`, or `phase` literal. Split classes when the distinction drives
  control flow or the user-facing message; a field that only helps diagnostics stays a field. A
  message that reaches HTTP, RPC, persisted state, or the UI is behavior, and a refactor keeps it.
- **Mappers.** Don't write a helper that only does `(...args) => new SomeError({ ...args })`. Keep
  a mapper only when it normalizes, passes domain errors through, or adds context. A mapper that
  belongs to the target error is a static factory on that class.
- **Predicates** are exported directly as `export const isFoo = Schema.is(Foo)`, not a function
  wrapping a private `Schema.is`.
- **Catching.** Catch known tags with `Effect.catchTags({ ... })`, even for one tag, not `catchTag`
  or `catchIf` with a schema predicate. `Effect.catch` is for handling the whole channel; `catchIf`
  is for structural checks like a platform error code.
