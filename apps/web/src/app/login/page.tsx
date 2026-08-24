import { OtpLoginForm } from "../../features/auth/otp-login-form";

export default function LoginPage(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-10">
        <OtpLoginForm />
      </section>
    </main>
  );
}
