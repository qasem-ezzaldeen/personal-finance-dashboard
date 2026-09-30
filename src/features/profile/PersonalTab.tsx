import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notice } from "@/components/ui/misc";
import { ColorPicker } from "@/components/ui/pickers";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthProvider";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { timeZoneOptions } from "@/lib/currencies";
import { supabase } from "@/lib/supabase";

export function PersonalTab() {
  const { vault, userId } = useVault();
  const { user } = useAuth();
  const run = useVaultAction();
  const toast = useToast();
  const p = vault.profile;
  const zones = useMemo(() => timeZoneOptions(), []);

  const [fullName, setFullName] = useState(p.full_name);
  const [displayName, setDisplayName] = useState(p.display_name);
  const [phone, setPhone] = useState(p.phone);
  const [country, setCountry] = useState(p.country);
  const [timezone, setTimezone] = useState(p.timezone);
  const [avatarColor, setAvatarColor] = useState(p.avatar_color);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState(user?.email ?? "");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await run(
      () =>
        updateProfile(userId, {
          full_name: fullName.trim(),
          display_name: displayName.trim(),
          phone: phone.trim(),
          country: country.trim(),
          timezone,
          avatar_color: avatarColor,
        }),
      "Profile saved",
    );
    setSaving(false);
  };

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || email.trim() === user?.email) return;
    setEmailSaving(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setEmailSaving(false);
    if (error) return toast.error(error.message);
    setEmailNotice(`We sent a confirmation link to ${email.trim()}. The change takes effect after you confirm it.`);
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Personal details" subtitle="Only you can see these." />
        <CardBody>
          <form onSubmit={save} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">{(f) => <Input {...f} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} autoComplete="name" />}</Field>
              <Field label="Display name" hint="Shown in the menu">
                {(f) => <Input {...f} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} autoComplete="nickname" />}
              </Field>
              <Field label="Phone (optional)">{(f) => <Input {...f} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="tel" />}</Field>
              <Field label="Country">{(f) => <Input {...f} value={country} onChange={(e) => setCountry(e.target.value)} maxLength={60} autoComplete="country-name" />}</Field>
              <Field label="Time zone" hint="Used for dates, automations and the daily Zakat check" className="sm:col-span-2">
                {(f) => (
                  <Select {...f} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <ColorPicker label="Avatar color" value={avatarColor} onChange={setAvatarColor} />
            <Button type="submit" variant="primary" loading={saving} className="self-start">
              Save details
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Email address" subtitle="Used to sign in" />
        <CardBody>
          <form onSubmit={changeEmail} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
            <Field label="Email" className="flex-1">
              {(f) => <Input {...f} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
            </Field>
            <Button type="submit" loading={emailSaving} disabled={!email.trim() || email.trim() === user?.email}>
              Change email
            </Button>
          </form>
          {emailNotice ? (
            <div className="mt-3">
              <Notice tone="brand">{emailNotice}</Notice>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
