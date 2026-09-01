import { z } from "zod";

const workspaceStateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(32_767),
  })
  .strict();

const pairingDisplaySchema = z
  .object({
    code: z.string().regex(/^\d{6}$/),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const DesktopStateSchema = z
  .object({
    phase: z.enum(["ready", "error"]),
    authStatus: z.enum(["signed-out", "signed-in"]),
    maskedEmail: z.string().max(254).nullable().optional(),
    host: z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        protocolVersion: z.number().int().positive(),
      })
      .strict()
      .nullable()
      .optional(),
    hostStatus: z.enum([
      "stopped",
      "starting",
      "running",
      "degraded",
      "stopping",
      "error",
    ]),
    runtimeReason: z
      .enum([
        "awaiting-pairing",
        "transport-offline",
        "codex-restarting",
        "doctor-required",
      ])
      .nullable(),
    activeRemoteTurns: z.number().int().nonnegative(),
    lastObservedAt: z.string().datetime({ offset: true }).nullable(),
    lastErrorCode: z.string().max(100).nullable(),
    openAtLogin: z.boolean(),
    workspaces: z.array(workspaceStateSchema).max(100),
    pairing: pairingDisplaySchema.nullable(),
    notice: z.string().max(500).nullable(),
  })
  .strict();

export const ActionResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().min(1).max(500),
  })
  .strict();

export const BeginDataResetResultSchema = z
  .object({
    phrase: z.string().min(1).max(200),
  })
  .strict();

export const requestOtpInputSchema = z
  .object({
    email: z.string().trim().email().max(254),
  })
  .strict();

export const verifyOtpInputSchema = z
  .object({
    email: z.string().trim().email().max(254),
    token: z
      .string()
      .trim()
      .regex(/^\d{6,10}$/, "验证码必须是6到10位数字"),
  })
  .strict();

export const signInWithPasswordInputSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(512),
  })
  .strict();

export const removeWorkspaceInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
  })
  .strict();

export const setOpenAtLoginInputSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const stopHostInputSchema = z
  .object({
    force: z.boolean(),
  })
  .strict();

export const confirmDataResetInputSchema = z
  .object({
    phrase: z.string().min(1).max(200),
  })
  .strict();

export const desktopApiMethodNames = [
  "getDesktopState",
  "requestOtp",
  "verifyOtp",
  "signInWithPassword",
  "signOut",
  "chooseWorkspace",
  "removeWorkspace",
  "createPairingCode",
  "startHost",
  "stopHost",
  "runDoctor",
  "setOpenAtLogin",
  "openLogFolder",
  "beginDataReset",
  "confirmDataReset",
  "subscribeDesktopState",
] as const;

export const desktopChannels = {
  getDesktopState: "desktop:get-state",
  requestOtp: "desktop:request-otp",
  verifyOtp: "desktop:verify-otp",
  signInWithPassword: "desktop:sign-in-with-password",
  signOut: "desktop:sign-out",
  chooseWorkspace: "desktop:choose-workspace",
  removeWorkspace: "desktop:remove-workspace",
  createPairingCode: "desktop:create-pairing-code",
  startHost: "desktop:start-host",
  stopHost: "desktop:stop-host",
  runDoctor: "desktop:run-doctor",
  setOpenAtLogin: "desktop:set-open-at-login",
  openLogFolder: "desktop:open-log-folder",
  beginDataReset: "desktop:begin-data-reset",
  confirmDataReset: "desktop:confirm-data-reset",
  stateChanged: "desktop:state-changed",
} as const;

export type DesktopState = z.infer<typeof DesktopStateSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type RequestOtpInput = z.infer<typeof requestOtpInputSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpInputSchema>;
export type SignInWithPasswordInput = z.infer<
  typeof signInWithPasswordInputSchema
>;
export type RemoveWorkspaceInput = z.infer<typeof removeWorkspaceInputSchema>;
export type SetOpenAtLoginInput = z.infer<typeof setOpenAtLoginInputSchema>;
export type StopHostInput = z.infer<typeof stopHostInputSchema>;
export type ConfirmDataResetInput = z.infer<typeof confirmDataResetInputSchema>;

export type DesktopApi = {
  getDesktopState: () => Promise<DesktopState>;
  requestOtp: (input: RequestOtpInput) => Promise<ActionResult>;
  verifyOtp: (input: VerifyOtpInput) => Promise<ActionResult>;
  signInWithPassword: (input: SignInWithPasswordInput) => Promise<ActionResult>;
  signOut: () => Promise<ActionResult>;
  chooseWorkspace: () => Promise<ActionResult>;
  removeWorkspace: (input: RemoveWorkspaceInput) => Promise<ActionResult>;
  createPairingCode: () => Promise<ActionResult>;
  startHost: () => Promise<ActionResult>;
  stopHost: (input: StopHostInput) => Promise<ActionResult>;
  runDoctor: () => Promise<ActionResult>;
  setOpenAtLogin: (input: SetOpenAtLoginInput) => Promise<ActionResult>;
  openLogFolder: () => Promise<ActionResult>;
  beginDataReset: () => Promise<{ phrase: string }>;
  confirmDataReset: (input: ConfirmDataResetInput) => Promise<ActionResult>;
  subscribeDesktopState: (handler: (state: DesktopState) => void) => () => void;
};

export const unavailableActionResult: ActionResult = Object.freeze({
  ok: false,
  message: "此功能尚未启用",
});
