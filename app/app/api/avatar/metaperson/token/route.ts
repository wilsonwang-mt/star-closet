import { json, withUser } from "@/lib/avatar/http";
import { getAccessToken } from "@/lib/avatar/metaperson";
import { requireMetapersonConsent } from "@/lib/avatar/service";

// 给嵌入的 MetaPerson 创建器用的访问令牌：需登录，且已单独同意由 MetaPerson 处理（D47）。
// 返回 { accessToken, expiresIn }（秒）。服务端用 client id/secret 换取并缓存，clientSecret 不出服务端。
export async function GET() {
  return withUser(async (userId) => {
    await requireMetapersonConsent(userId);
    return json(await getAccessToken());
  });
}
