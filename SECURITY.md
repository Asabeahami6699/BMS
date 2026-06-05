# Security Baseline (Supabase + Backend)

This project enforces defense-in-depth for multi-tenant Susu operations.

## 1) Tenant and branch isolation

- Every core table carries `tenant_id`.
- Branch-scoped staff are restricted by `branch_id` and `scope_type`.
- Head-office users use `scope_type = head_office`.

## 2) RLS is mandatory

- RLS must remain enabled on all tenant data tables.
- Policies must verify:
  - `tenant_id = jwt tenant_id`
  - branch checks for branch-scoped users
- Never allow broad `true` policies on transactional tables.

## 3) Backend authorization is also mandatory

- Express must validate permission + branch scope before DB writes.
- RLS is not a replacement for backend auth checks.
- Service-role key is backend-only, never exposed to frontend.

## 4) Rate limiting

The backend applies:

- Global limiter for all requests
- Strict limiter for money-mutation routes (`/transactions`)
- Strict limiter for admin-mutation routes (`/admin/roles`, `/users`)

Tune limits with production traffic metrics and incident learnings.

## 5) Realtime safety

- Realtime subscriptions must use end-user auth tokens.
- No service-role realtime subscriptions in client code.
- Realtime channel payload visibility relies on RLS policies.

## 6) Non-negotiables for financial integrity

- Append-only ledger entries.
- Idempotency key required for money-mutation endpoints (to add next).
- Full audit trail of user, role, branch, timestamp, and action.
