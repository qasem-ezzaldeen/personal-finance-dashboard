import * as DM from "@radix-ui/react-dropdown-menu";
import {
  ArrowLeftRight,
  CirclePlus,
  LayoutDashboard,
  LogOut,
  Plus,
  ReceiptText,
  Target,
  UserRound,
  Wallet,
  HandCoins,
  Landmark,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Dialog } from "@/components/ui/Dialog";
import { useActions } from "@/features/actions/ActionsProvider";
import { useAuth } from "@/features/auth/AuthProvider";
import { RatesStrip } from "@/features/market/RatesStrip";
import { useVault } from "@/features/vault/VaultProvider";
import { cn, colorValue } from "@/lib/cn";
import { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard, end: true },
  { to: "/assets", label: "Assets", short: "Assets", icon: Wallet },
  { to: "/activity", label: "Activity", short: "Activity", icon: ReceiptText },
  { to: "/goals", label: "Goals", short: "Goals", icon: Target },
];

function Avatar({ size = "md" }: { size?: "sm" | "md" }) {
  const { vault } = useVault();
  const { user } = useAuth();
  const name = vault.profile.display_name || user?.email || "?";
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-ink", size === "sm" ? "size-8 text-sm" : "size-10")}
      style={{ background: colorValue(vault.profile.avatar_color) }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function UserMenu() {
  const { signOut, user } = useAuth();
  const { vault } = useVault();
  const navigate = useNavigate();
  return (
    <DM.Root>
      <DM.Trigger
        className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-muted xl:pr-3"
        aria-label="Account menu"
      >
        <Avatar size="sm" />
        <span className="hidden max-w-32 truncate text-sm font-medium text-ink xl:inline">
          {vault.profile.display_name || user?.email}
        </span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 rounded-2xl border border-line bg-surface p-1.5 shadow-lifted animate-pop-in"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{vault.profile.display_name || "Your vault"}</p>
            <p className="truncate text-xs text-ink-soft">{user?.email}</p>
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item
            onSelect={() => navigate("/profile")}
            className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-surface-muted"
          >
            <UserRound className="size-4" aria-hidden="true" /> Profile
          </DM.Item>
          <DM.Item
            onSelect={() => navigate("/settings")}
            className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-surface-muted"
          >
            <Settings className="size-4" aria-hidden="true" /> Settings
          </DM.Item>
          <DM.Item
            onSelect={() => signOut()}
            className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-loss-ink outline-none data-[highlighted]:bg-loss"
          >
            <LogOut className="size-4" aria-hidden="true" /> Sign out
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function Sidebar() {
  const { vault } = useVault();
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 md:flex xl:w-64 xl:px-4"
    >
      <div className="mb-6 flex items-center gap-3 px-1.5">
        <Logo className="size-10" />
        <span className="hidden truncate text-lg font-semibold text-ink xl:inline">{vault.profile.vault_name}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              title={label}
              className={({ isActive }) =>
                cn(
                  "flex h-12 items-center justify-center gap-3 rounded-xl text-[0.95rem] font-medium transition xl:justify-start xl:px-3.5",
                  isActive ? "bg-brand text-brand-ink" : "text-ink-soft hover:bg-surface-muted hover:text-ink",
                )
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="sr-only xl:not-sr-only">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BottomNav() {
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur md:hidden">
      <ul className="grid grid-cols-4">
        {NAV.map(({ to, short, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn("flex h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-medium", isActive ? "text-brand-ink" : "text-ink-soft")
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full transition", isActive && "bg-brand")}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  {short}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function QuickAddButton() {
  const [open, setOpen] = useState(false);
  const { openMoney, openAsset } = useActions();
  const choose = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const options = [
    { label: "Log income", hint: "Add to Upcoming Income", icon: HandCoins, run: () => openMoney("income") },
    { label: "Hourly project", hint: "Hours × rate", icon: CirclePlus, run: () => openMoney("hourly") },
    { label: "Transfer", hint: "Move money between accounts", icon: ArrowLeftRight, run: () => openMoney("transfer") },
    { label: "Add asset", hint: "Cash, gold, stocks or other", icon: Landmark, run: () => openAsset() },
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-2xl bg-brand-strong text-on-brand-strong shadow-lifted transition active:scale-95 md:hidden"
        aria-label="Add"
      >
        <Plus className="size-6" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="What would you like to add?">
        <ul className="grid gap-2 pb-2">
          {options.map(({ label, hint, icon: Icon, run }) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => choose(run)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left hover:bg-surface-muted"
              >
                <span className="grid size-11 place-items-center rounded-xl bg-brand text-brand-ink">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-medium text-ink">{label}</span>
                  <span className="block text-sm text-ink-soft">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

export function AppShell() {
  const { vault } = useVault();
  const location = useLocation();
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="flex items-center gap-2 px-4 pt-3 md:hidden">
            <Logo className="size-8" />
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">{vault.profile.vault_name}</span>
            <UserMenu />
          </div>
          <div className="flex items-center gap-3 px-4 py-2.5 md:px-6">
            <RatesStrip />
            <div className="hidden md:block">
              <UserMenu />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-4 pb-28 md:px-6 md:pt-6 md:pb-10">
          {/* Each page slides in softly when you navigate */}
          <div key={location.pathname} className="animate-page-in">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
      <QuickAddButton />
    </div>
  );
}
