-- 관리자 권한 및 관리자 전용 의견함 설정입니다.
-- Supabase Dashboard > SQL Editor에서 한 번만 실행하세요.

do $$
declare
  role_constraint text;
begin
  select conname into role_constraint
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%role%'
  limit 1;
  if role_constraint is not null then
    execute format('alter table public.profiles drop constraint %I', role_constraint);
  end if;
end;
$$;

alter table public.profiles
  add constraint profiles_role_check check (role in ('student', 'teacher', 'admin'));

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 관리자는 선생님이 할 수 있는 반·책 관리 기능도 함께 사용할 수 있습니다.
create or replace function public.is_teacher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin')
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_teacher() to authenticated;

drop policy if exists "teachers can read feedback" on public.feedback_reports;
drop policy if exists "admins can read feedback" on public.feedback_reports;
create policy "admins can read feedback"
on public.feedback_reports for select to authenticated
using (public.is_admin());

drop policy if exists "admins can view feedback images" on storage.objects;
create policy "admins can view feedback images"
on storage.objects for select to authenticated
using (bucket_id = 'feedback-images' and public.is_admin());

-- 아래 UID를 현재 관리자 계정의 UID로 바꾼 뒤 실행하세요.
-- update public.profiles set role = 'admin' where id = '여기에_관리자_UID';

notify pgrst, 'reload schema';
