-- 오류·의견 접수와 사진 첨부용 설정입니다.
-- Supabase Dashboard > SQL Editor에서 한 번만 실행하세요.

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('error', 'question', 'suggestion', 'other')),
  message text not null check (char_length(message) between 1 and 500),
  contact_email text,
  image_paths text[] not null default '{}',
  page_path text,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.feedback_reports enable row level security;

drop policy if exists "users can submit feedback" on public.feedback_reports;
create policy "users can submit feedback"
on public.feedback_reports for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "users can attach their feedback images" on public.feedback_reports;
create policy "users can attach their feedback images"
on public.feedback_reports for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "teachers can read feedback" on public.feedback_reports;
drop policy if exists "admins can read feedback" on public.feedback_reports;
create policy "admins can read feedback"
on public.feedback_reports for select to authenticated
using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-images',
  'feedback-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

drop policy if exists "users can upload their feedback images" on storage.objects;
create policy "users can upload their feedback images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'feedback-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "admins can view feedback images" on storage.objects;
create policy "admins can view feedback images"
on storage.objects for select to authenticated
using (bucket_id = 'feedback-images' and public.is_admin());

notify pgrst, 'reload schema';
