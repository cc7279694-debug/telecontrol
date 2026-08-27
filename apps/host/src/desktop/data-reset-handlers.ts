import type {
  ActionResult,
  ConfirmDataResetInput,
  DesktopApi,
} from "./contract.js";

export type DataResetDesktopHandlers = Pick<
  DesktopApi,
  "beginDataReset" | "confirmDataReset"
>;

type DataResetControllerPort = {
  begin: () => { phrase: string };
  confirm: (input: ConfirmDataResetInput) => Promise<ActionResult>;
};

export function createDataResetHandlers(
  controller: DataResetControllerPort,
): DataResetDesktopHandlers {
  return {
    beginDataReset: async () => controller.begin(),
    confirmDataReset: (input) => controller.confirm(input),
  };
}
