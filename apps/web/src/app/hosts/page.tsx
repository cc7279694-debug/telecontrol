export default function HostsPage(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-medium text-slate-500">Codex Remote</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">登录成功</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          电脑列表将在下一步接入。请保持 Windows Host 在线。
        </p>
      </section>
    </main>
  );
}
