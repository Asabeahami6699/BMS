create table if not exists public.live_chat_threads (
  id text primary key,
  visitor_name text not null,
  company_name text not null,
  visitor_email text not null,
  unread_for_admin integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_chat_messages (
  id text primary key,
  thread_id text not null references public.live_chat_threads (id) on delete cascade,
  sender_type text not null check (sender_type in ('visitor', 'admin')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists live_chat_messages_thread_idx on public.live_chat_messages (thread_id, created_at);
