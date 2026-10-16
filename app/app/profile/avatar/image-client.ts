"use client";

import { fitWithin, stripDataUrl } from "@/lib/avatar/metaperson-protocol";

// 浏览器端图片处理：按长边等比缩小并重新编码为 JPEG（顺带去掉 EXIF 等元数据，服务端还会再剥一次）。

async function draw(src: Blob, maxEdge: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(src, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(bmp.width, bmp.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("no canvas");
  }
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return canvas;
}

/** 上传前压缩：长边不超过 maxEdge，JPEG。 */
export async function compressImage(src: Blob, maxEdge = 1600, quality = 0.9): Promise<Blob> {
  const canvas = await draw(src, maxEdge);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("encode failed");
  return blob;
}

/** 读取本人已上传的照片（同源私有地址），压到长边 maxEdge 的 JPEG，返回不带 data: 前缀的 base64。 */
export async function photoToBase64(url: string, maxEdge: number, quality = 0.9): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const canvas = await draw(await res.blob(), maxEdge);
  return stripDataUrl(canvas.toDataURL("image/jpeg", quality));
}
