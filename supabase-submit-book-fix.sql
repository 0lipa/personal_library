-- "사이트 설정을 업데이트하는 중이에요" 제출 오류를 고치는 전용 패치입니다.
-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 실행하세요.

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
notify pgrst, 'reload schema';
