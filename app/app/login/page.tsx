"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Scene from "@/components/Scene";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/client";

type Mode = "signin" | "signup";
type AuthErrorKey =
  | "invalidCredentials"
  | "invalidEmail"
  | "userExists"
  | "passwordTooShort"
  | "passwordTooLong"
  | "emailNotVerified"
  | "tooManyRequests"
  | "botDetected"
  | "signupFailed"
  | "signinFailed";

// better-auth 返回英文错误；按错误码映射成当前语言的提示（字典 auth.errors），未知错误统一兜底，不透传原文。
const AUTH_ERRORS: Record<string, AuthErrorKey> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_PASSWORD: "invalidCredentials",
  USER_NOT_FOUND: "invalidCredentials",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "invalidCredentials",
  INVALID_EMAIL: "invalidEmail",
  USER_ALREADY_EXISTS: "userExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "userExists",
  PASSWORD_TOO_SHORT: "passwordTooShort",
  PASSWORD_TOO_LONG: "passwordTooLong",
  EMAIL_NOT_VERIFIED: "emailNotVerified",
  TOO_MANY_REQUESTS: "tooManyRequests",
  // 本站加的：注册 / 登录没过 Vercel BotID（app/api/auth/[...all]/route.ts）
  BOT_DETECTED: "botDetected",
  FAILED_TO_CREATE_USER: "signupFailed",
  FAILED_TO_CREATE_SESSION: "signinFailed",
};

function authErrorKey(err: { code?: string; status?: number }, mode: Mode): AuthErrorKey {
  if (err.code && AUTH_ERRORS[err.code]) return AUTH_ERRORS[err.code];
  if (err.status === 429) return "tooManyRequests";
  return mode === "signup" ? "signupFailed" : "signinFailed";
}

function LoginForm() {
  const t = useT("auth");
  const router = useRouter();
  const next = useSearchParams().get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/fitting-room";
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res =
      mode === "signup"
        ? await authClient.signUp.email({ name: name || email.split("@")[0], email, password })
        : await authClient.signIn.email({ email, password });
    setLoading(false);
    if (res.error) {
      setError(authErrorKey(res.error, mode));
      return;
    }
    router.push(target);
    router.refresh();
  }

  return (
    <form className="sc-glass card stack sc-rise" onSubmit={submit} style={{ maxWidth: 420, margin: "18dvh auto 0" }}>
      <div>
        <span className="sc-kicker">{t(`${mode}.kicker`)}</span>
        <h1 className="sc-display" style={{ margin: "6px 0 0" }}>{t(`${mode}.title`)}</h1>
      </div>
      {mode === "signup" ? (
        <label>
          {t("name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="nickname" />
        </label>
      ) : null}
      <label>
        {t("email")}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label>
        {t("password")}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
      </label>
      {error ? (
        <p className="error" role="alert">
          {t(`errors.${error}`)}
          {mode === "signup" && error === "userExists" ? (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={() => { setMode("signin"); setError(null); }}>
                {t("goSignIn")}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <button className="sc-cta" disabled={loading}>
        {loading ? t("busy") : t(`${mode}.submit`)}
      </button>
      <button type="button" className="link-btn" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {t(`${mode}.switch`)}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <>
      <Scene dim />
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
