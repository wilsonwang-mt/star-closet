// English · top navigation, menu, theme & language switches, offline notice.
import type { Shape } from "../../types";
import type zh from "../zh/nav";

const nav: Shape<typeof zh> = {
  homeAria: "SEEN. home",
  mainNav: "Main navigation",
  mainNavMenu: "Main navigation (menu)",
  menu: "Menu",
  closets: "Closets",
  closetsKicker: "The Closets",
  looks: "Looks",
  looksKicker: "Shop the look",
  fittingRoom: "Fitting Room",
  fittingRoomKicker: "Try it on",
  profile: "Profile",
  profileKicker: "My Profile",
  signIn: "Sign in",
  signInKicker: "Welcome back",
  signOut: "Sign out",
  bag: "Bag",
  bagWithCount: "Bag, {n, plural, one {# item} other {# items}}",
  openMenu: "Open menu",
  openMenuAccount: "Open menu and account",
  closeMenu: "Close menu",
  ask: "Search or ask our stylist",
  theme: {
    dark: "Night",
    light: "Day",
    system: "System",
    aria: "Display mode: {current}. Tap to switch to {next}",
    title: "Display mode: {current}",
  },
  language: {
    button: "Language: {current}. Tap to choose",
    title: "Language",
    menu: "Choose language",
  },
  shopFor: {
    label: "Shopping for",
    all: "All",
    women: "Women",
    men: "Men",
    ask: "Who are you shopping for?",
    browse: "Just browsing",
    current: "Shopping for: {who}",
    change: "Change",
  },
  offline: {
    lost: "You're offline. We'll continue once you're back.",
    back: "Back online",
  },
};

export default nav;
