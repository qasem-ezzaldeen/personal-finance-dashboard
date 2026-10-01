import { zodResolver } from "@hookform/resolvers/zod";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/misc";
import { ColorPicker } from "@/components/ui/pickers";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthProvider";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/** Your account: how you appear, how you sign in and where you're signed in. App settings live in Settings. */
export function ProfilePage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Profile</h1>
        <p className="text-ink-soft">Your account and how you sign in.</p>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <DetailsCard />
          <EmailCard />
        </div>
        <div className="flex flex-col gap-5">
          <PasswordCard />
          <SessionsCard />
        </div>
      </div>
    </div>
  );
}

function DetailsCard() {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const p = vault.profile;
  const [displayName, setDisplayName] = useState(p.display_name);
  const [avatarColor, setAvatarColor] = useState(p.avatar_color);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await run(() => updateProfile(userId, { display_name: displayName.trim(), avatar_color: avatarColor }), "Profile saved");
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader title="Your details" subtitle="Only you can see these." />
      <CardBody>
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <Field label="Display name" hint="Shown in the menu">
            {(f) => <Input {...f} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} autoComplete="nickname" />}
          </Field>
          <ColorPicker label="Avatar color" value={avatarColor} onChange={setAvatarColor} />
          <Button type="submit" variant="primary" loading={saving} className="self-start">
            Save details
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function EmailCard() {
  const { user } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || email.trim() === user?.email) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setSaving(false);
    if (error) return toast.error(error.message);
    setNotice(`We sent a confirmation link to ${email.trim()}. The change takes effect after you confirm it.`);
  };

  return (
    <Card>
      <CardHeader title="Email address" subtitle="Used to sign in" />
      <CardBody>
        <form onSubmit={changeEmail} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
          <Field label="Email" className="flex-1">
            {(f) => <Input {...f} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
          </Field>
          <Button type="submit" loading={saving} disabled={!email.trim() || email.trim() === user?.email}>
            Change email
          </Button>
        </form>
        {notice ? (
          <div className="mt-3">
            <Notice tone="brand">{notice}</Notice>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

const passwordSchema = z
  .object({ password: z.string().min(6, "Use at least 6 characters"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

function PasswordCard() {
  const toast = useToast();
  const form = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return toast.error(error.message);
    form.reset();
    toast.success("Password changed");
  });

  return (
    <Card>
      <CardHeader title="Change password" />
      <CardBody>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="New password" error={form.formState.errors.password?.message}>
            {(f) => <Input {...f} type="password" autoComplete="new-password" {...form.register("password")} />}
          </Field>
          <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
            {(f) => <Input {...f} type="password" autoComplete="new-password" {...form.register("confirm")} />}
          </Field>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="self-start">
            Change password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const { signOut } = useAuth();
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  return (
    <Card>
      <CardHeader title="Sessions" />
      <CardBody className="flex flex-wrap gap-2">
        <Button onClick={() => signOut()}>
          <LogOut className="size-4" aria-hidden="true" /> Sign out
        </Button>
        <Button variant="danger" onClick={() => setConfirmEverywhere(true)}>
          <MonitorSmartphone className="size-4" aria-hidden="true" /> Sign out of all devices
        </Button>
      </CardBody>
      <ConfirmDialog
        open={confirmEverywhere}
        onOpenChange={setConfirmEverywhere}
        title="Sign out everywhere?"
        confirmLabel="Sign out of all devices"
        onConfirm={() => signOut({ everywhere: true })}
      >
        <p>You'll be signed out on this and every other phone, tablet and computer.</p>
      </ConfirmDialog>
    </Card>
  );
}
