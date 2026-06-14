begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username in ('lucas', 'awen')),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id text primary key,
  question text not null,
  answer text not null default '',
  wrong_answers text[] not null default '{}',
  explanation text not null default '',
  category text not null,
  difficulty text not null,
  milestones smallint not null default 1 check (milestones between 1 and 5),
  mode text not null check (mode in ('Quiz', 'Défi')),
  challenge_type text not null default 'Aucun'
    check (challenge_type in ('Aucun', 'Buzzer', 'Vrai/Faux', 'Chiffres')),
  status text not null default 'pending'
    check (status in ('pending', 'review', 'approved', 'validated')),
  tags text[] not null default '{}',
  source text not null default '',
  source_page text not null default '',
  revision_notes text not null default '',
  favorite boolean not null default false,
  confidence numeric(4, 3) not null default 0,
  version integer not null default 1,
  last_exported_version integer,
  last_exported_at timestamptz,
  deleted_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_approvals (
  question_id text not null references public.questions(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (question_id, reviewer_id)
);

create table if not exists public.question_history (
  id bigint generated always as identity primary key,
  question_id text not null references public.questions(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  detail text not null default '',
  snapshot_before jsonb,
  snapshot_after jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.question_comments (
  id bigint generated always as identity primary key,
  question_id text not null references public.questions(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table if not exists public.export_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quiz', 'duels')),
  created_by uuid not null references public.profiles(id),
  question_count integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.export_items (
  export_id uuid not null references public.export_batches(id) on delete cascade,
  question_id text not null references public.questions(id),
  question_version integer not null,
  primary key (export_id, question_id)
);

create index if not exists questions_status_idx on public.questions(status);
create index if not exists questions_category_idx on public.questions(category);
create index if not exists questions_deleted_at_idx on public.questions(deleted_at);
create index if not exists approvals_reviewer_idx on public.question_approvals(reviewer_id);
create index if not exists history_question_created_idx
  on public.question_history(question_id, created_at desc);
create index if not exists comments_question_created_idx
  on public.question_comments(question_id, created_at);

create or replace function public.require_authenticated_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  return current_user_id;
end;
$$;

create or replace function public.approve_question(p_question_id text)
returns public.questions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  approval_count integer;
  before_row public.questions;
  after_row public.questions;
begin
  select * into before_row
  from public.questions
  where id = p_question_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  insert into public.question_approvals(question_id, reviewer_id)
  values (p_question_id, actor)
  on conflict do nothing;

  select count(*) into approval_count
  from public.question_approvals
  where question_id = p_question_id;

  update public.questions
  set status = case when approval_count >= 2 then 'validated' else 'approved' end,
      updated_by = actor,
      updated_at = now()
  where id = p_question_id
  returning * into after_row;

  if before_row.status is distinct from after_row.status
     or not exists (
       select 1
       from public.question_history
       where question_id = p_question_id
         and actor_id = actor
         and action = 'approval'
         and created_at > now() - interval '1 second'
     ) then
    insert into public.question_history(
      question_id, actor_id, action, detail, snapshot_before, snapshot_after
    )
    values (
      p_question_id,
      actor,
      'approval',
      case when approval_count >= 2
        then 'Double validation obtenue'
        else 'Première validation obtenue'
      end,
      to_jsonb(before_row),
      to_jsonb(after_row)
    );
  end if;

  return after_row;
end;
$$;

create or replace function public.revoke_my_approval(p_question_id text)
returns public.questions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  approval_count integer;
  before_row public.questions;
  after_row public.questions;
begin
  select * into before_row
  from public.questions
  where id = p_question_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  delete from public.question_approvals
  where question_id = p_question_id and reviewer_id = actor;

  select count(*) into approval_count
  from public.question_approvals
  where question_id = p_question_id;

  update public.questions
  set status = case
        when approval_count = 0 then 'pending'
        when approval_count = 1 then 'approved'
        else 'validated'
      end,
      updated_by = actor,
      updated_at = now()
  where id = p_question_id
  returning * into after_row;

  insert into public.question_history(
    question_id, actor_id, action, detail, snapshot_before, snapshot_after
  )
  values (
    p_question_id, actor, 'approval_revoked', 'Validation retirée',
    to_jsonb(before_row), to_jsonb(after_row)
  );

  return after_row;
end;
$$;

create or replace function public.set_question_status(
  p_question_id text,
  p_status text
)
returns public.questions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  before_row public.questions;
  after_row public.questions;
begin
  if p_status not in ('pending', 'review') then
    raise exception 'Unsupported status';
  end if;

  select * into before_row
  from public.questions
  where id = p_question_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  delete from public.question_approvals where question_id = p_question_id;

  update public.questions
  set status = p_status,
      updated_by = actor,
      updated_at = now()
  where id = p_question_id
  returning * into after_row;

  insert into public.question_history(
    question_id, actor_id, action, detail, snapshot_before, snapshot_after
  )
  values (
    p_question_id,
    actor,
    'status_changed',
    case p_status when 'review' then 'Passage en révision' else 'Retour en attente' end,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

create or replace function public.move_question_to_trash(p_question_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  before_row public.questions;
  after_row public.questions;
begin
  select * into before_row from public.questions where id = p_question_id for update;
  if not found then raise exception 'Question not found'; end if;

  update public.questions
  set deleted_at = now(), updated_by = actor, updated_at = now()
  where id = p_question_id
  returning * into after_row;

  insert into public.question_history(
    question_id, actor_id, action, detail, snapshot_before, snapshot_after
  ) values (
    p_question_id, actor, 'trashed', 'Carte placée dans la corbeille',
    to_jsonb(before_row), to_jsonb(after_row)
  );
end;
$$;

create or replace function public.restore_question(p_question_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  before_row public.questions;
  after_row public.questions;
begin
  select * into before_row from public.questions where id = p_question_id for update;
  if not found then raise exception 'Question not found'; end if;

  update public.questions
  set deleted_at = null, updated_by = actor, updated_at = now()
  where id = p_question_id
  returning * into after_row;

  insert into public.question_history(
    question_id, actor_id, action, detail, snapshot_before, snapshot_after
  ) values (
    p_question_id, actor, 'restored', 'Carte restaurée',
    to_jsonb(before_row), to_jsonb(after_row)
  );
end;
$$;

create or replace function public.empty_trash()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  deleted_count integer;
begin
  delete from public.questions where deleted_at is not null;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.record_export(
  p_kind text,
  p_question_ids text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.require_authenticated_user();
  batch_id uuid;
begin
  if p_kind not in ('quiz', 'duels') then
    raise exception 'Unsupported export kind';
  end if;

  insert into public.export_batches(kind, created_by, question_count)
  values (p_kind, actor, coalesce(array_length(p_question_ids, 1), 0))
  returning id into batch_id;

  insert into public.export_items(export_id, question_id, question_version)
  select batch_id, q.id, q.version
  from public.questions q
  where q.id = any(p_question_ids)
    and q.deleted_at is null
    and q.status = 'validated';

  update public.questions
  set last_exported_version = version,
      last_exported_at = now()
  where id = any(p_question_ids)
    and deleted_at is null
    and status = 'validated';

  insert into public.question_history(question_id, actor_id, action, detail)
  select q.id, actor, 'exported',
    case p_kind when 'quiz' then 'Incluse dans quiz.json' else 'Incluse dans duels.json' end
  from public.questions q
  where q.id = any(p_question_ids)
    and q.deleted_at is null
    and q.status = 'validated';

  return batch_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.question_approvals enable row level security;
alter table public.question_history enable row level security;
alter table public.question_comments enable row level security;
alter table public.export_batches enable row level security;
alter table public.export_items enable row level security;

drop policy if exists "authenticated profiles read" on public.profiles;
create policy "authenticated profiles read"
  on public.profiles for select to authenticated using (true);

drop policy if exists "authenticated questions read" on public.questions;
create policy "authenticated questions read"
  on public.questions for select to authenticated using (true);
drop policy if exists "authenticated questions insert" on public.questions;
create policy "authenticated questions insert"
  on public.questions for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "authenticated questions update" on public.questions;
create policy "authenticated questions update"
  on public.questions for update to authenticated using (true) with check (updated_by = auth.uid());

drop policy if exists "authenticated approvals read" on public.question_approvals;
create policy "authenticated approvals read"
  on public.question_approvals for select to authenticated using (true);
drop policy if exists "authenticated approvals clear" on public.question_approvals;
create policy "authenticated approvals clear"
  on public.question_approvals for delete to authenticated using (true);

drop policy if exists "authenticated history read" on public.question_history;
create policy "authenticated history read"
  on public.question_history for select to authenticated using (true);
drop policy if exists "authenticated history insert" on public.question_history;
create policy "authenticated history insert"
  on public.question_history for insert to authenticated with check (actor_id = auth.uid());

drop policy if exists "authenticated comments read" on public.question_comments;
create policy "authenticated comments read"
  on public.question_comments for select to authenticated using (true);
drop policy if exists "authors create comments" on public.question_comments;
create policy "authors create comments"
  on public.question_comments for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "authors update comments" on public.question_comments;
create policy "authors update comments"
  on public.question_comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "authors delete comments" on public.question_comments;
create policy "authors delete comments"
  on public.question_comments for delete to authenticated using (author_id = auth.uid());

drop policy if exists "authenticated exports read" on public.export_batches;
create policy "authenticated exports read"
  on public.export_batches for select to authenticated using (true);
drop policy if exists "authenticated export items read" on public.export_items;
create policy "authenticated export items read"
  on public.export_items for select to authenticated using (true);

grant usage on schema public to authenticated;
grant select on public.profiles, public.questions, public.question_approvals,
  public.question_history, public.question_comments, public.export_batches,
  public.export_items to authenticated;
grant insert, update on public.questions to authenticated;
grant delete on public.question_approvals to authenticated;
grant insert, update, delete on public.question_comments to authenticated;
grant insert on public.question_history to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.approve_question(text) to authenticated;
grant execute on function public.revoke_my_approval(text) to authenticated;
grant execute on function public.set_question_status(text, text) to authenticated;
grant execute on function public.move_question_to_trash(text) to authenticated;
grant execute on function public.restore_question(text) to authenticated;
grant execute on function public.empty_trash() to authenticated;
grant execute on function public.record_export(text, text[]) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'questions'
  ) then
    alter publication supabase_realtime add table public.questions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'question_approvals'
  ) then
    alter publication supabase_realtime add table public.question_approvals;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'question_comments'
  ) then
    alter publication supabase_realtime add table public.question_comments;
  end if;
end
$$;

commit;
