type LoginItemApp = {
  setLoginItemSettings: (settings: {
    openAtLogin: boolean;
    path: string;
    args: string[];
  }) => void;
  getLoginItemSettings: (options: { path: string; args: string[] }) => {
    openAtLogin: boolean;
  };
};

const hiddenLaunchArgs = ["--hidden"] as const;

export function createLoginItemController(
  app: LoginItemApp,
  executablePath = process.execPath,
) {
  const verificationOptions = () => ({
    path: executablePath,
    args: [...hiddenLaunchArgs],
  });

  function isEnabled() {
    return app.getLoginItemSettings(verificationOptions()).openAtLogin;
  }

  return {
    isEnabled,
    setEnabled: (enabled: boolean) => {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        ...verificationOptions(),
      });

      return isEnabled() === enabled;
    },
  };
}

export type LoginItemController = ReturnType<typeof createLoginItemController>;
