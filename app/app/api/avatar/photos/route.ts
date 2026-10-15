import { json, withUser } from "@/lib/avatar/http";
import { addPhoto, AvatarError } from "@/lib/avatar/service";

// 上传一张照片：multipart/form-data，字段 slot（front|side|back|face|extra）与 file。
// 服务端按文件头识别类型（JPG/PNG/WebP），≤8MB，记录宽高与质量提示。
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 9 * 1024 * 1024) throw new AvatarError(413, "单张照片不能超过 8MB");
    const form = await req.formData().catch(() => null);
    if (!form) throw new AvatarError(400, "请用表单上传照片");
    const slot = form.get("slot");
    const file = form.get("file");
    if (typeof slot !== "string" || !(file instanceof File)) throw new AvatarError(400, "缺少照片或位置");
    return json(await addPhoto(userId, slot, file), 201);
  });
}
