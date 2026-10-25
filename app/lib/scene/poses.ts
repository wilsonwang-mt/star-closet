// 场景与姿势试穿的姿势表（D75）：只做站、走、坐、侧身、回眸、半身细节，不做跳跃、抬手等大动作。
// prompt 只给生成模型看；title 是界面上的中文标题（英文见 lib/i18n/phrases）。

export type PoseId = "stand" | "walk" | "sit" | "turn" | "lookback" | "detail";

export const POSES: Record<PoseId, { title: string; prompt: string }> = {
  stand: { title: "站立", prompt: "standing naturally and relaxed, weight on one leg, full body visible" },
  walk: { title: "行走", prompt: "walking toward the camera mid-stride, natural candid movement, full body visible" },
  sit: { title: "坐着", prompt: "sitting comfortably with legs crossed, relaxed posture, full body visible including the shoes" },
  turn: { title: "侧身", prompt: "standing with the body turned three-quarters to the side, head turned slightly toward the camera, full body visible" },
  lookback: {
    title: "回眸",
    prompt: "walking away and looking back over the shoulder toward the camera, showing the back of the outfit, full body visible",
  },
  detail: {
    title: "半身细节",
    prompt: "waist-up portrait, one hand lightly touching the collar or scarf, showing the fabric and details, shallow depth of field",
  },
};

export const POSE_IDS = Object.keys(POSES) as PoseId[];

export const isPoseId = (x: unknown): x is PoseId => typeof x === "string" && x in POSES;
