import type { Asset, Purchase, VaultData } from "./types";

/** How long the server waits before retrying a lookup that found no price. */
export const ESTIMATE_RETRY_HOURS = 12;

export type PriceState =
  | "entered" // the user typed the price paid
  | "estimated" // filled in from the market price on the purchase date
  | "looking-up" // no price yet; the server will look it up
  | "not-found" // looked up recently, no market price for that date
  | "untrackable"; // "other" assets have no market price

export function purchasePriceState(purchase: Purchase, asset: Asset, now = Date.now()): PriceState {
  if (purchase.cost_total !== null) return purchase.cost_is_estimated ? "estimated" : "entered";
  if (asset.kind !== "gold" && asset.kind !== "stock") return "untrackable";
  const attempted = purchase.cost_estimate_attempted_at ? Date.parse(purchase.cost_estimate_attempted_at) : null;
  if (attempted !== null && now - attempted < ESTIMATE_RETRY_HOURS * 3600_000) return "not-found";
  return "looking-up";
}

/** Ids of purchases the server should estimate now (stable order, for change detection). */
export function purchasesToEstimate(vault: VaultData, now = Date.now()): string[] {
  const assets = new Map(vault.assets.map((a) => [a.id, a]));
  return vault.purchases
    .filter((p) => {
      const asset = assets.get(p.asset_id);
      return asset && !asset.archived_at && purchasePriceState(p, asset, now) === "looking-up";
    })
    .map((p) => p.id)
    .sort();
}
