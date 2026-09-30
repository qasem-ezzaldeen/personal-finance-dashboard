import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, TrendArrow } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { useActions } from "@/features/actions/ActionsProvider";
import { queryKeys, useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { requestMarketRefresh, unfollowTicker } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatAge, formatMoney } from "@/lib/format";
import { useMotionScale } from "@/lib/motion";
import { GOLD_21K_RATIO, convert, gold24kPerGram, gold24kTrend, pairTrend, stockPrice } from "@/lib/valuation";

const STALE_MINUTES = { fx: 6 * 60, gold: 6 * 60, stock: 3 * 24 * 60 };

interface Pill {
  key: string;
  label: string;
  value: string;
  trend: number;
  fetchedAt: string | null;
  staleAfter: number;
  badge?: string;
  onClick?: () => void;
  onRemove?: () => void;
}

const CAROUSEL_PX_PER_SECOND = 30;

/** Measures whether the pills overflow their space; if so (and animations are on) they auto-scroll. */
function useCarousel(motion: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLUListElement>(null);
  const [size, setSize] = useState({ content: 0, viewport: 0 });

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(() => setSize({ content: content.scrollWidth, viewport: viewport.clientWidth }));
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return {
    viewportRef,
    contentRef,
    contentWidth: size.content,
    scrolling: motion > 0 && size.content > size.viewport + 1,
  };
}

function isStale(fetchedAt: string | null, minutes: number, now: Date) {
  return fetchedAt !== null && now.getTime() - Date.parse(fetchedAt) > minutes * 60000;
}

export function RatesStrip() {
  const { vault, ctx, book, summary, now, userId } = useVault();
  const { openFollowTicker } = useActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const run = useVaultAction();
  const [refreshing, setRefreshing] = useState(false);
  const motion = useMotionScale();
  const { viewportRef, contentRef, contentWidth, scrolling } = useCarousel(motion);

  const base = vault.profile.base_currency;
  const active = vault.assets.filter((a) => !a.archived_at);
  const holdings = active.filter((a) => a.kind !== "pending_income");
  const isEmpty = holdings.length === 0 && (summary.pending?.quantity ?? 0) === 0;

  // Currency pairs for every currency in use, plus the chosen display currencies
  const currencies = new Set<string>(isEmpty ? ["USD"] : []);
  if (!isEmpty) {
    for (const a of active) if (a.currency && (a.kind !== "pending_income" || Number(a.balance) > 0)) currencies.add(a.currency);
    for (const c of vault.profile.display_currencies) currencies.add(c);
  }
  currencies.delete(base);

  const pills: Pill[] = [];
  for (const code of currencies) {
    pills.push({
      key: `fx-${code}`,
      label: `${code}/${base}`,
      value: formatMoney(convert(1, code, base, book), base),
      trend: pairTrend(code, base, book),
      fetchedAt: book.fx.get(code)?.fetched_at ?? book.fx.get(base)?.fetched_at ?? null,
      staleAfter: STALE_MINUTES.fx,
    });
  }

  const manual = vault.pricing.gold_mode === "manual";
  const has24 = isEmpty || holdings.some((a) => a.kind === "gold" && a.karat === 24);
  const has21 = holdings.some((a) => a.kind === "gold" && a.karat === 21);
  const p24 = gold24kPerGram(ctx, base);
  const openPricing = () => navigate("/profile?tab=market");
  if (has24) {
    pills.push({
      key: "gold24",
      label: "Gold 24k/g",
      value: formatMoney(p24, base),
      trend: gold24kTrend(ctx),
      fetchedAt: manual ? null : (book.xau?.fetched_at ?? null),
      staleAfter: STALE_MINUTES.gold,
      badge: manual ? "Manual" : undefined,
      onClick: openPricing,
    });
  }
  if (has21) {
    pills.push({
      key: "gold21",
      label: "Gold 21k/g",
      value: formatMoney(p24 === null ? null : p24 * GOLD_21K_RATIO, base),
      trend: gold24kTrend(ctx),
      fetchedAt: manual ? null : (book.xau?.fetched_at ?? null),
      staleAfter: STALE_MINUTES.gold,
      badge: manual ? "Manual" : undefined,
      onClick: openPricing,
    });
  }

  const held = new Set(holdings.filter((a) => a.kind === "stock" && a.ticker).map((a) => a.ticker!));
  if (isEmpty) held.add("SPUS");
  const tickerPill = (ticker: string, removable: boolean): Pill => {
    const quote = stockPrice(ticker, ctx);
    return {
      key: `stock-${ticker}`,
      label: ticker,
      value: quote ? formatMoney(quote.price, quote.currency) : "—",
      trend: quote && quote.previous ? Math.sign(quote.price - quote.previous) : 0,
      fetchedAt: quote?.fetchedAt ?? null,
      staleAfter: STALE_MINUTES.stock,
      badge: quote?.isOverride ? "Manual" : undefined,
      onRemove: removable
        ? () => run(() => unfollowTicker(userId, ticker), `Stopped following ${ticker}`)
        : undefined,
    };
  };
  for (const t of held) pills.push(tickerPill(t, false));
  for (const f of [...vault.followed].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!held.has(f.ticker)) pills.push(tickerPill(f.ticker, true));
  }

  const refresh = async () => {
    setRefreshing(true);
    try {
      await requestMarketRefresh();
    } catch (err) {
      toast.error(err);
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.prices });
      setRefreshing(false);
    }
  };

  // `echo` is the duplicate copy that makes the carousel loop seamlessly; it's hidden from assistive tech
  const renderPill = (pill: Pill, echo: boolean) => {
    const stale = isStale(pill.fetchedAt, pill.staleAfter, now);
    const content = (
      <>
        <span className="text-ink-soft">{pill.label}</span>
        <span className="font-semibold text-ink tabular">{pill.value}</span>
        <TrendArrow trend={pill.trend} />
        {pill.badge ? <Badge tone="gold">{pill.badge}</Badge> : null}
      </>
    );
    const title = pill.fetchedAt ? `Updated ${formatAge(pill.fetchedAt, now.getTime())}${stale ? " (may be out of date)" : ""}` : undefined;
    return (
      <li
        key={pill.key}
        className={cn("flex shrink-0 items-center rounded-full border border-line bg-surface text-sm shadow-soft", stale && "opacity-60")}
        title={title}
      >
        {pill.onClick ? (
          <button
            type="button"
            onClick={pill.onClick}
            tabIndex={echo ? -1 : undefined}
            className="flex items-center gap-1.5 rounded-full py-1.5 pr-3 pl-3 hover:bg-surface-muted"
          >
            {content}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 py-1.5 pr-3 pl-3">{content}</span>
        )}
        {pill.onRemove ? (
          <button
            type="button"
            onClick={pill.onRemove}
            tabIndex={echo ? -1 : undefined}
            className="-ml-1.5 mr-1 grid size-6 place-items-center rounded-full text-ink-soft hover:bg-loss hover:text-loss-ink"
            aria-label={`Stop following ${pill.label}`}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </li>
    );
  };

  const duration = contentWidth / (CAROUSEL_PX_PER_SECOND / Math.max(motion, 0.01));

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {/* When the pills don't fit, they scroll on their own (paused on hover, touch or keyboard focus) */}
      <div
        ref={viewportRef}
        className={cn(
          "group relative min-w-0 flex-1 py-0.5",
          scrolling
            ? "overflow-hidden [mask-image:linear-gradient(to_right,transparent,var(--color-ink)_20px,var(--color-ink)_calc(100%-20px),transparent)]"
            : "scrollbar-none overflow-x-auto",
        )}
        data-carousel={scrolling ? "scrolling" : "static"}
      >
        <div
          className={cn(
            "flex w-max",
            scrolling &&
              "animate-marquee group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused] group-active:[animation-play-state:paused]",
          )}
          style={scrolling ? { animationDuration: `${duration}s` } : undefined}
        >
          <ul ref={contentRef} className="flex items-center gap-2 pr-2" aria-label="Live rates">
            {pills.map((pill) => renderPill(pill, false))}
          </ul>
          {scrolling ? (
            <ul className="flex items-center gap-2 pr-2" aria-hidden="true">
              {pills.map((pill) => renderPill(pill, true))}
            </ul>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={openFollowTicker}
        className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-sm text-ink-soft hover:bg-surface hover:text-ink sm:px-3"
        aria-label="Follow a stock or ETF"
      >
        <Plus className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Follow</span>
      </button>
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="flex h-9 shrink-0 items-center gap-2 rounded-full px-2.5 text-sm text-ink-soft hover:bg-surface hover:text-ink"
        title="Refresh prices"
        aria-label={`Refresh prices. Last updated ${formatAge(book.newestFetch, now.getTime())}`}
      >
        <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
        <span className="hidden tabular lg:inline">{formatAge(book.newestFetch, now.getTime())}</span>
      </button>
    </div>
  );
}
