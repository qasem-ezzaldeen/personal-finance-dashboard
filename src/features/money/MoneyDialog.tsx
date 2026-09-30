import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { MoneyForm, type MoneyTab } from "./MoneyForm";

export type { MoneyTab };

export function MoneyDialog({
  open,
  onOpenChange,
  initialTab,
  initialFromId,
  initialToId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab: MoneyTab;
  initialFromId?: string;
  initialToId?: string;
}) {
  const openKey = useOpenKey(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Income & transfers">
      <MoneyForm
        key={`${openKey}-${initialTab}-${initialFromId ?? ""}-${initialToId ?? ""}`}
        initialTab={initialTab}
        initialFromId={initialFromId}
        initialToId={initialToId}
        onDone={() => onOpenChange(false)}
      />
      <div className="h-2" />
    </Dialog>
  );
}
