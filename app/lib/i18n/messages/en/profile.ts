// English · 个人档案. Keys must match messages/zh/profile.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/profile";

const profile: Shape<typeof zh> = {
  kicker: "My Profile",
  title: "My profile",
  intro: "Keep your style, sizes and budget on file, so every pick feels a little more you.",
  loading: "Opening your profile",
  signOut: "Sign out",
  basics: {
    title: "The basics",
    name: "Name",
    city: "City",
    bio: "About you",
    bioPlaceholder: "e.g. Office days; clean lines with a touch of detail",
  },
  style: {
    title: "Style preferences",
    styles: "Style",
    colors: "Favorite colors",
    customPlaceholder: "Add your own, then press Enter",
    customStyleAria: "Add a custom style",
    customColorAria: "Add a custom color",
    add: "Add",
  },
  presets: {
    style: {
      commute: "Workwear",
      minimal: "Minimal",
      french: "French",
      vintage: "Vintage",
      street: "Street",
      sporty: "Sporty",
      sweet: "Sweet",
      androgynous: "Androgynous",
      resort: "Resort",
      date: "Date night",
    },
    color: {
      black: "Black",
      white: "White",
      gray: "Gray",
      beige: "Beige",
      camel: "Camel",
      navy: "Navy",
      burgundy: "Burgundy",
      forest: "Forest green",
      pink: "Pink",
      blue: "Blue",
    },
  },
  sizes: {
    title: "Sizes & budget",
    top: "Tops",
    bottom: "Bottoms",
    shoe: "Shoes",
    budgetMin: "Budget per look, from (¥)",
    budgetMax: "Budget per look, up to (¥)",
  },
  body: {
    title: "Measurements",
    private: "Only visible to you",
    height: "Height (cm)",
    weight: "Weight (kg)",
    clear: "Clear height and weight",
    clearConfirm: "Clear your height and weight?",
  },
  avatar: {
    kicker: "3D Avatar",
    title: "My 3D avatar",
    intro: "Upload three full-length photos and AI will create a 3D avatar of you to view in 360°.",
    cta: "Create my 3D avatar",
  },
  messages: {
    integersOnly: "Please use whole numbers for height, weight and budget.",
    budgetOrder: "Your minimum budget can't be higher than your maximum.",
    saveFailed: "Couldn't save. Please try again later.",
    saved: "Saved",
    clearFailed: "Couldn't clear. Please try again later.",
    cleared: "Measurements cleared",
  },
  save: "Save profile",
  saving: "Saving…",
};

export default profile;
