// English · 试衣间. Keys must match messages/zh/fittingRoom.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/fittingRoom";

const fittingRoom: Shape<typeof zh> = {
  title: "Your Fitting Room",
  loading: "Opening your fitting room",
  signedOut: "Sign in, and the looks you add to your fitting room will be saved to your account.",
  signIn: "Sign in / Sign up",
  summary: "{n, plural, one {# look} other {# looks}}. Select the pieces you want and add them to your bag.",
  summaryTryon:
    "{n, plural, one {# look} other {# looks}}. Wear a look whole or piece by piece, then select the pieces you want and add them to your bag.",
  empty: "Nothing here yet. Find a look in the closets.",
  browse: "Browse the closets",
  lifeScene: "Wearing this look at a café on a Friday",
  lookTitle: {
    outfit: "Full look",
    myVersion: "{name} · My version",
    picked: "{n, plural, one {# piece} other {# pieces}} picked",
    pickedFrom: "{name} · {n} picked",
  },
  card: {
    mode: {
      original: "Curator's original",
      ai: "AI-adapted",
      offline: "Adapted for you",
      pick: "My picks",
    },
    remove: "Remove",
    selectAria: "Select {name}",
    selected: "{n} of {total} selected",
    addToBag: "Add to bag ({n})",
    added: "Added to bag",
    viewBag: "View bag",
  },
};

export default fittingRoom;
