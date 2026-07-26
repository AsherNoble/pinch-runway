import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import {
  bankSnapshots,
  receivables,
  reminderDecisions,
  reminderDeliveries,
  runwayProfiles,
  schedulerExecutions,
} from "@/db/schema";
import { runScheduledAutomation } from "@/lib/automation";
import { emailInvoiceReminder } from "@/lib/resend";

vi.mock("@/lib/resend", () => ({
  emailInvoiceReminder: vi.fn(),
}));

const mockedEmail = vi.mocked(emailInvoiceReminder);
const EVALUATION_TIME = new Date("2026-07-27T22:00:00.000Z"); // Tue 8am Sydney
const expenseProfile = {
  lookback_days: 90,
  posted_debits_cents: 180_000,
  excluded_debits_cents: 0,
  variable_debits_cents: 180_000,
  variable_daily_average_cents: 2_000,
  normal_daily_spend_cents: 2_000,
  recurring: [],
  pending_debits: [],
  derived_at: "2026-07-27T20:00:00.000Z",
};

beforeEach(async () => {
  process.env.RUNWAY_AUTOMATION_MODE = "test";
  process.env.RUNWAY_TEST_RECIPIENT = "operator@example.test";
  mockedEmail.mockReset();
  mockedEmail.mockResolvedValue("re_test_delivery");
  const db = await getDb();
  await db.delete(reminderDeliveries);
  await db.delete(reminderDecisions);
  await db.delete(schedulerExecutions);
  await db.delete(bankSnapshots);
  await db.delete(runwayProfiles);
  await db.insert(runwayProfiles).values({
    id: 1,
    operatorEmail: "operator@example.test",
    basiqUserId: "user-automation",
    bankState: "connected",
    consentStatus: "valid",
    lastSyncedAt: "2026-07-27T21:30:00.000Z",
    createdAt: "2026-07-27T21:30:00.000Z",
    updatedAt: "2026-07-27T21:30:00.000Z",
  });
  await db.insert(bankSnapshots).values({
    profileId: 1,
    createdAt: "2026-07-27T21:30:00.000Z",
    operatingCashCents: 15_000,
    liabilitiesCents: 0,
    expenseProfileJson: JSON.stringify(expenseProfile),
  });
  await db
    .update(receivables)
    .set({
      status: "unpaid",
      reminderCount: 0,
      lastReminderAt: null,
      updatedAt: "2026-07-27T21:30:00.000Z",
    });
});

describe("scheduled reminder automation", () => {
  it("runs once per Sydney date and redirects test delivery to the operator inbox", async () => {
    const first = await runScheduledAutomation(EVALUATION_TIME);
    expect(first.state).toBe("sent");
    expect(mockedEmail).toHaveBeenCalledOnce();
    const email = mockedEmail.mock.calls[0][0];
    expect(email.testMode).toBe(true);
    expect(email.actualRecipient).toBe("operator@example.test");
    expect(email.intendedRecipient).toMatch(/\.example$/);

    const delivery = (await (await getDb()).select().from(reminderDeliveries))[0];
    expect(delivery?.status).toBe("sent");
    expect(delivery?.providerDeliveryId).toBe("re_test_delivery");
    expect(delivery?.actualRecipient).toBe("operator@example.test");
    expect(delivery?.intendedRecipient).not.toBe(delivery?.actualRecipient);

    const repeated = await runScheduledAutomation(EVALUATION_TIME);
    expect(repeated.state).toBe("duplicate");
    expect(mockedEmail).toHaveBeenCalledOnce();
  });

  it("suppresses sends when bank data is stale", async () => {
    const db = await getDb();
    await db.delete(runwayProfiles);
    await db.insert(runwayProfiles).values({
      id: 1,
      operatorEmail: "operator@example.test",
      basiqUserId: "user-automation",
      bankState: "connected",
      consentStatus: "valid",
      lastSyncedAt: "2026-07-26T20:00:00.000Z",
      createdAt: "2026-07-26T20:00:00.000Z",
      updatedAt: "2026-07-26T20:00:00.000Z",
    });
    const result = await runScheduledAutomation(EVALUATION_TIME);
    expect(result.state).toBe("suppressed");
    expect(result.reason).toBe("bank_data_not_ready");
    expect(mockedEmail).not.toHaveBeenCalled();
  });

  it("records provider failure as a terminal failed delivery without incrementing the invoice", async () => {
    mockedEmail.mockRejectedValue(new Error("provider unavailable"));
    const result = await runScheduledAutomation(EVALUATION_TIME);
    expect(result.state).toBe("failed");
    const delivery = (await (await getDb()).select().from(reminderDeliveries))[0];
    expect(delivery?.status).toBe("failed");
    expect(delivery?.terminalAt).toBeTruthy();
    const invoice = (await (await getDb()).select().from(receivables))[0];
    expect(invoice?.reminderCount).toBe(0);
  });

  it("ignores hourly cron deliveries outside 8am on a Sydney weekday", async () => {
    const result = await runScheduledAutomation(
      new Date("2026-07-27T21:00:00.000Z"),
    );
    expect(result.state).toBe("ignored");
    expect(await (await getDb()).select().from(schedulerExecutions)).toEqual([]);
  });
});
