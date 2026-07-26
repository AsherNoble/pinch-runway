import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankAccounts,
  bankSnapshots,
  expenseExclusions,
  receivables,
  reminderDecisions,
  runwayProfiles,
} from "@/db/schema";
import { getBasiqReadiness } from "./basiq/config";
import type { ExpenseProfile, Receivable, RunwaySnapshot } from "./runway-contracts";
import { ageReceivables, buildDualForecast, decideReminder } from "./runway-engine";
import { sydneyDate } from "./date-utils";

export const RUNWAY_PROFILE_ID = 1;

export function automationMode(): "off" | "test" | "live" {
  const value = process.env.RUNWAY_AUTOMATION_MODE?.trim().toLowerCase();
  return value === "test" || value === "live" ? value : "off";
}

export async function ensureRunwayProfile(operatorEmail: string) {
  const db = await getDb();
  const existing = (
    await db
      .select()
      .from(runwayProfiles)
      .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID))
      .limit(1)
  )[0];
  if (existing) return existing;
  const now = new Date().toISOString();
  const readiness = getBasiqReadiness();
  await db.insert(runwayProfiles).values({
    id: RUNWAY_PROFILE_ID,
    operatorEmail,
    bankState: readiness.ready ? "consent_required" : "error",
    consentStatus: "required",
    syncError: readiness.ready ? null : readiness.message,
    createdAt: now,
    updatedAt: now,
  });
  return (
    await db
      .select()
      .from(runwayProfiles)
      .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID))
      .limit(1)
  )[0]!;
}

export function mapReceivable(
  row: typeof receivables.$inferSelect,
): Receivable {
  return {
    id: row.id,
    payer_name: row.payerName,
    payer_email: row.payerEmail,
    safe_address: row.safeAddress,
    amount_cents: row.amountCents,
    issued_date: row.issuedDate,
    due_date: row.dueDate,
    status: row.status,
    paid_date: row.paidDate,
    payer_history_count: row.payerHistoryCount,
    avg_days_late: row.avgDaysLate,
    reminder_count: row.reminderCount,
    last_reminder_at: row.lastReminderAt,
    source: "demo",
  };
}

function parseExpenseProfile(value: string | null): ExpenseProfile | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ExpenseProfile;
  } catch {
    return null;
  }
}

export async function loadRunwaySnapshot(now = new Date()): Promise<RunwaySnapshot> {
  const db = await getDb();
  const profile = (
    await db
      .select()
      .from(runwayProfiles)
      .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID))
      .limit(1)
  )[0];
  const accountRows = profile
    ? await db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.profileId, RUNWAY_PROFILE_ID))
    : [];
  const latestSnapshot = profile
    ? (
        await db
          .select()
          .from(bankSnapshots)
          .where(eq(bankSnapshots.profileId, RUNWAY_PROFILE_ID))
          .orderBy(desc(bankSnapshots.createdAt))
          .limit(1)
      )[0]
    : undefined;
  const receivableRows = await db
    .select()
    .from(receivables)
    .orderBy(receivables.dueDate);
  const items = receivableRows.map(mapReceivable);
  const exclusions = await db
    .select({ pattern: expenseExclusions.pattern })
    .from(expenseExclusions)
    .where(eq(expenseExclusions.profileId, RUNWAY_PROFILE_ID));
  const stale =
    profile?.lastSyncedAt &&
    now.getTime() - Date.parse(profile.lastSyncedAt) > 24 * 60 * 60 * 1000;
  const bankState = stale && profile?.bankState === "connected"
    ? "stale"
    : profile?.bankState ?? "consent_required";
  const bankSource = {
    state: bankState,
    display_label: {
      connected: "Basiq bank data connected",
      syncing: "Basiq bank data syncing",
      stale: "Basiq bank data is over 24 hours old",
      consent_required: "Bank consent required",
      error: "Basiq bank data unavailable",
      demo: "Demo bank data",
    }[bankState],
    last_synced_at: profile?.lastSyncedAt ?? null,
    ...(profile?.syncError ? { message: profile.syncError } : {}),
  } as const;
  const receivablesSource = {
    state: "demo" as const,
    display_label: "Demo receivables — not live Pinch invoices",
    last_synced_at: null,
    message: items.length
      ? "Seeded D1 records with safe dummy payer details."
      : "No demo receivables are available.",
  };
  const expenseProfile = parseExpenseProfile(
    latestSnapshot?.expenseProfileJson ?? null,
  );
  const forecast =
    expenseProfile && (bankState === "connected" || bankState === "stale")
      ? buildDualForecast({
          today: sydneyDate(now),
          opening_operating_cash_cents:
            latestSnapshot?.operatingCashCents ?? 0,
          expense_profile: expenseProfile,
          receivables: items,
        })
      : null;
  const decision = forecast
    ? decideReminder({
        now,
        today: sydneyDate(now),
        bank_source: bankSource,
        receivables_source: receivablesSource,
        forecast,
        receivables: items,
      })
    : null;

  return {
    generated_at: now.toISOString(),
    bank_source: bankSource,
    receivables_source: receivablesSource,
    accounts: accountRows.map((row) => ({
      id: row.accountId,
      name: row.name,
      masked_number: row.maskedNumber,
      institution: row.institution,
      account_class: row.accountClass as RunwaySnapshot["accounts"][number]["account_class"],
      cash_role: row.cashRole as RunwaySnapshot["accounts"][number]["cash_role"],
      currency: row.currency,
      balance_cents: row.balanceCents,
      available_funds_cents: row.availableFundsCents,
      selected: row.selected,
      last_updated_at: row.lastUpdatedAt,
    })),
    operating_cash_cents: latestSnapshot?.operatingCashCents ?? 0,
    liabilities_cents: latestSnapshot?.liabilitiesCents ?? 0,
    earned_not_received_cents: items
      .filter((item) => item.status === "unpaid")
      .reduce((sum, item) => sum + item.amount_cents, 0),
    expense_profile: expenseProfile,
    expense_exclusion_patterns: exclusions.map((row) => row.pattern),
    receivables: items,
    receivables_aging: ageReceivables(items, sydneyDate(now)),
    forecast,
    reminder_decision: decision,
    automation_mode: automationMode(),
  };
}

export async function selectBankAccounts(accountIds: readonly string[]) {
  const db = await getDb();
  const existing = await db
    .select({ id: bankAccounts.accountId })
    .from(bankAccounts)
    .where(eq(bankAccounts.profileId, RUNWAY_PROFILE_ID));
  const allowed = new Set(existing.map((row) => row.id));
  if (accountIds.some((id) => !allowed.has(id))) {
    throw new Error("One or more account selections are invalid.");
  }
  await db
    .update(bankAccounts)
    .set({ selected: false })
    .where(eq(bankAccounts.profileId, RUNWAY_PROFILE_ID));
  if (accountIds.length) {
    await db
      .update(bankAccounts)
      .set({ selected: true })
      .where(inArray(bankAccounts.accountId, [...accountIds]));
  }
}

export async function exclusionPatterns(): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ pattern: expenseExclusions.pattern })
    .from(expenseExclusions)
    .where(eq(expenseExclusions.profileId, RUNWAY_PROFILE_ID));
  return rows.map((row) => row.pattern);
}

export async function purgeDerivedBankData(input: {
  bank_state: "consent_required" | "error";
  consent_status: "required" | "revoked" | "expired";
  message: string;
}) {
  const db = await getDb();
  await db.delete(bankAccounts).where(eq(bankAccounts.profileId, RUNWAY_PROFILE_ID));
  await db.delete(bankSnapshots).where(eq(bankSnapshots.profileId, RUNWAY_PROFILE_ID));
  await db.delete(reminderDecisions);
  await db
    .update(runwayProfiles)
    .set({
      bankState: input.bank_state,
      consentStatus: input.consent_status,
      lastSyncedAt: null,
      syncError: input.message,
      connectStateHash: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
}

export async function getProfile() {
  const db = await getDb();
  return (
    await db
      .select()
      .from(runwayProfiles)
      .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID))
      .limit(1)
  )[0];
}
