import type { Metadata, Viewport } from "next";
import { InstallPrompt } from "../components/install-prompt";
import { ServiceWorkerRegister } from "../components/service-worker-register";
import { ThemeProvider } from "../components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Remote",
  description: "安全连接 Windows 上的 Codex",
};

export const viewport: Viewport = {
  themeColor: "#f4f6f8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ServiceWorkerRegister />
          <InstallPrompt />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
