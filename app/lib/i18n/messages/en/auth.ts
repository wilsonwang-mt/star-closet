// English · 登录与注册. Keys must match messages/zh/auth.ts exactly (enforced by Shape<>).
import type { Shape } from "../../types";
import type zh from "../zh/auth";

const auth: Shape<typeof zh> = {
  signin: {
    kicker: "Welcome back",
    title: "Sign in",
    submit: "Sign in",
    switch: "New here? Create an account",
  },
  signup: {
    kicker: "Join the closet",
    title: "Create account",
    submit: "Create account",
    switch: "Already have an account? Sign in",
  },
  name: "Name",
  email: "Email",
  password: "Password (at least 8 characters)",
  busy: "One moment…",
  goSignIn: "Sign in",
  errors: {
    invalidCredentials: "Incorrect email or password",
    invalidEmail: "Please enter a valid email address",
    userExists: "This email already has an account. Sign in instead.",
    passwordTooShort: "Password must be at least 8 characters",
    passwordTooLong: "That password is too long. Please choose a shorter one.",
    emailNotVerified: "Your email hasn't been verified yet",
    tooManyRequests: "Too many attempts. Please try again later.",
    botDetected: "We couldn't verify this browser. Please refresh the page and try again.",
    signupFailed: "We couldn't create your account. Please try again later.",
    signinFailed: "We couldn't sign you in. Please try again later.",
  },
};

export default auth;
