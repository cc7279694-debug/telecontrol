"use client";

import { FormEvent, useState } from "react";
import React from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "../../lib/supabase/browser";

type AuthError = { message?: string } | null;
type LoginMode = "otp" | "password";

function translateAuthError(error: AuthError): string {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("60 seconds") || message.includes("rate limit")) {
    return "请求过于频繁，请稍后再试";
  }
  if (message.includes("expired") || message.includes("invalid")) {
    return "验证码无效或已过期，请重新获取";
  }
  return "操作未完成，请稍后再试";
}

export function OtpLoginForm(): React.JSX.Element {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<LoginMode>("otp");
  const [step, setStep] = useState<"email" | "token">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setBusy(true);
    setError("");
    const { error: requestError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (requestError) {
      setError(translateAuthError(requestError));
      return;
    }
    setEmail(normalizedEmail);
    setStep("token");
  }

  async function signInWithPassword(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }
    setBusy(true);
    setError("");
    const { error: passwordError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    setBusy(false);
    if (passwordError) {
      const message = passwordError.message?.toLowerCase() ?? "";
      setError(
        message.includes("invalid")
          ? "邮箱或密码错误，请重试"
          : translateAuthError(passwordError),
      );
      return;
    }
    router.push("/hosts");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!/^\d{6,10}$/.test(token)) {
      setError("请输入6-10位验证码");
      return;
    }
    setBusy(true);
    setError("");
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    setBusy(false);
    if (verifyError) {
      setError(translateAuthError(verifyError));
      return;
    }
    router.push("/hosts");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500">远程控制台</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          连接你的开发电脑
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {mode === "otp"
            ? "使用已授权的邮箱登录，验证码只会用于本次登录。"
            : "使用已设置密码的已授权邮箱登录。"}
        </p>
      </div>

      {mode === "password" ? (
        <form className="space-y-5" noValidate onSubmit={signInWithPassword}>
          <label className="block space-y-2 text-sm font-medium text-slate-800">
            <span>邮箱</span>
            <input
              aria-describedby={error ? "auth-error" : undefined}
              autoComplete="email"
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              type="email"
              value={email}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium text-slate-800">
            <span>密码</span>
            <input
              aria-describedby={error ? "auth-error" : undefined}
              autoComplete="current-password"
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              value={password}
            />
          </label>
          <button
            className="h-12 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-900/20 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy}
            type="submit"
          >
            {busy ? "登录中…" : "密码登录"}
          </button>
          <button
            className="h-11 w-full rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
            onClick={() => {
              setMode("otp");
              setPassword("");
              setError("");
            }}
            type="button"
          >
            使用验证码登录
          </button>
        </form>
      ) : step === "email" ? (
        <form className="space-y-5" noValidate onSubmit={requestCode}>
          <label className="block space-y-2 text-sm font-medium text-slate-800">
            <span>邮箱</span>
            <input
              aria-describedby={error ? "auth-error" : undefined}
              autoComplete="email"
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              type="email"
              value={email}
            />
          </label>
          <button
            className="h-12 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-900/20 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy}
            type="submit"
          >
            {busy ? "发送中…" : "发送验证码"}
          </button>
          <button
            className="h-11 w-full rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
            onClick={() => {
              setMode("password");
              setError("");
            }}
            type="button"
          >
            使用密码登录
          </button>
        </form>
      ) : (
        <form className="space-y-5" noValidate onSubmit={verifyCode}>
          <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
            验证码已发送至{" "}
            <span className="font-medium text-slate-900">{email}</span>
          </div>
          <label className="block space-y-2 text-sm font-medium text-slate-800">
            <span>验证码</span>
            <input
              aria-describedby={error ? "auth-error" : undefined}
              autoComplete="one-time-code"
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-center text-xl tracking-[0.45em] text-slate-950 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
              inputMode="numeric"
              maxLength={10}
              onChange={(event) =>
                setToken(event.target.value.replace(/\D/g, ""))
              }
              pattern="[0-9]{6}"
              placeholder="000000"
              type="text"
              value={token}
            />
          </label>
          <button
            className="h-12 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-900/20 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy}
            type="submit"
          >
            {busy ? "登录中…" : "登录"}
          </button>
          <button
            className="h-11 w-full rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
            onClick={() => {
              setStep("email");
              setToken("");
              setError("");
            }}
            type="button"
          >
            更换邮箱
          </button>
        </form>
      )}

      {error ? (
        <p id="auth-error" className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-slate-500">
        仅支持已被添加到本地测试账号的邮箱。
      </p>
    </div>
  );
}
