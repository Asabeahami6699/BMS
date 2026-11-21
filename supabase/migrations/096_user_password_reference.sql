-- Encrypted admin password reference on staff user profiles.
-- Stored as AES-256-GCM ciphertext (never plaintext), written/read only by backend service-role
-- endpoints gated by users.update so admins can reference an individual staff member's password
-- when resetting or sharing credentials.

alter table public.users
  add column if not exists password_reference_enc text,
  add column if not exists password_updated_at timestamptz;

comment on column public.users.password_reference_enc is
  'AES-256-GCM encrypted password reference for admin password-reset modal (backend service-role only).';
