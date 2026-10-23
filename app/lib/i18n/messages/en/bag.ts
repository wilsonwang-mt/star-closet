// English · 购物袋. Keys must match messages/zh/bag.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/bag";

const bag: Shape<typeof zh> = {
  title: "Shopping bag",
  signedOut: "Sign in, and the pieces you add to your bag will be saved to your account.",
  signIn: "Sign in / Sign up",
  empty: "Your bag is empty. As you browse the closets, add a single piece, a full look, or just the pieces you select.",
  browse: "Browse the closets",
  line: {
    listAria: "Pieces in your bag",
    sizeAria: "Size for {name}",
    chooseSize: "Select size",
    oneSize: "One size",
    qtyAria: "Quantity for {name}",
    decrease: "Remove one",
    increase: "Add one",
    unitPrice: "{price} each",
    remove: "Remove",
  },
  summary: {
    aria: "Total",
    count: "{n, plural, one {# piece} other {# pieces}}",
    total: "Total",
  },
  errors: {
    saveFailed: "Your change wasn't saved. Please try again.",
    network: "Network error. Please try again later.",
    addToBag: "Couldn't add to bag. Please try again later.",
    addToFittingRoom: "Couldn't add to fitting room. Please try again later.",
  },
};

export default bag;
