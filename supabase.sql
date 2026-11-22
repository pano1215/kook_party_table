-- 모꾸: Supabase에 한 번만 실행하는 설정 (SQL Editor에 붙여 넣고 Run)
-- 표 두 개에 서버 데이터를 담고, 사람이 읽기 쉬운 보기(view)를 만든다.

-- 1) 키-값 저장: 파티(party:…), 초대 코드(invite:…), 호스트 코드(host:…), 인터뷰 신청(lead:…) 등
create table if not exists kv (
  key text primary key,
  value text not null,
  expires_at timestamptz
);
-- 2) 목록 저장: 방문·핵심 행동 기록(events), 인터뷰 신청 번호(leadids)
create table if not exists lists (
  id bigserial primary key,
  name text not null,
  value text not null,
  created_at timestamptz not null default now()
);
create index if not exists lists_name_id on lists (name, id desc);

-- 3) 서버 전용: 브라우저용 키(anon)로는 읽고 쓸 수 없게 잠근다. 서버는 service_role 키로 접근한다
alter table kv enable row level security;
alter table lists enable row level security;

-- 4) 서버가 쓰는 함수
create or replace function kv_incr(k text) returns integer language plpgsql as $$
declare n integer;
begin
  delete from kv where key = k and expires_at is not null and expires_at < now();
  insert into kv (key, value) values (k, '1')
    on conflict (key) do update set value = (kv.value::integer + 1)::text
    returning value::integer into n;
  return n;
end $$;
create or replace function list_trim(n text, keep integer) returns void language sql as $$
  delete from lists where name = n and id not in (select id from lists where name = n order by id desc limit keep);
$$;
revoke all on function kv_incr(text) from anon, authenticated;
revoke all on function list_trim(text, integer) from anon, authenticated;

-- 5) 읽기 쉬운 보기 (Table Editor 나 SQL Editor 에서 조회)
create or replace view parties_view with (security_invoker = true) as
select v->>'id' as id, v->>'name' as name, v->>'date' as party_date, v->>'start' as start_time,
       (v->>'people')::int as people, v->>'mood' as mood, v->>'src' as channel,
       (v->>'budget')::int as budget, v->>'budget_pp' as budget_per_person, v->'kinds' as menu_kinds,
       v->>'invite_code' as invite_code, jsonb_array_length(coalesce(v->'guests', '[]'::jsonb)) as cards,
       (jsonb_typeof(v->'plan') = 'object') as has_plan, v->>'created_at' as created_at, s.expires_at
from (select value::jsonb as v, expires_at from kv where key like 'party:%') s;

create or replace view guest_cards_view with (security_invoker = true) as
select s.v->>'id' as party_id, s.v->>'name' as party_name, g->>'nickname' as nickname, (g->>'anonymous')::boolean as anonymous,
       g->'likes' as likes, g->'allergies' as allergies, g->'dislikes' as dislikes,
       g->>'spice' as spice, g->>'drink' as drink, g->>'message' as message,
       (g->>'by_host')::boolean as by_host, g->>'submitted_at' as submitted_at
from (select value::jsonb as v from kv where key like 'party:%') s, jsonb_array_elements(coalesce(s.v->'guests', '[]'::jsonb)) g;

create or replace view events_view with (security_invoker = true) as
select id, (value::jsonb)->>'t' as t, (value::jsonb)->>'ev' as event, (value::jsonb)->>'ch' as channel,
       (value::jsonb)->>'role' as role, (value::jsonb)->>'vid' as visitor, (value::jsonb)->>'party' as party_id, (value::jsonb)->>'kind' as kind
from lists where name = 'events';

create or replace view leads_view with (security_invoker = true) as
select v->>'id' as id, v->>'t' as applied_at, v->>'role' as role, v->>'src' as channel, v->>'phone' as phone,
       v->'consent'->>'at' as consent_at, v->'consent'->>'notice' as notice_version, s.expires_at
from (select value::jsonb as v, expires_at from kv where key like 'lead:%') s;
