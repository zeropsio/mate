# Project metadata

A Zerops project that has a Mate carries the exact `mate` marker beside its person's own tags, and
no other `mate:` tag. Project names, services and access roles come from Zerops. Application
membership and kind, faces, makers, birth intents and preserved signer identities are HQ records
joined by project id. Desktop uses the web client. Mobile shares the client runtime but reads nothing
from HQ — no structure, placement or stream: it gates a Mate's close-off on the project's own
isolation, read once as the person opens it (`apps/mobile/src/features/zerops/close-off.ts`).

The client records a birth intent before creating a project and retains its id in the creation
plan. Once Zerops returns the project handle, registration binds that handle to the intent at HQ
before attaching it. A failed registration retains its project handle and ends visibly. Another
browser finds the open intent by its project id in HQ's structure. A closed intent's id stays on
the Mate record; project names never establish relations.

HQ bootstrap cannot use a running HQ. Its existing import-seeded journal holds the import id and
receipts until the organization anchor names the official HQ. Recovery reads that journal by
project id, never a project tag. A project with HQ's services and no readable journal stops setup
for inspection instead of authorizing another import.
