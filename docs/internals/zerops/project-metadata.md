# Project metadata

A Zerops project carries only the exact `mate` marker when it has a Mate. Project names, services
and access roles come from Zerops. Application membership and kind, faces, makers, birth intents,
name sources and preserved signer identities are HQ records joined by project id. Desktop uses
the web client; mobile shares the client runtime and reads the same HQ placement.

The client records a birth intent before creating a project and retains its id in the creation
plan. Once Zerops returns the project handle, registration binds that handle to the intent at HQ
before attaching it. A failed registration retains its project handle and ends visibly. Another
browser finds the open intent by its project id in HQ's structure. A closed intent's id stays on
the Mate record; project names never establish relations.

HQ bootstrap cannot use a running HQ. Its existing import-seeded journal holds the import id and
receipts until the organization anchor names the official HQ. Recovery reads that journal by
project id, never a project tag. A project with HQ's services and no readable journal stops setup
for inspection instead of authorizing another import.
