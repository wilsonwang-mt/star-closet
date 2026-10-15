"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";

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
      setError(res.error.message ?? "登录失败");
      return;
    }
    router.push(target);
    router.refresh();
  }

  return (
    <form className="card stack" onSubmit={submit} style={{ maxWidth: 420, margin: "0 auto" }}>
      <h1>{mode === "signin" ? "登录" : "注册"}</h1>
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
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" disabled={loading}>
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
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
