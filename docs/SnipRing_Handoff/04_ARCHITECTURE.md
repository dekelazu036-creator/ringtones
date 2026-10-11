# Modular Architecture
The earlier Claude reports describe a static frontend and Supabase; current repo/deployment are **not independently verified**. Audit before choosing exact libraries or topology.
Core frontend: local guest editing, public Discover. Future Studio: separate audio engine. Shared boundaries as needed: identity, private media, catalog/search, rights, AI jobs, payments, analytics, moderation, support.
Never assume localStorage is shared between `snipring.com` and `studio.snipring.com`. Define secure cross-origin login. Protect private media through server-side authorization. Distinguish published catalogue assets from private uploads.
Object storage and SQL are not one atomic transaction: require immutable paths, idempotent retries, cleanup/reconciliation, server-enforced quota and explicit upload/delete states. Secrets/service-role keys stay server-side. Do not introduce microservices prematurely.
