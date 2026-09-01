import { z } from "zod";
import {
  ActionResultSchema,
  BeginDataResetResultSchema,
  DesktopStateSchema,
  confirmDataResetInputSchema,
  desktopChannels,
  removeWorkspaceInputSchema,
  requestOtpInputSchema,
  signInWithPasswordInputSchema,
  setOpenAtLoginInputSchema,
  stopHostInputSchema,
  verifyOtpInputSchema,
  type DesktopApi,
  type DesktopState,
} from "./contract.js";

type SenderFrame = {
  url: string;
  isDestroyed: () => boolean;
};

type ManagedWebContents = {
  sender?: unknown;
  mainFrame: SenderFrame;
  send: (channel: string, state: DesktopState) => void;
};

type ManagementWindow = {
  isDestroyed: () => boolean;
  webContents: ManagedWebContents;
};

export type IpcEvent = {
  sender: unknown;
  senderFrame: SenderFrame | null;
};

export type IpcMainBoundary = {
  handle: (
    channel: string,
    listener: (event: IpcEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void;
  removeHandler: (channel: string) => void;
};

export type DesktopIpcHandlers = Omit<DesktopApi, "subscribeDesktopState">;

type RegisterIpcControllerOptions = {
  ipcMain: IpcMainBoundary;
  getManagementWindow: () => ManagementWindow | undefined;
  handlers: DesktopIpcHandlers;
};

const invocationChannels = [
  desktopChannels.getDesktopState,
  desktopChannels.requestOtp,
  desktopChannels.verifyOtp,
  desktopChannels.signInWithPassword,
  desktopChannels.signOut,
  desktopChannels.chooseWorkspace,
  desktopChannels.removeWorkspace,
  desktopChannels.createPairingCode,
  desktopChannels.startHost,
  desktopChannels.stopHost,
  desktopChannels.runDoctor,
  desktopChannels.setOpenAtLogin,
  desktopChannels.openLogFolder,
  desktopChannels.beginDataReset,
  desktopChannels.confirmDataReset,
] as const;

function isTrustedManagementUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.protocol === "app:" &&
      parsedUrl.hostname === "host" &&
      parsedUrl.username === "" &&
      parsedUrl.password === "" &&
      parsedUrl.port === ""
    );
  } catch {
    return false;
  }
}

function assertTrustedSender(
  event: IpcEvent,
  getManagementWindow: () => ManagementWindow | undefined,
) {
  const managementWindow = getManagementWindow();
  const senderFrame = event.senderFrame;

  if (
    !managementWindow ||
    managementWindow.isDestroyed() ||
    event.sender !==
      (managementWindow.webContents.sender ?? managementWindow.webContents) ||
    !senderFrame ||
    senderFrame !== managementWindow.webContents.mainFrame ||
    senderFrame.isDestroyed() ||
    !isTrustedManagementUrl(senderFrame.url)
  ) {
    throw new Error("Unauthorized desktop IPC sender");
  }
}

export function registerIpcController({
  ipcMain,
  getManagementWindow,
  handlers,
}: RegisterIpcControllerOptions) {
  function register<TArgs extends unknown[], TResult>(
    channel: string,
    argsSchema: z.ZodType<TArgs>,
    resultSchema: z.ZodType<TResult>,
    handler: (...args: TArgs) => Promise<TResult>,
  ) {
    ipcMain.handle(channel, async (event, ...rawArgs) => {
      assertTrustedSender(event, getManagementWindow);

      let args: TArgs;
      try {
        args = argsSchema.parse(rawArgs);
      } catch {
        throw new Error("Invalid desktop IPC request");
      }

      let result: TResult;
      try {
        result = await handler(...args);
      } catch {
        throw new Error("Desktop IPC request failed");
      }

      try {
        return resultSchema.parse(result);
      } catch {
        throw new Error("Invalid desktop IPC response");
      }
    });
  }

  const noInput = z.tuple([]);
  register(
    desktopChannels.getDesktopState,
    noInput,
    DesktopStateSchema,
    handlers.getDesktopState,
  );
  register(
    desktopChannels.requestOtp,
    z.tuple([requestOtpInputSchema]),
    ActionResultSchema,
    handlers.requestOtp,
  );
  register(
    desktopChannels.verifyOtp,
    z.tuple([verifyOtpInputSchema]),
    ActionResultSchema,
    handlers.verifyOtp,
  );
  register(
    desktopChannels.signInWithPassword,
    z.tuple([signInWithPasswordInputSchema]),
    ActionResultSchema,
    handlers.signInWithPassword,
  );
  register(
    desktopChannels.signOut,
    noInput,
    ActionResultSchema,
    handlers.signOut,
  );
  register(
    desktopChannels.chooseWorkspace,
    noInput,
    ActionResultSchema,
    handlers.chooseWorkspace,
  );
  register(
    desktopChannels.removeWorkspace,
    z.tuple([removeWorkspaceInputSchema]),
    ActionResultSchema,
    handlers.removeWorkspace,
  );
  register(
    desktopChannels.createPairingCode,
    noInput,
    ActionResultSchema,
    handlers.createPairingCode,
  );
  register(
    desktopChannels.startHost,
    noInput,
    ActionResultSchema,
    handlers.startHost,
  );
  register(
    desktopChannels.stopHost,
    z.tuple([stopHostInputSchema]),
    ActionResultSchema,
    handlers.stopHost,
  );
  register(
    desktopChannels.runDoctor,
    noInput,
    ActionResultSchema,
    handlers.runDoctor,
  );
  register(
    desktopChannels.setOpenAtLogin,
    z.tuple([setOpenAtLoginInputSchema]),
    ActionResultSchema,
    handlers.setOpenAtLogin,
  );
  register(
    desktopChannels.openLogFolder,
    noInput,
    ActionResultSchema,
    handlers.openLogFolder,
  );
  register(
    desktopChannels.beginDataReset,
    noInput,
    BeginDataResetResultSchema,
    handlers.beginDataReset,
  );
  register(
    desktopChannels.confirmDataReset,
    z.tuple([confirmDataResetInputSchema]),
    ActionResultSchema,
    handlers.confirmDataReset,
  );

  return {
    dispose: () => {
      for (const channel of invocationChannels) {
        ipcMain.removeHandler(channel);
      }
    },
    publishDesktopState: (state: DesktopState) => {
      const safeState = DesktopStateSchema.parse(state);
      const managementWindow = getManagementWindow();

      if (!managementWindow || managementWindow.isDestroyed()) {
        return;
      }

      managementWindow.webContents.send(
        desktopChannels.stateChanged,
        safeState,
      );
    },
  };
}
