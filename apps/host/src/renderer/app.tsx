import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DesktopApi, DesktopState } from "../desktop/contract.js";
import { PairingScreen } from "./pairing-screen.js";
import { WorkspacesScreen } from "./workspaces-screen.js";

declare global {
  interface Window {
    codexRemoteHost: DesktopApi;
  }
}

const hostStatusLabels: Record<DesktopState["hostStatus"], string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  degraded: "等待配对/网络异常",
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
  const [busy, setBusy] = useState(false);

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
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.requestOtp({ email });
      setMessage(result.message);
      if (result.ok) setOtpSent(true);
    } catch {
      setMessage("验证码发送失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.verifyOtp({ email, token });
      setMessage(result.message);
    } catch {
      setMessage("登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.signOut();
      setMessage(result.message);
    } catch {
      setMessage("退出登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleChooseWorkspace() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.chooseWorkspace();
      setMessage(result.message);
    } catch {
      setMessage("添加项目失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveWorkspace(workspaceId: string) {
    if (busy || !window.confirm("确定要移除这个项目授权吗？")) return;
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.removeWorkspace({
        workspaceId,
      });
      setMessage(result.message);
    } catch {
      setMessage("移除项目失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePairingCode() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.createPairingCode();
      setMessage(result.message);
    } catch {
      setMessage("配对码生成失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartHost() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.startHost();
      setMessage(result.message);
    } catch {
      setMessage("Host 启动失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleStopHost() {
    if (busy) return;
    const force =
      desktopState?.activeRemoteTurns !== undefined &&
      desktopState.activeRemoteTurns > 0;
    if (force && !window.confirm("当前有活动任务，确定要强制停止 Host 吗？")) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.codexRemoteHost.stopHost({ force });
      setMessage(result.message);
    } catch {
      setMessage("Host 停止失败，请稍后重试");
    } finally {
      setBusy(false);
    }
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
                      disabled={busy}
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
                        maxLength={6}
                        pattern="[0-9]{6}"
                        disabled={busy}
                        required
                      />
                    </label>
                  ) : null}
                  <button type="submit" disabled={busy}>
                    {busy ? "处理中…" : otpSent ? "完成登录" : "发送验证码"}
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
                <button type="button" onClick={handleSignOut} disabled={busy}>
                  {busy ? "处理中…" : "退出登录"}
                </button>
              </div>
            )}
            {desktopState.authStatus === "signed-in" ? (
              <>
                <section
                  className="feature-card runtime-card"
                  aria-label="Host 控制"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">运行控制</p>
                      <h2>Windows Host</h2>
                    </div>
                    {desktopState.hostStatus === "running" ||
                    desktopState.hostStatus === "degraded" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleStopHost()}
                        disabled={busy}
                      >
                        {busy ? "处理中…" : "停止 Host"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleStartHost()}
                        disabled={
                          busy ||
                          !desktopState.host ||
                          desktopState.hostStatus === "starting" ||
                          desktopState.hostStatus === "stopping"
                        }
                      >
                        {busy ? "处理中…" : "启动 Host"}
                      </button>
                    )}
                  </div>
                  <p className="detail">
                    {desktopState.runtimeReason === "awaiting-pairing"
                      ? "Codex 已启动，请生成配对码并在手机端输入。"
                      : desktopState.runtimeReason === "transport-offline"
                        ? "中转连接暂时不可用，恢复网络后会自动重连。"
                        : desktopState.activeRemoteTurns > 0
                          ? `当前有 ${desktopState.activeRemoteTurns} 个活动任务`
                          : "只有 Host 运行后，手机才能连接这台电脑。"}
                  </p>
                </section>
                <WorkspacesScreen
                  workspaces={desktopState.workspaces}
                  disabled={busy}
                  onChoose={() => void handleChooseWorkspace()}
                  onRemove={(workspaceId) =>
                    void handleRemoveWorkspace(workspaceId)
                  }
                />
                <PairingScreen
                  host={desktopState.host ?? null}
                  pairing={desktopState.pairing}
                  disabled={
                    busy ||
                    !desktopState.host ||
                    desktopState.hostStatus !== "degraded" ||
                    desktopState.runtimeReason !== "awaiting-pairing"
                  }
                  onCreate={() => void handleCreatePairingCode()}
                />
              </>
            ) : null}
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
