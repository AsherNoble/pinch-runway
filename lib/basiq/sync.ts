import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankAccounts,
  bankSnapshots,
  runwayProfiles,
} from "@/db/schema";
import { deriveExpenseProfile } from "../expense-engine";
import { addDays, sydneyDate } from "../date-utils";
import {
  RUNWAY_PROFILE_ID,
  exclusionPatterns,
  getProfile,
} from "../runway-store";
import { BasiqClient } from "./client";
import { requireBasiqConfig } from "./config";

export async function syncBasiqData(now = new Date()) {
  const profile = await getProfile();
  if (!profile?.basiqUserId) throw new Error("No Basiq user is connected.");
  const db = await getDb();
  const client = new BasiqClient(requireBasiqConfig());
  const today = sydneyDate(now);
  const [remoteAccounts, transactions] = await Promise.all([
    client.listAccounts(profile.basiqUserId),
    client.listTransactions(profile.basiqUserId, {
      from: addDays(today, -89),
      to: today,
    }),
  ]);
  const existing = await db
    .select({
      id: bankAccounts.accountId,
      selected: bankAccounts.selected,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.profileId, RUNWAY_PROFILE_ID));
  const selectedById = new Map(existing.map((item) => [item.id, item.selected]));
  const syncedAt = now.toISOString();
  for (const account of remoteAccounts) {
    await db
      .insert(bankAccounts)
      .values({
        accountId: account.id,
        profileId: RUNWAY_PROFILE_ID,
        name: account.name,
        maskedNumber: account.masked_number,
        institution: account.institution,
        accountClass: account.account_class,
        cashRole: account.cash_role,
        currency: account.currency,
        balanceCents: account.balance_cents,
        availableFundsCents: account.available_funds_cents,
        selected: selectedById.get(account.id) ?? false,
        lastUpdatedAt: account.last_updated_at,
        syncedAt,
      })
      .onConflictDoUpdate({
        target: bankAccounts.accountId,
        set: {
          name: account.name,
          maskedNumber: account.masked_number,
          institution: account.institution,
          accountClass: account.account_class,
          cashRole: account.cash_role,
          currency: account.currency,
          balanceCents: account.balance_cents,
          availableFundsCents: account.available_funds_cents,
          lastUpdatedAt: account.last_updated_at,
          syncedAt,
        },
      });
  }
  const selectedAccounts = remoteAccounts.filter(
    (account) => selectedById.get(account.id) === true,
  );
  const selectedIds = selectedAccounts.map((account) => account.id);
  const operatingCash = selectedAccounts
    .filter(
      (account) =>
        account.currency === "AUD" && account.cash_role === "operating_cash",
    )
    .reduce(
      (sum, account) =>
        sum + (account.available_funds_cents ?? account.balance_cents),
      0,
    );
  const liabilities = selectedAccounts
    .filter(
      (account) =>
        account.currency === "AUD" && account.cash_role === "liability",
    )
    .reduce((sum, account) => sum + Math.abs(account.balance_cents), 0);
  const expenseProfile = selectedIds.length
    ? deriveExpenseProfile({
        today,
        transactions,
        selected_account_ids: selectedIds,
        exclusion_patterns: await exclusionPatterns(),
      }, now)
    : null;
  await db.insert(bankSnapshots).values({
    profileId: RUNWAY_PROFILE_ID,
    createdAt: syncedAt,
    operatingCashCents: operatingCash,
    liabilitiesCents: liabilities,
    expenseProfileJson: expenseProfile ? JSON.stringify(expenseProfile) : null,
  });
  await db
    .update(runwayProfiles)
    .set({
      bankState: "connected",
      consentStatus: "valid",
      lastSyncedAt: syncedAt,
      syncError: selectedIds.length
        ? null
        : "Choose at least one account to calculate a forecast.",
      updatedAt: syncedAt,
    })
    .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
  return {
    account_count: remoteAccounts.length,
    selected_count: selectedIds.length,
    last_synced_at: syncedAt,
  };
}
