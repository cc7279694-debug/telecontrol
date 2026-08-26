import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("codexRemoteHost", {
  status: "preparing",
});
