import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { AuthLayout } from "./AuthLayout";
import { useAuth } from "./AuthProvider";

const MIN_PASSWORD = 6;
const email = z.string().trim().min(1, "Enter your email address").email("Enter a valid email address");
const password = z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`);

function appUrl(path = ""): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${path}`;
}

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Try again or reset your password.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first. Check your inbox for the link.";
  if (/already registered|already exists/i.test(message)) return "There's already a vault for this email. Sign in instead.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  return message;
}

// ---------------------------------------------------------------------------

const signInSchema = z.object({ email, password: z.string().min(1, "Enter your password") });

export function SignInPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword(values);
    if (authError) return setError(friendlyAuthError(authError.message));
    navigate("/", { replace: true });
  });

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your private vault."
      footer={
        <>
          New here?{" "}
          <Link to="/register" className="font-medium text-brand-ink underline-offset-4 hover:underline">
            Create a vault
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error ? <Notice tone="loss">{error}</Notice> : null}
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register("email")} />}
        </Field>
        <Field
          label="Password"
          error={form.formState.errors.password?.message}
          labelAside={
            <Link to="/forgot-password" className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline">
              Forgot?
            </Link>
          }
        >
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register("password")} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting} className="mt-2 w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------

const registerSchema = z
  .object({ email, password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function RegisterPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [checkInbox, setCheckInbox] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(registerSchema), defaultValues: { email: "", password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ email: address, password: secret }) => {
    setError(null);
    const { data, error: authError } = await supabase.auth.signUp({
      email: address,
      password: secret,
      options: { emailRedirectTo: appUrl() },
    });
    if (authError) return setError(friendlyAuthError(authError.message));
    if (data.session) navigate("/", { replace: true });
    else setCheckInbox(address);
  });

  if (checkInbox) {
    return (
      <AuthLayout title="Check your inbox" subtitle={`We sent a confirmation link to ${checkInbox}.`}>
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-gain p-6 text-center text-gain-ink">
          <MailCheck className="size-10" aria-hidden="true" />
          <p>Open the link in the email to finish creating your vault, then sign in.</p>
        </div>
        <Link to="/login" className="mt-6 block text-center font-medium text-brand-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your vault"
      subtitle="Your data is private: only you can see it."
      footer={
        <>
          Already have a vault?{" "}
          <Link to="/login" className="font-medium text-brand-ink underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error ? <Notice tone="loss">{error}</Notice> : null}
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register("email")} />}
        </Field>
        <Field label="Password" hint={`At least ${MIN_PASSWORD} characters`} error={form.formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("password")} />}
        </Field>
        <Field label="Confirm password" error={form.formState.errors.confirm?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("confirm")} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting} className="mt-2 w-full">
          Create vault
        </Button>
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(z.object({ email })), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async ({ email: address }) => {
    setError(null);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: appUrl("reset-password") });
    if (authError) return setError(friendlyAuthError(authError.message));
    setSentTo(address);
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link to="/login" className="font-medium text-brand-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <Notice tone="gain">If a vault exists for {sentTo}, a reset link is on its way. Open it on this device to set a new password.</Notice>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error ? <Notice tone="loss">{error}</Notice> : null}
          <Field label="Email" error={form.formState.errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" {...form.register("email")} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------

const newPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function ResetPasswordPage() {
  const { status, finishRecovery } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ password: secret }) => {
    setError(null);
    const { error: authError } = await supabase.auth.updateUser({ password: secret });
    if (authError) return setError(friendlyAuthError(authError.message));
    finishRecovery();
    navigate("/", { replace: true });
  });

  if (status === "signedOut") {
    return (
      <AuthLayout title="This link has expired" subtitle="Reset links work once and only for a short time.">
        <Link to="/forgot-password" className="font-medium text-brand-ink underline-offset-4 hover:underline">
          Send a new reset link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error ? <Notice tone="loss">{error}</Notice> : null}
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters`} error={form.formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("password")} />}
        </Field>
        <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("confirm")} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting} className="w-full" disabled={status === "loading"}>
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}
