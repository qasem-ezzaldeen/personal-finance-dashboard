import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Badge, ColorDot } from "@/components/ui/misc";
import { ColorPicker } from "@/components/ui/pickers";
import { useActions } from "@/features/actions/ActionsProvider";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateAsset, updateGroup } from "@/lib/api";
import { formatMoney, formatQuantity } from "@/lib/format";
import type { AssetGroup } from "@/lib/types";
import { holdingQuantity } from "@/lib/valuation";

interface GroupEditorProps {
  open: boolean;
  group: AssetGroup | null;
  onClose: () => void;
}

function GroupEditor(props: GroupEditorProps) {
  const openKey = useOpenKey(props.open);
  return <GroupEditorContent key={`${openKey}-${props.group?.kind ?? ""}`} {...props} />;
}

function GroupEditorContent({ open, group, onClose }: GroupEditorProps) {
  const { userId } = useVault();
  const run = useVaultAction();
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState(group?.color ?? "sky");
  const [saving, setSaving] = useState(false);
  if (!group) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Edit group`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        const ok = await run(() => updateGroup(userId, group.kind, { name: name.trim(), color }), "Group saved");
        setSaving(false);
        if (ok) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Group name" error={name.trim() ? undefined : "Enter a name"}>
          {(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />}
        </Field>
        <ColorPicker value={color} onChange={setColor} label="Chart color" />
      </div>
    </Dialog>
  );
}

export function AccountsTab() {
  const { vault, summary } = useVault();
  const { openAsset } = useActions();
  const run = useVaultAction();
  // The last group stays set while the dialog closes, so its exit animation shows the same content
  const [editingGroup, setEditingGroup] = useState<AssetGroup | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const base = vault.profile.base_currency;
  const groups = [...vault.groups].sort((a, b) => a.sort_order - b.sort_order);

  const valueOf = (id: string) => summary.groups.flatMap((g) => g.assets).find((a) => a.asset.id === id)?.value ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Groups" subtitle="Rename or recolor the sections your assets are grouped into" />
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.kind}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingGroup(g);
                    setGroupOpen(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-surface-muted"
                >
                  <ColorDot color={g.color} className="size-4" />
                  <span className="flex-1 font-medium text-ink">{g.name}</span>
                  <Pencil className="size-4 text-ink-soft" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {groups.map((g) => {
        const assets = vault.assets.filter((a) => a.kind === g.kind).sort((a, b) => Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)) || a.sort_order - b.sort_order);
        if (assets.length === 0) return null;
        return (
          <Card key={g.kind}>
            <CardHeader title={g.name} />
            <CardBody className="px-2 sm:px-3">
              <ul className="flex flex-col divide-y divide-line">
                {assets.map((a) => {
                  const qty = holdingQuantity(a, vault.purchases.filter((p) => p.asset_id === a.id));
                  const archived = Boolean(a.archived_at);
                  const canArchive = !(a.kind === "cash" && Number(a.balance) !== 0);
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-2 py-3">
                      <ColorDot color={a.color} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-medium text-ink">
                          <span className="truncate">{a.name}</span>
                          {archived ? <Badge>Archived</Badge> : null}
                          {a.hide_when_empty ? <Badge tone="neutral">Hidden when empty</Badge> : null}
                        </p>
                        <p className="text-sm text-ink-soft tabular">
                          {a.kind === "cash" ? formatMoney(Number(a.balance), a.currency!) : formatQuantity(a.kind as "gold" | "stock" | "other", qty)}
                          {!archived && valueOf(a.id) !== null ? ` · ${formatMoney(valueOf(a.id), base)}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openAsset({ asset: a })} aria-label={`Edit ${a.name}`}>
                          <Pencil className="size-4" aria-hidden="true" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!archived && !canArchive}
                          title={!archived && !canArchive ? "Move its money elsewhere first" : undefined}
                          onClick={() =>
                            run(
                              () => updateAsset(a.id, { archived_at: archived ? null : new Date().toISOString() }),
                              archived ? `${a.name} restored` : `${a.name} archived. It's no longer counted.`,
                            )
                          }
                        >
                          {archived ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
                          {archived ? "Restore" : "Archive"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        );
      })}

      <GroupEditor open={groupOpen} group={editingGroup} onClose={() => setGroupOpen(false)} />
    </div>
  );
}
