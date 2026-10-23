// English · 衣橱页. Keys must match messages/zh/closet.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/closet";

const closet: Shape<typeof zh> = {
  backAll: "All closets",
  byline: "Curated by {name} · {n, plural, one {# look} other {# looks}}",
  cue: "Scroll to see {n, plural, one {the look} other {all # looks}}",
  looks: {
    title: "{n, plural, one {# look} other {# looks}} in this closet",
    note: "Try on any piece in one tap. Add the whole look, or just a few pieces, to your Fitting Room or bag.",
  },
  look: {
    opening: "Opening {name}",
    pieces: "Pieces in {name}",
    go: "View & re-style",
  },
  actions: {
    addLook: "Add look to Fitting Room",
    addPicked: "Add {n} to Fitting Room",
    added: "Added to Fitting Room",
    addLookToBag: "Add look to bag",
    addPickedToBag: "Add {n} to bag",
    addedToBag: "Added to bag",
    bag: "Bag",
    selectPieces: "Select pieces",
    cancelSelect: "Cancel selection",
    pickHint: "Tick the pieces you want",
    goToRoom: "Go to Fitting Room",
    viewBag: "View bag",
    select: "Select {name}",
  },
};

export default closet;
