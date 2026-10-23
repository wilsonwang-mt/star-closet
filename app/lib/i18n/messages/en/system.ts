// English · 404、错误页、骨架屏. Keys must match messages/zh/system.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/system";

const system: Shape<typeof zh> = {
  notFound: {
    page: {
      title: "We can't find this page",
      note: "The link may be mistyped, or the content is no longer available.",
    },
    closet: {
      title: "This closet is no longer available",
      note: "Take a look inside other curators' closets.",
    },
    outfit: {
      title: "This look is no longer available",
      note: "The curator may have swapped it out. Head back to the closet to see the others.",
    },
    item: {
      title: "This piece is no longer available",
      note: "Browse the closets for other pieces.",
    },
    home: "Back to all closets",
    fittingRoom: "Go to my Fitting Room",
  },
  error: {
    title: "We couldn't open this page",
    note: "The connection may be unstable, or the service hit a temporary error. Try again, or head back to all closets.",
    retry: "Try again",
    home: "Back to all closets",
  },
  loading: {
    closet: "Opening closet",
    outfit: "Opening look",
    page: "Opening",
  },
};

export default system;
