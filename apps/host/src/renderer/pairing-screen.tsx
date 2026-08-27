import React, { useEffect, useState } from "react";
import type { DesktopState } from "../desktop/contract.js";

type PairingScreenProps = {
  host: DesktopState["host"];
  pairing: DesktopState["pairing"];
  disabled: boolean;
  onCreate: () => void;
};

function remainingSeconds(expiresAt: string) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

function expiryLabel(expiresAt: string) {
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PairingScreen({
  host,
  pairing,
  disabled,
  onCreate,
}: PairingScreenProps) {
  const [remaining, setRemaining] = useState(() =>
    pairing ? remainingSeconds(pairing.expiresAt) : 0,
  );

  useEffect(() => {
    if (!pairing) {
      setRemaining(0);
      return;
    }
    const update = () => setRemaining(remainingSeconds(pairing.expiresAt));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const isExpired = pairing !== null && remaining === 0;

  return (
    <section
      className="feature-card pairing-card"
      aria-labelledby="pairing-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">手机连接</p>
          <h2 id="pairing-title">添加安卓设备</h2>
        </div>
        <button type="button" onClick={onCreate} disabled={disabled}>
          {pairing ? "重新生成" : "生成配对码"}
        </button>
      </div>
      {host ? (
        <div className="host-id" aria-label="电脑 ID">
          <span>电脑 ID</span>
          <code>{host.id}</code>
        </div>
      ) : null}
      {pairing && !isExpired ? (
        <div className="pairing-code" aria-label="当前配对码">
          <span>{pairing.code}</span>
          <p>
            剩余{" "}
            {Math.floor(remaining / 60)
              .toString()
              .padStart(2, "0")}
            :{(remaining % 60).toString().padStart(2, "0")} · 有效期至{" "}
            {expiryLabel(pairing.expiresAt)}
          </p>
        </div>
      ) : isExpired ? (
        <p className="detail">配对码已过期，请重新生成</p>
      ) : (
        <p className="detail">
          在安卓手机打开 Codex Remote，输入这里显示的一次性配对码。
        </p>
      )}
      <p className="detail">配对码只在当前电脑内存中暂存，不会写入配置文件。</p>
    </section>
  );
}
