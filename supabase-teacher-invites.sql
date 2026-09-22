-- 기존 선생님이 동료 선생님을 초대할 수 있게 하는 설정입니다.
-- Supabase Dashboard > SQL Editor에서 한 번만 실행하세요.

alter table public.profiles
  add column if not exists email text;

create unique index if not exists profiles_email_lower_unique
  on public.profiles (lower(email))
  where email is not null;

create table if not exists public.teacher_invites (
  email text primary key,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.teacher_invites enable row level security;

-- 초대 목록은 브라우저에 노출하지 않습니다. 아래의 안전한 함수만 초대를 만들 수 있습니다.
revoke all on table public.teacher_invites from anon, authenticated;

-- 반 코드로 입장할 때의 이름 충돌을 피하고, 현재 사용자를 반 구성원으로 등록합니다.
drop function if exists public.join_class(text);

create or replace function public.join_class(p_join_code text)
returns table (result_class_id uuid, result_class_name text, result_join_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  target_id uuid;
  target_name text;
  target_code text;
begin
  select class_record.id, class_record.name, class_record.join_code
  into target_id, target_name, target_code
  from public.classes as class_record
  where class_record.join_code = upper(trim(p_join_code))
    and class_record.is_active = true;

  if target_id is null then
    raise exception '입장 코드를 찾을 수 없어요. 다시 확인해주세요.';
  end if;

  insert into public.class_members (class_id, user_id)
  values (target_id, auth.uid())
  on conflict (class_id, user_id) do nothing;

  return query
  select target_id, target_name, target_code;
end;
$$;

revoke all on function public.join_class(text) from public;
grant execute on function public.join_class(text) to authenticated;

-- 학생이 제출한 그림책을 승인 대기 상태로 저장합니다.
drop function if exists public.submit_book(text, text, text, text, text);

create function public.submit_book(
  p_join_code text,
  p_title text,
  p_author text,
  p_link_url text,
  p_color text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_id uuid;
  clean_title text := trim(p_title);
  clean_author text := trim(p_author);
  clean_url text := trim(p_link_url);
begin
  select class_record.id
  into target_id
  from public.classes as class_record
  where class_record.join_code = upper(trim(p_join_code))
    and class_record.is_active = true;

  if target_id is null then
    raise exception '입장 코드를 찾을 수 없어요. 다시 확인해주세요.';
  end if;
  if clean_title = '' or clean_author = '' or clean_url = '' then
    raise exception '책 제목, 이름, 그림책 링크를 모두 입력해주세요.';
  end if;
  if not exists (
    select 1 from public.class_members as member_record
    where member_record.class_id = target_id
      and member_record.user_id = auth.uid()
  ) then
    raise exception '반에 다시 입장한 뒤 그림책을 제출해주세요.';
  end if;

  insert into public.books (class_id, title, author, link_url, color, status, submitted_by)
  values (target_id, clean_title, clean_author, clean_url, p_color, 'pending', auth.uid());
end;
$$;

revoke all on function public.submit_book(text, text, text, text, text) from public;
grant execute on function public.submit_book(text, text, text, text, text) to authenticated;

-- 한글·공백을 포함한 반 이름을 안전하게 생성합니다.
-- 함수 내부에서 현재 로그인한 선생님인지 확인하므로 classes의 기존 RLS 정책과 충돌하지 않습니다.
drop function if exists public.create_class(text, text);

create function public.create_class(p_name text, p_join_code text)
returns table (id uuid, name text, join_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  clean_name text := trim(p_name);
  clean_code text := upper(trim(p_join_code));
begin
  if not public.is_teacher() then
    raise exception '선생님만 반을 만들 수 있어요.';
  end if;
  if clean_name = '' or char_length(clean_name) > 20 then
    raise exception '반 이름은 1~20자로 입력해주세요.';
  end if;
  if clean_code !~ '^[A-Z0-9]{4,8}$' then
    raise exception '반 코드를 만들지 못했어요. 다시 시도해주세요.';
  end if;

  return query
  with created_class as (
    insert into public.classes (name, join_code, teacher_id)
    values (clean_name, clean_code, auth.uid())
    returning public.classes.id as created_id,
              public.classes.name as created_name,
              public.classes.join_code as created_join_code
  )
  select created_class.created_id,
         created_class.created_name,
         created_class.created_join_code
  from created_class;
end;
$$;

revoke all on function public.create_class(text, text) from public;
grant execute on function public.create_class(text, text) to authenticated;

-- 새 가입자가 초대된 이메일인지 확인하여 역할을 정합니다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    lower(new.email),
    case when exists (
      select 1 from public.teacher_invites where email = lower(new.email)
    ) then 'teacher' else 'student' end
  )
  on conflict (id) do update
  set email = excluded.email,
      role = case when public.profiles.role = 'teacher' then 'teacher' else excluded.role end;
  return new;
end;
$$;

-- 가입 전/후 모두 사용할 수 있는 선생님 초대 함수입니다.
create or replace function public.invite_teacher(p_email text)
returns text
language plpgsql
security definer set search_path = public, auth
as $$
declare
  normalized_email text := lower(trim(p_email));
  updated_count integer;
begin
  if not public.is_teacher() then
    raise exception '선생님만 다른 선생님을 초대할 수 있어요.';
  end if;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '올바른 이메일 주소를 입력해주세요.';
  end if;

  insert into public.teacher_invites (email, invited_by)
  values (normalized_email, auth.uid())
  on conflict (email) do update
  set invited_by = excluded.invited_by,
      created_at = now();

  update public.profiles profile
  set role = 'teacher'
  from auth.users user_record
  where profile.id = user_record.id
    and lower(user_record.email) = normalized_email;

  get diagnostics updated_count = row_count;
  if updated_count > 0 then
    return '이미 가입한 계정에 선생님 권한을 부여했어요.';
  end if;
  return '초대를 기록했어요. 이 이메일로 가입하면 선생님 권한이 자동으로 적용됩니다.';
end;
$$;

revoke all on function public.invite_teacher(text) from public;
grant execute on function public.invite_teacher(text) to authenticated;

-- PostgREST가 바뀐 함수의 입·출력 형식을 즉시 새로 읽도록 합니다.
notify pgrst, 'reload schema';
