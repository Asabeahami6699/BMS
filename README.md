# BMS SaaS Starter (TypeScript)

This repository is scaffolded for a multi-tenant Susu/MFI platform with:

- `apps/backend`: Express backend in TypeScript
- `apps/frontend`: React + Vite frontend in TypeScript
- `packages/shared`: shared schemas and types (Zod)

## Quick Start

```bash
npm install
npm run dev
```

API runs on `http://localhost:4000`.

## Optional Supabase configuration

Set these in your environment to enable Supabase-backed storage:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` (optional; from Supabase **Settings → API → JWT Secret** — lets the API verify sessions when Auth is unreachable)

If not set, the backend runs with in-memory stores for local development.

For frontend realtime subscriptions, set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Apply Supabase migrations in order:

1. `001_core_rls.sql`
2. `002_atomic_transactions_and_audit.sql`
3. `003_tenant_roles.sql`
4. `004_users_profile_fields.sql`

## Branch management

- `GET /api/v1/branches` (requires `branches.read`)
- `POST /api/v1/branches` (requires `branches.create`)
- `PATCH /api/v1/branches/:branchId` (requires `branches.update`)

## Auth model in this starter

For local development, request context is provided with headers:

- `x-user-id`
- `x-tenant-id`
- `x-role` (`admin`, `field_agent`, `coordinator`, `auditor`, `accountant`, `teller`, `customer_service`)
- `x-scope-type` (`head_office` or `branch`)
- `x-branch-id` (optional)

## Key endpoints

- `GET /health`
- `GET /api/v1/tenant/commission-policy`
- `PUT /api/v1/tenant/commission-policy`
- `GET /api/v1/payroll/payslips/me`
- `GET /api/v1/payroll/payslips/:id`
- `POST /api/v1/payroll/run`
- `POST /api/v1/users`
- `GET /api/v1/users`

## Idempotency for money routes

For `POST /api/v1/transactions`, send `Idempotency-Key` header to prevent duplicate money postings.

## Commission + payslip behavior

- Admin configures tenant commission policy.
- Commission is automatically calculated for `field_agent` and `coordinator`.
- All roles can view their own payslip.
- Admin, auditor, and accountant can view any payslip within their tenant.
