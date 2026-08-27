import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DesktopApi, DesktopState } from "../desktop/contract.js";

declare global {
  interface Window {
    codexRemoteHost: DesktopApi;
  }
}

const hostStatusLabels: Record<DesktopState["hostStatus"], string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "异常",
};

export function App() {
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    let active = true;
    let receivedPublishedState = false;
    const unsubscribe = window.codexRemoteHost.subscribeDesktopState(
      (state) => {
        receivedPublishedState = true;
        if (active) {
          setDesktopState(state);
        }
      },
    );

    void window.codexRemoteHost
      .getDesktopState()
      .then((state) => {
        if (active && !receivedPublishedState) {
          setDesktopState(state);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await window.codexRemoteHost.requestOtp({ email });
    setMessage(result.message);
    if (result.ok) setOtpSent(true);
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await window.codexRemoteHost.verifyOtp({ email, token });
    setMessage(result.message);
  }

  async function handleSignOut() {
    const result = await window.codexRemoteHost.signOut();
    setMessage(result.message);
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Codex Remote Host</p>
        <p className="status">
          {loadFailed
            ? "本地状态暂时不可用"
            : desktopState
              ? `Host ${hostStatusLabels[desktopState.hostStatus]}`
              : "正在准备"}
        </p>
        {desktopState ? (
          <>
            {desktopState.authStatus === "signed-out" ? (
              <div className="auth-card">
                <h1>登录 Windows Host</h1>
                <p className="detail">登录后，手机才能找到这台电脑。</p>
                <form onSubmit={otpSent ? handleVerifyOtp : handleRequestOtp}>
                  <label>
                    邮箱
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      required
                    />
                  </label>
                  {otpSent ? (
                    <label>
                      邮箱验证码
                      <input
                        inputMode="numeric"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="输入验证码"
                        required
                      />
                    </label>
                  ) : null}
                  <button type="submit">
                    {otpSent ? "完成登录" : "发送验证码"}
                  </button>
                </form>
              </div>
            ) : (
              <div className="auth-card">
                <h1>Host 已登录</h1>
                <p className="detail">
                  账号：{desktopState.maskedEmail ?? "已登录"}
                </p>
                <p className="detail">
                  注册状态：{desktopState.host ? "已连接" : "等待连接"}
                </p>
                <button type="button" onClick={handleSignOut}>
                  退出登录
                </button>
              </div>
            )}
            <p className="detail">
              开机启动：{desktopState.openAtLogin ? "开启" : "关闭"}
            </p>
            {message ? <p className="notice">{message}</p> : null}
            {desktopState.notice ? (
              <p className="notice">{desktopState.notice}</p>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
