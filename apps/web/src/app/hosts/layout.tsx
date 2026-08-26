import { RemoteSessionProvider } from "../../features/session/remote-session-context";

export default function HostsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RemoteSessionProvider>{children}</RemoteSessionProvider>;
}
