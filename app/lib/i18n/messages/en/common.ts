// English · shared words. Keys must match messages/zh/common.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/common";

const common: Shape<typeof zh> = {
  loading: "Loading",
  opening: "Opening",
  retry: "Try again",
  close: "Close",
  cancel: "Cancel",
  confirm: "OK",
  save: "Save",
  delete: "Delete",
  back: "Back",
  more: "More",
  pieces: "{n, plural, one {# piece} other {# pieces}}",
  outfits: "{n, plural, one {# look} other {# looks}}",
  priceYuan: "¥{price}",
  genericError: "Something went wrong. Please try again.",
  networkError: "Network error. Please try again.",
  signInRequired: "Please sign in first",
};

export default common;
