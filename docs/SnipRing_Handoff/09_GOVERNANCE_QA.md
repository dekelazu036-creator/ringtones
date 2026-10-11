# AI Development Rules and Release Governance
1. Inspect actual code, schema, deployment and existing tests before any plan. Do not rewrite working modules without approved reason.
2. Scope exactly one milestone. List files, SQL/policies, dependency changes, security, pricing, tests, migration and rollback.
3. Stop for owner approval before code implementation if not authorized; always stop before production SQL, deleting data, changing auth/storage permissions, enabling public features, deployment, or activating paid APIs.
4. Staging separate from production, no copied private production user data, no secrets in repo, logs, docs or chat.
5. Test guest creation/export, auth, local data preservation, cross-user isolation, quotas, cleanup, mobile/desktop, RTL/LTR and rights before release.
6. Report VERIFIED / REPORTED / UNTESTED / BLOCKED separately; never infer deployment success from build success.
7. Maintain change log, ADR, current state evidence and test results after approved changes. No silent changes to product decisions.
8. No claim of backup, compliance, commercial AI rights or professional audio quality without real evidence.
