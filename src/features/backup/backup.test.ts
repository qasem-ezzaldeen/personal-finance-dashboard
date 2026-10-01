import { asset, purchase, vault } from "@/test/fixtures";
import type { Goal } from "@/lib/types";
import { BackupError, buildBackup, readBackup } from "./backup";

describe("backups", () => {
  const gold = asset({ kind: "gold", karat: 24, name: "Ingots", id: "ingots" });
  const data = vault({
    assets: [asset({ kind: "pending_income", currency: "USD", name: "Upcoming Income" }), asset({ kind: "cash", currency: "EGP", name: "Bank" }), gold],
    purchases: [purchase({ asset_id: "ingots", quantity: 5 })],
    goals: [
      { id: "z", is_system: true, name: "Zakat threshold" } as Goal,
      { id: "g", is_system: false, name: "House" } as Goal,
    ],
  });

  it("reads back what it writes", () => {
    const text = JSON.stringify(buildBackup(data, [], []));
    const { summary } = readBackup(text);
    expect(summary).toMatchObject({ vaultName: "My Vault", assets: 2, purchases: 1, sales: 0, goals: 1, transactions: 0, revertable: true });
  });

  it("accepts backups from before buy/sell, with read-only history", () => {
    const { transaction_changes: _ignored, ...older } = buildBackup(data, [], []);
    void _ignored;
    expect(readBackup(JSON.stringify(older)).summary.revertable).toBe(false);
  });

  it("rejects anything else with a clear message", () => {
    expect(() => readBackup("not json")).toThrow(BackupError);
    expect(() => readBackup(JSON.stringify({ hello: "world" }))).toThrow(/isn't an AuraFinance backup/);
    expect(() => readBackup(JSON.stringify({ app: "AuraFinance", profile: {}, assets: [{ id: "x", kind: "car", name: "?" }] }))).toThrow(BackupError);
  });
});
