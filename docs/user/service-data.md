# Service data

Decision: iteration 1 read-only as proposed; no editing or arbitrary queries.

Open a service's Data tab to browse its loaded inventory. The header identifies the service and
platform status; that status does not prove a successful data connection. Connection text and its
copy action contain a masked descriptor. Object storage exposes only its configured bucket.

Choose a table, key or object to inspect it. In a narrow panel, Back restores the list, search and
selection. Search filters loaded names only; Load more explicitly fetches another page. Unknown
sizes and totals remain unknown. Refresh retains permitted last-read data while reading again.

- PostgreSQL and MariaDB show column types, primary keys and up to 100 rows per page. Next and Back
  page through fetched rows. Paging without a primary key is best effort. Count exact is an explicit
  read; a displayed count belongs to its last read.
- Redis and Valkey list keys by colon prefix in scan order. Type and expiry distinguish a known
  expiry, no expiry, unknown TTL and a disappeared key. A scan is not a snapshot.
- Object storage lists objects with size and modification time. Text renders inertly; complete
  small raster images can be previewed. Download preview reuses only a complete fetched body of at
  most 256 KiB. Large or incomplete previews cannot be downloaded.

Reads have a 10-second deadline, at most 100 items per page and a 1 MiB response budget. Large cells
are bounded and marked as truncated. Timeout retains authorized data with a last-read label and
Retry; access denial withholds protected data. Empty results appear only after a successful read.
Stopped services, unsupported capabilities and unavailable or outdated consoles have separate states.

This surface is read-only: no SQL editor, arbitrary commands, filters that execute SQL, editing,
uploads, deletion, TTL changes, full downloads or bulk export. Desktop source shares this web panel;
mobile has no data-panel entry point. Other registered service families retain their existing
capability-based views.
