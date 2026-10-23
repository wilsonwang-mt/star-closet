// English · 搭配页、一句话改编、单品列表. Keys must match messages/zh/outfit.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/outfit";

const outfit: Shape<typeof zh> = {
  backToCloset: "Back to closet",
  original: {
    title: "As the curator styled it",
  },
  restyle: {
    title: "Make it yours, in a sentence",
    badge: "AI re-style",
    placeholder: "e.g. {example}",
    aria: "Your re-style request",
    voiceStart: "Voice input",
    voiceStop: "Stop voice input",
    needInput: "Write a request first, or tap an example above",
    examples: {
      wedding: "Under ¥800, outdoor wedding, swap to flats",
      commute: "Winter commute, no leather",
      weekend: "Weekend shopping, something comfier, under ¥600",
    },
  },
  errors: {
    adapt: "Couldn't re-style this look",
    save: "Couldn't save",
    noVoice: "This browser doesn't support voice input. Please type instead.",
  },
  unchanged: {
    nothing: "Nothing here needs changing",
    unclear: "We didn't quite catch that",
    hint: "Try mentioning a budget, an occasion, or pieces you'd like to swap or skip. For example:",
  },
  result: {
    title: "Your version of the look",
    budget: "Budget {amount}",
    over: "· {amount} over",
    note: "{mode, select, ai {Chosen by AI, drawing on this closet first and on other closets where needed. } other {Chosen by rules, without AI, drawing on this closet first and on other closets where needed. }}Swapped pieces are outlined in gold; the total is the sum of each piece's listed price.",
  },
  manualReason: "Swapped by you",
  myVersion: "{name} · My version",
  cta: {
    same: "Same as the original",
    added: "Added to Fitting Room",
    add: "Add to Fitting Room",
    again: "Re-style again",
    running: "Re-styling…",
    retry: "Try another request",
    start: "Re-style this look",
  },
  waiting: {
    title: "Re-styling your look",
    thinking: "AI at work · {s}s",
    footer: "Finding the best combination in the closet for you",
    steps: {
      read: "Reading your request",
      pick: "Choosing from this closet",
      keep: "Keeping the original's style",
      check: "Checking categories and budget",
      write: "Noting why each piece works",
    },
  },
  list: {
    swapAria: "Replace {name}",
    swapPlaceholder: "Swap {category}…",
    ownCloset: "This closet",
    otherClosets: "Other closets",
    viewItem: "View {name}",
  },
};

export default outfit;
