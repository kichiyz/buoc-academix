-- BUOC AcademiX Phase 1: secure Teacher access requests.
-- Apply this migration in Supabase SQL Editor after reviewing it.
create table if not exists public.teacher_access_requests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500)
);
alter table public.teacher_access_requests enable row level security;
revoke all on public.teacher_access_requests from anon, authenticated;
-- The admin-control Edge Function uses the service-role client for administrative
-- reads and updates. Keep these grants in the migration so new environments match production.
grant select, insert, update, delete on public.teacher_access_requests to service_role;
grant select on public.teacher_access_requests to authenticated;
drop policy if exists "users read own teacher access request" on public.teacher_access_requests;
create policy "users read own teacher access request"
on public.teacher_access_requests for select to authenticated using (user_id = auth.uid());

create or replace function public.request_teacher_access()
returns public.teacher_access_requests language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_role public.app_role; v_request public.teacher_access_requests;
begin
  if v_user is null then raise exception 'Sign in to request Teacher access.'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null then raise exception 'Account profile not found.'; end if;
  if v_role in ('teacher','admin') then raise exception 'This account already has elevated access.'; end if;
  insert into public.teacher_access_requests(user_id,status,requested_at,reviewed_by,reviewed_at,review_note)
  values(v_user,'pending',now(),null,null,null)
  on conflict(user_id) do update set status='pending',requested_at=now(),reviewed_by=null,reviewed_at=null,review_note=null
  where public.teacher_access_requests.status='rejected'
  returning * into v_request;
  if v_request.user_id is null then raise exception 'A Teacher access request is already pending or has already been approved.'; end if;
  return v_request;
end;
$$;
revoke all on function public.request_teacher_access() from public;
grant execute on function public.request_teacher_access() to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_requested_role text;
begin
  insert into public.profiles(id,full_name,role,bu_id)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),
         'student',nullif(new.raw_user_meta_data->>'bu_id',''))
  on conflict(id) do nothing;
  -- Metadata records intent only; it never grants a privileged profile role.
  v_requested_role := coalesce(new.raw_user_meta_data->>'requested_role','student');
  if v_requested_role = 'teacher' then
    insert into public.teacher_access_requests(user_id,status) values(new.id,'pending') on conflict(user_id) do nothing;
  end if;
  return new;
end $$;
