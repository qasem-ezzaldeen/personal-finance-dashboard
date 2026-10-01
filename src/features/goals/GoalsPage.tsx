import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { GoalDialog } from "./GoalDialog";
import { GoalsList } from "./GoalsList";

export function GoalsPage() {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Goals</h1>
          <p className="text-ink-soft">Drag goals to reorder them. Reserved goals are filled from the top down.</p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" /> New goal
        </Button>
      </div>

      <div className="max-w-3xl">
        <GoalsList />
      </div>
      <GoalDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}
