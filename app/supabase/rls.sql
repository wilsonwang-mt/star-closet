-- SEEN.（原工作名 Star Closet）· Supabase 行级安全（RLS）与访问权限
--
-- 表结构的唯一来源是 app/lib/db/schema.ts（Drizzle），本文件不建表。
-- 用法：Drizzle 迁移在 Supabase 上建好表之后，在 Supabase SQL Editor 里整份执行一次；
-- 之后每次迁移新增或改名表，再执行一次。可重复执行。
--
-- 为什么需要：Supabase 的 Data API 会把 public schema 暴露给 anon / authenticated 角色，
-- 未开启 RLS 的表任何拿到 anon key 的人都能读写，包括 account 表里的密码哈希。
--
-- 应用本身经 Drizzle 以表所有者身份直连数据库，不受 RLS 影响；
-- 本文件只收紧 Data API 这条路：目录四张表公开只读，其余表（账号、试衣间）一律不开放，
-- 由服务端代码按当前登录用户读写。
-- 若日后改用 Supabase Auth，再为 look / look_item / profile / avatar_* 增加按 auth.uid() 的本人读写策略。

begin;

-- 1. public 下每张表都开启 RLS（含以后新增的表，重复执行即可覆盖）。
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

-- 2. 收回 Data API 角色对 public 表的全部权限，再只把目录表的读取权还回去。
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
  end loop;
end
$$;

-- 以后由当前角色（迁移时的 postgres）新建的表，默认不再自动授权给 anon / authenticated。
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- 3. 商品目录：主理人、搭配、搭配-单品对应、单品，对外只读。
grant select on table public.curator, public.outfit, public.outfit_item, public.item to anon, authenticated;

drop policy if exists catalog_public_read on public.curator;
create policy catalog_public_read on public.curator for select to anon, authenticated using (true);

drop policy if exists catalog_public_read on public.outfit;
create policy catalog_public_read on public.outfit for select to anon, authenticated using (true);

drop policy if exists catalog_public_read on public.outfit_item;
create policy catalog_public_read on public.outfit_item for select to anon, authenticated using (true);

drop policy if exists catalog_public_read on public.item;
create policy catalog_public_read on public.item for select to anon, authenticated using (true);

-- 4. 账号（"user" / session / account / verification）、试衣间（look / look_item）、
--    个人档案与 3D 形象（profile / avatar_photo / avatar_job）、2D 试穿（tryon / tryon_consent）：
--    已开启 RLS、无任何策略、无授权，Data API 无法访问；只能经服务端读写。
--    profile 含可选身体数据，avatar_* 指向用户照片与生成结果，属于敏感个人数据，下面再显式收紧一次。
alter table public.profile enable row level security;
alter table public.avatar_photo enable row level security;
alter table public.avatar_job enable row level security;
revoke all on table public.profile, public.avatar_photo, public.avatar_job from anon, authenticated;
-- 2D 试穿（tryon 指向用户照片生成的试穿图，tryon_consent 记录第三方处理同意）：同样不对 Data API 开放。
alter table public.tryon enable row level security;
alter table public.tryon_consent enable row level security;
revoke all on table public.tryon, public.tryon_consent from anon, authenticated;
-- 商品详情页“上身效果”（scene_render 指向用本人正面照生成的场景图与 Live 视频，迁移 0004）：同样不对 Data API 开放。
alter table public.scene_render enable row level security;
revoke all on table public.scene_render from anon, authenticated;
-- 每用户每日调用计数（usage_counter，迁移 0006，D64 防滥用与花费上限）：只由服务端读写，不对 Data API 开放。
alter table public.usage_counter enable row level security;
revoke all on table public.usage_counter from anon, authenticated;
-- 购物袋（bag_item，迁移 0007，D67）：本人加入购物袋的单品与尺码，只由服务端按当前登录用户读写，不对 Data API 开放。
alter table public.bag_item enable row level security;
revoke all on table public.bag_item from anon, authenticated;
-- 场景与姿势、封面同款（scene_shot，迁移 0008，D75）：指向用本人形象生成的场景图，只由服务端按当前登录用户读写，不对 Data API 开放。
alter table public.scene_shot enable row level security;
revoke all on table public.scene_shot from anon, authenticated;
-- 全站每日生成花费（spend_day，迁移 0008，D76）：只由服务端读写，不对 Data API 开放。
alter table public.spend_day enable row level security;
revoke all on table public.spend_day from anon, authenticated;
-- 按网络（IP）的每日计数（ip_counter，迁移 0009，D76）：只存带日期的 IP 哈希与次数，只由服务端读写，不对 Data API 开放。
alter table public.ip_counter enable row level security;
revoke all on table public.ip_counter from anon, authenticated;

-- 5. 建项目时勾选“Enable automatic RLS”会生成 public.rls_auto_enable()（SECURITY DEFINER 的事件触发器函数）。
--    它只该由建表事件触发，收回 Data API 角色的调用权限；不影响自动开启 RLS。
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;

commit;

-- 执行后自查（应看到 public 下所有表 rowsecurity = true）：
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
