import { zodResolver } from "@hookform/resolvers/zod";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthProvider";
import { ZakatCard } from "@/features/goals/GoalsList";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export function ZakatTab() {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const enabled = vault.profile.zakat_enabled;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Zakat tracking" />
        <CardBody className="flex flex-col gap-4">
          <Switch
            checked={enabled}
            onCheckedChange={(on) => run(() => updateProfile(userId, { zakat_enabled: on }), on ? "Zakat tracking on" : "Zakat tracking off")}
            label="Track Zakat"
            description="Shows the Nisab, your Hawl and when Zakat is due. Your wealth is checked once a day on the server."
          />
          <p className="text-sm text-ink-soft">
            Nisab: 85 g of 24k gold, priced with your gold settings. Hawl: 354 days (one lunar year) at or above the Nisab. Upcoming Income isn't counted.
          </p>
        </CardBody>
      </Card>
      {enabled ? <ZakatCard /> : null}
    </div>
  );
}

const passwordSchema = z
  .object({ password: z.string().min(6, "Use at least 6 characters"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function SecurityTab() {
  const { signOut } = useAuth();
  const toast = useToast();
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const form = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return toast.error(error.message);
    form.reset();
    toast.success("Password changed");
  });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Change password" />
        <CardBody>
          <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:max-w-md" noValidate>
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
      </Card>

      <ConfirmDialog
        open={confirmEverywhere}
        onOpenChange={setConfirmEverywhere}
        title="Sign out everywhere?"
        confirmLabel="Sign out of all devices"
        onConfirm={() => signOut({ everywhere: true })}
      >
        <p>You'll be signed out on this and every other phone, tablet and computer.</p>
      </ConfirmDialog>
    </div>
  );
}
