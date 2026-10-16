// 临时桩：由 feat/digital-twin 提供真实实现，合并时以对方为准。
// 契约（D63 数字分身）：分身是一组照片级“标准形象照”（正面 / 侧面 / 背面全身），下面的 key 均为私有存储 key。

export type TwinImages = { front: string; side: string | null; back: string | null }; // 私有存储 key

export async function getTwin(
  userId: string,
): Promise<{ jobId: string; images: TwinImages; summary: string | null; traits: Record<string, string> | null; gender: "female" | "male" | null } | null> {
  void userId;
  return null;
}

export async function readTwinImageDataUri(key: string): Promise<string> {
  void key;
  throw new Error("数字分身尚未接入");
}

/** 分身正面 + 正脸 + 侧脸 data URI，最多 4 张。 */
export async function getIdentityRefs(userId: string): Promise<string[]> {
  void userId;
  return [];
}
