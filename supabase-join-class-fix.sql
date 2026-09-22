-- "column reference join_code is ambiguous" 오류만 고치는 전용 패치입니다.
-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 실행하세요.

drop function if exists public.join_class(text);

create function public.join_class(p_join_code text)
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

  return query select target_id, target_name, target_code;
end;
$$;

revoke all on function public.join_class(text) from public;
grant execute on function public.join_class(text) to authenticated;
notify pgrst, 'reload schema';
