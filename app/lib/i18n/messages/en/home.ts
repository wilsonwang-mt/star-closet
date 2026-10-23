// English · 首页（衣橱轮播、筛选）. Keys must match messages/zh/home.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/home";

const home: Shape<typeof zh> = {
  dbEmpty: "The catalog hasn't been loaded into the database yet. Run npm run db:setup in app/ first.",
  title: "Whose closet will you step into?",
  enter: "Step inside",
  filters: {
    aria: "Filter closets",
    all: "All",
    noMatch: "No closets in this combination yet",
  },
  empty: {
    note: "No closets in this combination yet.",
    showAll: "Show all",
  },
  carousel: {
    roledescription: "carousel",
    aria: "Closets, {n} in total. Use the left and right arrow keys to browse, and Enter to step inside.",
    cardRoledescription: "closet",
    cardAria: "{index} of {total}: {name}",
    prev: "Previous closet",
    next: "Next closet",
  },
  index: {
    aria: "All closets",
    count: "{n, plural, one {# closet} other {# closets}}",
    looks: "{n, plural, one {# look} other {# looks}}",
  },
};

export default home;
