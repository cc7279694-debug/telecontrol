import { useEffect, useState } from "react";
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
            <p className="detail">
              开机启动：{desktopState.openAtLogin ? "开启" : "关闭"}
            </p>
            {desktopState.notice ? (
              <p className="notice">{desktopState.notice}</p>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
