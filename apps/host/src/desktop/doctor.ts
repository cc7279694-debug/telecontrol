export type DoctorCheckId =
  | "platform"
  | "safe-storage"
  | "session"
  | "host-key"
  | "host-registration"
  | "supabase"
  | "device"
  | "workspaces"
  | "codex-cli"
  | "app-server"
  | "login-item"
  | "notifications"
  | "recent-errors";

export type DoctorCheckResult = {
  status: "pass" | "warning" | "fail";
  message: string;
  remediation?: string;
  errorCode?: string;
};

export type DoctorCheck = {
  id: DoctorCheckId;
  label: string;
  critical: boolean;
  run: () => Promise<DoctorCheckResult>;
};

export type DoctorItem = {
  id: DoctorCheckId;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  remediation?: string;
  errorCode?: string;
};

export type DoctorSummary = {
  status: "passed" | "warning" | "failed";
  checkedAt: string;
  passed: number;
  warnings: number;
  failed: number;
};

export type DoctorReport = {
  items: DoctorItem[];
  summary: DoctorSummary;
  criticalPassed: boolean;
  safeSummary: {
    appVersion: string;
    status: DoctorSummary["status"];
    passed: number;
    warnings: number;
    failed: number;
  };
};

export function createDoctor({
  checks,
  appVersion,
  now = () => new Date(),
}: {
  checks: DoctorCheck[];
  appVersion: string;
  now?: () => Date;
}) {
  async function run(): Promise<DoctorReport> {
    const items: DoctorItem[] = [];
    for (const check of checks) {
      try {
        const result = await check.run();
        items.push({
          id: check.id,
          label: check.label,
          status: result.status,
          message: result.message,
          ...(result.remediation ? { remediation: result.remediation } : {}),
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        });
      } catch {
        items.push({
          id: check.id,
          label: check.label,
          status: "fail",
          message: "检查失败，请查看 Doctor 建议",
          remediation: "请根据检查项提示修复后重试",
          errorCode: "doctor_check_failed",
        });
      }
    }

    const passed = items.filter((item) => item.status === "pass").length;
    const warnings = items.filter((item) => item.status === "warning").length;
    const failed = items.filter((item) => item.status === "fail").length;
    const status = failed > 0 ? "failed" : warnings > 0 ? "warning" : "passed";
    const summary = {
      status,
      checkedAt: now().toISOString(),
      passed,
      warnings,
      failed,
    } satisfies DoctorSummary;
    const criticalPassed = checks.every((check) => {
      if (!check.critical) return true;
      return items.find((item) => item.id === check.id)?.status === "pass";
    });

    return {
      items,
      summary,
      criticalPassed,
      safeSummary: { appVersion, status, passed, warnings, failed },
    };
  }

  return { run };
}
