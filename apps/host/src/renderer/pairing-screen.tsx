import type { DesktopState } from "../desktop/contract.js";

type PairingScreenProps = {
  pairing: DesktopState["pairing"];
  disabled: boolean;
  onCreate: () => void;
};

function expiryLabel(expiresAt: string) {
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PairingScreen({
  pairing,
  disabled,
  onCreate,
}: PairingScreenProps) {
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
      {pairing ? (
        <div className="pairing-code" aria-label="当前配对码">
          <span>{pairing.code}</span>
          <p>配对码有效期至 {expiryLabel(pairing.expiresAt)}</p>
        </div>
      ) : (
        <p className="detail">
          在安卓手机打开 Codex Remote，输入这里显示的一次性配对码。
        </p>
      )}
      <p className="detail">配对码只在当前电脑内存中暂存，不会写入配置文件。</p>
    </section>
  );
}
