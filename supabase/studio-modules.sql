begin;

alter table public.profiles add column if not exists role text not null default '';
alter table public.profiles add column if not exists avatar_key text not null default 'couronne';
alter table public.profiles add column if not exists accent_key text not null default 'cyan';
alter table public.profiles add column if not exists accent_color text not null default '#06C0F9';
alter table public.profiles add column if not exists accent_secondary text not null default '#103743';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.studio_documents (
  key text primary key check (key in ('backlog', 'ideas', 'playtests', 'worklog')),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index if not exists studio_documents_updated_at_idx
  on public.studio_documents(updated_at desc);

create or replace function public.save_studio_document(
  p_key text,
  p_content jsonb,
  p_expected_revision bigint
)
returns public.studio_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  current_row public.studio_documents;
  saved_row public.studio_documents;
begin
  if p_key not in ('backlog', 'ideas', 'playtests', 'worklog') then
    raise exception 'Unsupported studio document';
  end if;
  if jsonb_typeof(p_content) <> 'object' then
    raise exception 'Studio document must be an object';
  end if;

  select * into current_row
  from public.studio_documents
  where key = p_key
  for update;

  if not found then
    if p_expected_revision is not null then
      raise exception using errcode = '40001', message = 'Studio document revision conflict';
    end if;
    insert into public.studio_documents(key, content, revision, updated_by)
    values (p_key, p_content, 1, actor)
    returning * into saved_row;
    return saved_row;
  end if;

  if p_expected_revision is null or current_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Studio document revision conflict';
  end if;

  update public.studio_documents
  set content = p_content,
      revision = revision + 1,
      updated_by = actor,
      updated_at = now()
  where key = p_key
  returning * into saved_row;
  return saved_row;
end;
$$;

alter table public.studio_documents enable row level security;

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "authenticated studio documents read" on public.studio_documents;
create policy "authenticated studio documents read"
  on public.studio_documents for select to authenticated using (true);

revoke update on public.profiles from authenticated;
grant update (display_name, role, avatar_key, accent_key, accent_color, accent_secondary, updated_at)
  on public.profiles to authenticated;
grant select on public.studio_documents to authenticated;
revoke all on function public.save_studio_document(text, jsonb, bigint) from public, anon;
grant execute on function public.save_studio_document(text, jsonb, bigint) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'studio_documents'
  ) then
    alter publication supabase_realtime add table public.studio_documents;
  end if;
end
$$;

commit;
