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

-- 한글·공백을 포함한 반 이름을 안전하게 생성합니다.
-- 함수 내부에서 현재 로그인한 선생님인지 확인하므로 classes의 기존 RLS 정책과 충돌하지 않습니다.
create or replace function public.create_class(p_name text, p_join_code text)
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
