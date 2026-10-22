#!/usr/bin/env python3
"""数字分身脸部相似度评估（D68）。

用公开、许可明确的人脸模型，在本机计算生成的形象照与用户参考正脸的相似度，代替“看着有七成像”的主观印象。
- 检测：OpenCV Zoo 的 YuNet（face_detection_yunet_2023mar，MIT）
- 识别①：OpenCV Zoo 的 SFace（face_recognition_sface_2021dec，Apache-2.0），对齐到 112×112，128 维特征
- 识别②（可选交叉验证）：facenet-pytorch 的 InceptionResnetV1（VGGFace2 预训练，MIT），需另装 torch 与 facenet-pytorch

指标（每个识别模型各算一遍）
- cos：生成图里的脸与本人参考正脸的余弦相似度。
- margin：cos(本人参考正脸) − max cos(其他同性别人物的参考正脸)。> 0 表示在测试集里能认出是谁（rank-1 命中）。
  对模型的绝对分值尺度不敏感，是主指标。
- 身份保持度（%）：(cos − 不同人均值) / (同一人另一张照片均值 − 不同人均值)。100% 表示与本人另一张照片一样像，
  0% 表示与另一个同性别的人一样像。分母小时噪声会被放大，只作参考。
- 脸框高 px：在原图尺寸下的脸框高度。识别前长边统一缩到 2048，2K 与 4K 结果按同一尺度比较身份。
侧面（四分之三侧）只报是否检出与分数，识别模型对大角度侧脸不可靠，不作结论；背面不评估。

只用 AI 生成的虚构人物照片；不要把真人照片放进清单。照片与结果都放在仓库外。

用法：
  python3 scripts/face-eval.py manifest.json [--out result.json] [--models DIR] [--no-facenet]

manifest.json：
  {
    "personas": [
      {"id": "w01", "gender": "female",
       "refs": {"face": "/abs/正脸.jpg", "others": ["/abs/本人另一张照片.jpg"]},
       "outputs": {"baseline": {"front": ["/abs/run1-front.jpg"], "side": ["/abs/run1-side.jpg"]}}}
    ],
    "gallery": [{"id": "C01", "gender": "female", "path": "/abs/另一位虚构人物.jpg"}]
  }
gallery 只用作“不同人”对照，不参与生成。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import sys
import urllib.request

import cv2
import numpy as np

MODELS = {
    "yunet.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "sface.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}
MAX_EDGE = 2048


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_models(d: str) -> dict[str, str]:
    os.makedirs(d, exist_ok=True)
    out = {}
    for name, (url, digest) in MODELS.items():
        p = os.path.join(d, name)
        if not os.path.exists(p) or sha256(p) != digest:
            print(f"下载 {name} …", file=sys.stderr)
            urllib.request.urlretrieve(url, p)
            if sha256(p) != digest:
                os.remove(p)
                sys.exit(f"{name} 校验失败")
        out[name] = p
    return out


def load_facenet():
    try:
        import torch
        from facenet_pytorch import InceptionResnetV1
    except Exception:
        return None
    net = InceptionResnetV1(pretrained="vggface2").eval()

    def embed(img_bgr: np.ndarray, box: np.ndarray) -> np.ndarray:
        x, y, w, h = box[:4]
        # 与 facenet-pytorch 的 MTCNN 默认一致：方形裁切并留边，缩到 160×160，按 (x − 127.5) / 128 标准化
        cx, cy, s = x + w / 2, y + h / 2, max(w, h) * 1.25
        x0, y0 = int(max(0, cx - s / 2)), int(max(0, cy - s / 2))
        x1, y1 = int(min(img_bgr.shape[1], cx + s / 2)), int(min(img_bgr.shape[0], cy + s / 2))
        crop = cv2.cvtColor(cv2.resize(img_bgr[y0:y1, x0:x1], (160, 160), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        t = torch.from_numpy((crop.astype(np.float32) - 127.5) / 128.0).permute(2, 0, 1).unsqueeze(0)
        with torch.no_grad():
            v = net(t)[0].numpy()
        return v / np.linalg.norm(v)

    return embed


class FaceModel:
    def __init__(self, models: dict[str, str], facenet: bool):
        self.det = cv2.FaceDetectorYN.create(models["yunet.onnx"], "", (320, 320), 0.6, 0.3, 5000)
        self.rec = cv2.FaceRecognizerSF.create(models["sface.onnx"], "")
        self.facenet = load_facenet() if facenet else None
        self.embedders = ["sface"] + (["facenet"] if self.facenet else [])
        self.cache: dict[str, dict | None] = {}

    def face(self, path: str) -> dict | None:
        """最大的一张脸：各模型的单位特征向量、脸框高度（原图像素）。没检测到返回 None。"""
        if path in self.cache:
            return self.cache[path]
        img = cv2.imread(path, cv2.IMREAD_COLOR)
        if img is None:
            sys.exit(f"读不了图片：{path}")
        h, w = img.shape[:2]
        scale = min(1.0, MAX_EDGE / max(h, w))
        if scale < 1:
            img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        self.det.setInputSize((img.shape[1], img.shape[0]))
        _, faces = self.det.detect(img)
        res = None
        if faces is not None and len(faces):
            f = max(faces, key=lambda r: r[2] * r[3])
            s = self.rec.feature(self.rec.alignCrop(img, f)).flatten()
            feats = {"sface": s / np.linalg.norm(s)}
            if self.facenet:
                feats["facenet"] = self.facenet(img, f)
            res = {"feats": feats, "box_h": float(f[3] / scale), "img_h": h}
        self.cache[path] = res
        return res


def cos(a: dict, b: dict, m: str) -> float:
    return float(np.dot(a["feats"][m], b["feats"][m]))


def mean(xs):
    xs = [x for x in xs if x is not None]
    return statistics.fmean(xs) if xs else None


def fmt(x, f="{:.3f}"):
    return f.format(x) if x is not None else "—"


def main() -> None:
    ap = argparse.ArgumentParser(description="数字分身脸部相似度评估")
    ap.add_argument("manifest")
    ap.add_argument("--out", help="把明细写成 JSON")
    ap.add_argument("--models", default=os.environ.get("FACE_EVAL_MODELS", os.path.expanduser("~/.cache/star-closet/face-eval")))
    ap.add_argument("--no-facenet", action="store_true", help="只用 SFace")
    args = ap.parse_args()

    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)
    fm = FaceModel(ensure_models(args.models), facenet=not args.no_facenet)
    personas = manifest["personas"]
    gallery = manifest.get("gallery", [])

    # 参考正脸；“不同人”对照集 = 其他人物的参考正脸 + gallery
    refs: dict[str, dict] = {}
    for p in personas:
        r = fm.face(p["refs"]["face"])
        if not r:
            sys.exit(f"{p['id']} 的参考正脸没检测到人脸")
        refs[p["id"]] = r
    pool = [(p["id"], p.get("gender"), refs[p["id"]]) for p in personas]
    for g in gallery:
        r = fm.face(g["path"])
        if r:
            pool.append((g["id"], g.get("gender"), r))
        else:
            print(f"gallery {g['id']} 没检测到人脸，跳过", file=sys.stderr)

    def others(pid: str, gender):
        return [r for (i, gd, r) in pool if i != pid and gd == gender]

    def score(p: dict, face: dict) -> dict:
        out = {}
        for m in fm.embedders:
            c = cos(refs[p["id"]], face, m)
            imp = [cos(o, face, m) for o in others(p["id"], p.get("gender"))]
            out[m] = {"cos": c, "margin": c - max(imp) if imp else None}
        return out

    # 校准
    calib = {}
    for m in fm.embedders:
        genuine, gen_margin, impostor = [], [], []
        for p in personas:
            for o in p["refs"].get("others", []):
                r = fm.face(o)
                if r:
                    s = score(p, r)[m]
                    genuine.append(s["cos"])
                    gen_margin.append(s["margin"])
            impostor += [cos(refs[p["id"]], o, m) for o in others(p["id"], p.get("gender"))]
        calib[m] = {"genuine": genuine, "genuine_margin": gen_margin, "impostor": impostor,
                    "genuine_mean": mean(genuine), "impostor_mean": mean(impostor)}

    def identity(c, m):
        g, i = calib[m]["genuine_mean"], calib[m]["impostor_mean"]
        return (c - i) / (g - i) if g is not None and i is not None and g > i else None

    rows = []
    for p in personas:
        for variant, by_angle in p.get("outputs", {}).items():
            for angle, paths in by_angle.items():
                for path in paths:
                    r = fm.face(path)
                    row = {"persona": p["id"], "variant": variant, "angle": angle, "path": path, "detected": bool(r),
                           "face_px": r["box_h"] if r else None, "img_h": r["img_h"] if r else None, "scores": {}}
                    if r:
                        for m, s in score(p, r).items():
                            row["scores"][m] = {**s, "identity": identity(s["cos"], m)}
                    rows.append(row)

    print("# 校准\n")
    print(f"对照集：{len(personas)} 位测试人物 + {len(pool) - len(personas)} 张 gallery 虚构人脸\n")
    for m in fm.embedders:
        c = calib[m]
        print(f"- {m}：同一人另一张照片 cos 均值 {fmt(c['genuine_mean'])}（n={len(c['genuine'])}，margin 均值 {fmt(mean(c['genuine_margin']))}，"
              f"rank-1 {sum(x > 0 for x in c['genuine_margin'] if x is not None)}/{len(c['genuine_margin'])}）；"
              f"同性别不同人 cos 均值 {fmt(c['impostor_mean'])}（n={len(c['impostor'])}，最大 {fmt(max(c['impostor']) if c['impostor'] else None)}）")

    keyf = lambda r: (r["variant"], r["angle"])
    order = []
    for r in rows:
        if keyf(r) not in order:
            order.append(keyf(r))
    summary = []
    print("\n# 汇总（方案 × 角度）\n")
    head = "| 方案 | 角度 | n | 检出 | 脸框高 px |"
    for m in fm.embedders:
        head += f" {m} cos | {m} margin | {m} rank-1 | {m} 身份保持度 |"
    print(head)
    print("|" + "---|" * (5 + 4 * len(fm.embedders)))
    for k in order:
        rs = [r for r in rows if keyf(r) == k]
        det = [r for r in rs if r["detected"]]
        s = {"variant": k[0], "angle": k[1], "n": len(rs), "detected": len(det), "face_px": mean([r["face_px"] for r in det])}
        line = f"| {k[0]} | {k[1]} | {len(rs)} | {len(det)} | {fmt(s['face_px'], '{:.0f}')} |"
        for m in fm.embedders:
            cs = [r["scores"][m]["cos"] for r in det]
            ms = [r["scores"][m]["margin"] for r in det]
            ids = [r["scores"][m]["identity"] for r in det]
            s[m] = {"cos": mean(cs), "margin": mean(ms), "rank1": sum(x > 0 for x in ms if x is not None), "identity": mean(ids)}
            idv = s[m]["identity"]
            line += f" {fmt(s[m]['cos'])} | {fmt(s[m]['margin'], '{:+.3f}')} | {s[m]['rank1']}/{len(det)} | {fmt(idv * 100 if idv is not None else None, '{:.0f}%')} |"
        summary.append(s)
        print(line)

    print("\n# 明细\n")
    for r in rows:
        parts = [f"{m} {r['scores'][m]['cos']:.3f}/{r['scores'][m]['margin']:+.3f}" for m in r["scores"]] if r["detected"] else ["未检出"]
        print(f"- {r['persona']} {r['variant']} {r['angle']}: {'  '.join(parts)}  脸框 {r['face_px'] or 0:.0f}px  {os.path.basename(r['path'])}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"calibration": calib, "summary": summary, "rows": rows}, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
