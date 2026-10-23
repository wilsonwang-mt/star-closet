// English · site-level metadata. Keys must match messages/zh/meta.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/meta";

const meta: Shape<typeof zh> = {
  siteName: "SEEN.",
  titleTemplate: "%s · SEEN.",
  description: "Take a curator's complete look and make it yours — in your fit, within your budget.",
  manifestDescription: "Take a curator's complete look and make it yours — in your fit, within your budget.",
};

export default meta;
