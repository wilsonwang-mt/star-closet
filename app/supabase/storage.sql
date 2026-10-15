-- 3D 形象私有存储：Supabase Storage 私有桶 avatar-private（决策 D47）。
-- 由发起用户在 Supabase SQL Editor 手动执行一次；Claude Code 不在本机或远端执行。可重复执行。
--
-- 设计：
-- - 桶为私有（public = false），不生成公开链接。
-- - 对象路径统一为 <userId>/photos/<photoId>.<jpg|png|webp> 与 <userId>/avatars/<jobId>.glb，按用户前缀隔离。
-- - 应用不使用 Supabase Auth（账号是 better-auth），浏览器也不直接访问 Storage：
--   只有服务端用 SUPABASE_SERVICE_ROLE_KEY 读写，读取前校验 better-auth 会话且路径前缀等于当前用户 id，
--   再经 /api/avatar/files/<key> 返回给本人。
-- - 因此 anon / authenticated 角色对该桶不需要、也不应有任何策略：storage.objects 默认开启 RLS，
--   没有策略即拒绝全部，service role 绕过 RLS。
-- - 交给第三方生成服务（仅在用户单独同意且配置了 key 时）用的是 15 分钟有效的签名 URL。
-- - 原始照片在对应 3D 形象生成完成 30 天后删除（应用在读取状态时惰性清理）；一键删除会清空 <userId>/ 前缀下全部对象。

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatar-private',
  'avatar-private',
  false,
  104857600, -- 100MB：照片在应用层限制为 8MB，GLB 结果可能较大
  array['image/jpeg', 'image/png', 'image/webp', 'model/gltf-binary']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 清理可能误建的、对 Data API 角色开放该桶的策略（策略名按需补充）。
drop policy if exists "avatar_private_public_read" on storage.objects;

commit;

-- 执行后自查：
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatar-private';
--   期望 public = false。
-- select policyname, roles, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects';
--   期望没有任何针对 avatar-private 桶、面向 anon / authenticated 的策略。
