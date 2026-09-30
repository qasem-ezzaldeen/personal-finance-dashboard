import * as RT from "@radix-ui/react-tabs";
import { Bot, Coins, Database, Landmark, Lock, Moon, Sparkles, UserRound, Vault } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import { AccountsTab } from "./AccountsTab";
import { AppearanceTab } from "./AppearanceTab";
import { AutomationsTab } from "./AutomationsTab";
import { DataTab } from "./DataTab";
import { MarketTab } from "./MarketTab";
import { PersonalTab } from "./PersonalTab";
import { VaultTab } from "./VaultTab";
import { SecurityTab, ZakatTab } from "./ZakatSecurityTabs";

const TABS = [
  { id: "personal", label: "Personal", icon: UserRound, render: () => <PersonalTab /> },
  { id: "vault", label: "Vault", icon: Vault, render: () => <VaultTab /> },
  { id: "appearance", label: "Appearance", icon: Sparkles, render: () => <AppearanceTab /> },
  { id: "accounts", label: "Accounts", icon: Landmark, render: () => <AccountsTab /> },
  { id: "automations", label: "Automations", icon: Bot, render: () => <AutomationsTab /> },
  { id: "market", label: "Market & pricing", icon: Coins, render: () => <MarketTab /> },
  { id: "zakat", label: "Zakat", icon: Moon, render: () => <ZakatTab /> },
  { id: "security", label: "Security", icon: Lock, render: () => <SecurityTab /> },
  { id: "data", label: "Data", icon: Database, render: () => <DataTab /> },
] as const;

export function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const current = TABS.some((t) => t.id === requested) ? requested! : "personal";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Profile & settings</h1>
        <p className="text-ink-soft">Everything about your vault, in one place.</p>
      </div>
      <RT.Root
        value={current}
        onValueChange={(tab) => setParams({ tab }, { replace: true })}
        orientation="vertical"
        className="grid grid-cols-1 gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]"
      >
        <RT.List
          aria-label="Settings sections"
          className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:sticky lg:top-24 lg:mx-0 lg:h-fit lg:flex-col lg:overflow-visible lg:px-0"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <RT.Trigger
              key={id}
              value={id}
              className={cn(
                "flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap text-ink-soft transition",
                "hover:bg-surface-muted hover:text-ink data-[state=active]:bg-brand data-[state=active]:text-brand-ink",
                "border border-line lg:border-transparent",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </RT.Trigger>
          ))}
        </RT.List>
        {TABS.map(({ id, render }) => (
          <RT.Content key={id} value={id} className="min-w-0 focus-visible:outline-none data-[state=active]:animate-page-in">
            {current === id ? render() : null}
          </RT.Content>
        ))}
      </RT.Root>
    </div>
  );
}
