"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Scene from "@/components/Scene";
import { authClient } from "@/lib/auth-client";

// better-auth 返回英文错误；按错误码映射成中文，未知错误统一兜底，不透传英文。
const AUTH_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确",
  INVALID_PASSWORD: "邮箱或密码不正确",
  USER_NOT_FOUND: "邮箱或密码不正确",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "邮箱或密码不正确",
  INVALID_EMAIL: "邮箱格式不正确",
  USER_ALREADY_EXISTS: "这个邮箱已注册，直接登录",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "这个邮箱已注册，直接登录",
  PASSWORD_TOO_SHORT: "密码至少 8 位",
  PASSWORD_TOO_LONG: "密码太长了，请换一个短一点的",
  EMAIL_NOT_VERIFIED: "邮箱还没有验证",
  TOO_MANY_REQUESTS: "尝试次数太多，请稍后再试",
  FAILED_TO_CREATE_USER: "注册失败，请稍后再试",
  FAILED_TO_CREATE_SESSION: "登录失败，请稍后再试",
};

function authErrorText(err: { code?: string; status?: number }, mode: "signin" | "signup") {
  if (err.code && AUTH_ERRORS[err.code]) return AUTH_ERRORS[err.code];
  if (err.status === 429) return AUTH_ERRORS.TOO_MANY_REQUESTS;
  return mode === "signup" ? "注册失败，请稍后再试" : "登录失败，请稍后再试";
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/fitting-room";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      setError(authErrorText(res.error, mode));
      return;
    }
    router.push(target);
    router.refresh();
  }

  return (
    <form className="sc-glass card stack sc-rise" onSubmit={submit} style={{ maxWidth: 420, margin: "18dvh auto 0" }}>
      <div>
        <span className="sc-kicker">{mode === "signin" ? "Welcome back" : "Join the closet"}</span>
        <h1 className="sc-display" style={{ margin: "6px 0 0" }}>{mode === "signin" ? "登录" : "注册"}</h1>
      </div>
      {mode === "signup" ? (
        <label>
          昵称
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="nickname" />
        </label>
      ) : null}
      <label>
        邮箱
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label>
        密码（至少 8 位）
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
          {error}
          {mode === "signup" && error === AUTH_ERRORS.USER_ALREADY_EXISTS ? (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={() => { setMode("signin"); setError(null); }}>
                去登录
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <button className="sc-cta" disabled={loading}>
        {loading ? "请稍候…" : mode === "signin" ? "登录" : "注册并登录"}
      </button>
      <button type="button" className="link-btn" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "还没有账号？注册" : "已有账号？登录"}
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
