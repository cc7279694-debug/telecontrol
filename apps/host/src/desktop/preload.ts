import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";
import {
  ActionResultSchema,
  BeginDataResetResultSchema,
  DesktopStateSchema,
  confirmDataResetInputSchema,
  desktopChannels,
  removeWorkspaceInputSchema,
  requestOtpInputSchema,
  setOpenAtLoginInputSchema,
  stopHostInputSchema,
  verifyOtpInputSchema,
  type DesktopApi,
} from "./contract.js";

async function invokeAndParse<TResult>(
  channel: string,
  resultSchema: z.ZodType<TResult>,
  ...args: unknown[]
) {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);
  return resultSchema.parse(result);
}

const desktopApi: DesktopApi = Object.freeze({
  getDesktopState: () =>
    invokeAndParse(desktopChannels.getDesktopState, DesktopStateSchema),
  requestOtp: (input) =>
    invokeAndParse(
      desktopChannels.requestOtp,
      ActionResultSchema,
      requestOtpInputSchema.parse(input),
    ),
  verifyOtp: (input) =>
    invokeAndParse(
      desktopChannels.verifyOtp,
      ActionResultSchema,
      verifyOtpInputSchema.parse(input),
    ),
  signOut: () => invokeAndParse(desktopChannels.signOut, ActionResultSchema),
  chooseWorkspace: () =>
    invokeAndParse(desktopChannels.chooseWorkspace, ActionResultSchema),
  removeWorkspace: (input) =>
    invokeAndParse(
      desktopChannels.removeWorkspace,
      ActionResultSchema,
      removeWorkspaceInputSchema.parse(input),
    ),
  createPairingCode: () =>
    invokeAndParse(desktopChannels.createPairingCode, ActionResultSchema),
  startHost: () =>
    invokeAndParse(desktopChannels.startHost, ActionResultSchema),
  stopHost: (input) =>
    invokeAndParse(
      desktopChannels.stopHost,
      ActionResultSchema,
      stopHostInputSchema.parse(input),
    ),
  runDoctor: () =>
    invokeAndParse(desktopChannels.runDoctor, ActionResultSchema),
  setOpenAtLogin: (input) =>
    invokeAndParse(
      desktopChannels.setOpenAtLogin,
      ActionResultSchema,
      setOpenAtLoginInputSchema.parse(input),
    ),
  openLogFolder: () =>
    invokeAndParse(desktopChannels.openLogFolder, ActionResultSchema),
  beginDataReset: () =>
    invokeAndParse(desktopChannels.beginDataReset, BeginDataResetResultSchema),
  confirmDataReset: (input) =>
    invokeAndParse(
      desktopChannels.confirmDataReset,
      ActionResultSchema,
      confirmDataResetInputSchema.parse(input),
    ),
  subscribeDesktopState: (handler) => {
    const listener = (_event: unknown, rawState: unknown) => {
      const state = DesktopStateSchema.safeParse(rawState);
      if (state.success) {
        handler(state.data);
      }
    };

    ipcRenderer.on(desktopChannels.stateChanged, listener);
    let subscribed = true;

    return () => {
      if (!subscribed) {
        return;
      }

      subscribed = false;
      ipcRenderer.removeListener(desktopChannels.stateChanged, listener);
    };
  },
});

contextBridge.exposeInMainWorld("codexRemoteHost", desktopApi);
