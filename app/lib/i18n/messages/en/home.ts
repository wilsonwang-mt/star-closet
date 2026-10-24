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
  edit: {
    title: "Dressed for the occasion",
    lead: "Complete looks from our curators. See them on you first, then take home the pieces you love.",
    ask: "Not sure? Ask our stylist",
    tabsAria: "Shop complete looks by occasion",
    viewLookAria: "View the look: {name}",
    pieces: "{n, plural, one {# piece} other {# pieces}} in this look",
    piecesAria: "Pieces in {name}",
    total: "Complete look",
    viewLook: "View the look",
    more: "More for {occasion}",
    cardPieces: "{n, plural, one {# piece} other {# pieces}}",
  },
};

export default home;
