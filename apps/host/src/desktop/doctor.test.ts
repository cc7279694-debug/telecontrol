import { describe, expect, it } from "vitest";
import { createDoctor, type DoctorCheck } from "./doctor.js";

describe("Host Doctor", () => {
  it("continues after an item fails and returns a safe summary", async () => {
    const checks: DoctorCheck[] = [
      {
        id: "platform",
        label: "系统",
        critical: true,
        run: async () => ({ status: "pass", message: "Windows x64" }),
      },
      {
        id: "codex-cli",
        label: "Codex CLI",
        critical: true,
        run: async () => {
          throw new Error("C:\\Users\\CDD\\secret-token");
        },
      },
      {
        id: "notifications",
        label: "通知",
        critical: false,
        run: async () => ({ status: "warning", message: "未配置通知" }),
      },
    ];
    const doctor = createDoctor({ checks, appVersion: "0.1.0" });

    const report = await doctor.run();

    expect(report.items).toMatchObject([
      { id: "platform", status: "pass" },
      {
        id: "codex-cli",
        status: "fail",
        message: "检查失败，请查看 Doctor 建议",
      },
      { id: "notifications", status: "warning" },
    ]);
    expect(report.summary).toMatchObject({
      status: "failed",
      passed: 1,
      warnings: 1,
      failed: 1,
    });
    expect(JSON.stringify(report)).not.toContain("CDD");
    expect(JSON.stringify(report)).not.toContain("token");
  });

  it("marks a report ready only when every critical check passes", async () => {
    const doctor = createDoctor({
      checks: [
        {
          id: "platform",
          label: "系统",
          critical: true,
          run: async () => ({ status: "pass", message: "正常" }),
        },
        {
          id: "notifications",
          label: "通知",
          critical: false,
          run: async () => ({ status: "warning", message: "未配置通知" }),
        },
      ],
      appVersion: "0.1.0",
    });

    const report = await doctor.run();

    expect(report.criticalPassed).toBe(true);
    expect(report.summary.status).toBe("warning");
    expect(report.safeSummary).toEqual({
      appVersion: "0.1.0",
      status: "warning",
      passed: 1,
      warnings: 1,
      failed: 0,
    });
  });
});
