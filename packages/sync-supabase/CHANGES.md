# Changes

This file records changes to GENII Publisher covered code as required by CPAL 1.0 Section 3.3. The reference Supabase provider is GENII Publisher Original Code provided by GENII Foundation. Contributors must append a dated summary. Do not rewrite prior entries.

## 2026-08-28, GENII Foundation

- Completed the public prerelease package manifest, legal bundle, exact release tag guard, directory-publication refusal, and packed consumer proof.
- Kept installation inert. Publishing the package does not configure a project, apply a migration, contact Supabase, or enable synchronization in a host.

## 2026-08-18, GENII Foundation

- Added server-only publication-scoped reads and transfers for progress, bookmarks, consent, and idempotent engagement events.
- Added a re-runnable publication-scoping migration for every synchronized row, bookmark lock, event identity, and retention boundary while preserving old rows under an explicit legacy marker.
- Added server-side email link requests, one-time code verification, session inspection, and sign-out behind the provider-neutral renderer contract.
- Added a server-only provider for authentication callback exchange and authenticated account deletion.
- Kept provider configuration in bounded server environment values and kept the service-role key out of public artifacts and route responses.
- Pinned the Supabase server dependencies and declared the author-owned host integration contract.
