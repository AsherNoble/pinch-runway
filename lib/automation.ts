import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  receivables,
  reminderDecisions,
  reminderDeliveries,
  schedulerExecutions,
} from "@/db/schema";
import { isSydneyWeekdayEvaluation, sydneyDate } from "./date-utils";
import { emailInvoiceReminder } from "./resend";
import { automationMode, getProfile, loadRunwaySnapshot } from "./runway-store";

export interface SchedulerResult {
  state: "ignored" | "duplicate" | "suppressed" | "sent" | "failed";
  local_date: string;
  decision_id?: string;
  reason?: string;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.message.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80);
}

export async function runScheduledAutomation(
  now = new Date(),
): Promise<SchedulerResult> {
  const localDate = sydneyDate(now);
  if (!isSydneyWeekdayEvaluation(now)) {
    return { state: "ignored", local_date: localDate, reason: "outside_evaluation_time" };
  }
  const db = await getDb();
  try {
    await db.insert(schedulerExecutions).values({
      localDate,
      startedAt: now.toISOString(),
      status: "running",
    });
  } catch {
    return { state: "duplicate", local_date: localDate };
  }

  const mode = automationMode();
  if (mode === "off") {
    await db
      .update(schedulerExecutions)
      .set({
        status: "skipped",
        completedAt: new Date().toISOString(),
        errorCode: "automation_off",
      })
      .where(eq(schedulerExecutions.localDate, localDate));
    return { state: "suppressed", local_date: localDate, reason: "automation_off" };
  }
  if (mode === "live" && process.env.RUNWAY_ENABLE_LIVE_DELIVERY !== "1") {
    await db
      .update(schedulerExecutions)
      .set({
        status: "skipped",
        completedAt: new Date().toISOString(),
        errorCode: "live_delivery_locked",
      })
      .where(eq(schedulerExecutions.localDate, localDate));
    return {
      state: "suppressed",
      local_date: localDate,
      reason: "live_delivery_locked",
    };
  }

  try {
    const snapshot = await loadRunwaySnapshot(now);
    const decision = snapshot.reminder_decision;
    if (!decision || !snapshot.forecast) {
      await db
        .update(schedulerExecutions)
        .set({
          status: "skipped",
          completedAt: new Date().toISOString(),
          errorCode: "forecast_unavailable",
        })
        .where(eq(schedulerExecutions.localDate, localDate));
      return {
        state: "suppressed",
        local_date: localDate,
        reason: "forecast_unavailable",
      };
    }
    await db.insert(reminderDecisions).values({
      id: decision.id,
      localDate: decision.local_date,
      evaluatedAt: decision.evaluated_at,
      targetReceivableId: decision.target_receivable_id,
      eligible: decision.eligible,
      suppressionReason: decision.suppression_reason,
      earliestBreachDate: decision.earliest_breach_date,
      riskBufferCents: decision.risk_buffer_cents,
      cashAtBreachCents: decision.cash_at_breach_cents,
      repairAmountCents: decision.repair_amount_cents,
      forecastJson: JSON.stringify(snapshot.forecast),
    });
    if (!decision.eligible || !decision.target_receivable_id) {
      await db
        .update(schedulerExecutions)
        .set({
          status: "skipped",
          completedAt: new Date().toISOString(),
          decisionId: decision.id,
          errorCode: decision.suppression_reason,
        })
        .where(eq(schedulerExecutions.localDate, localDate));
      return {
        state: "suppressed",
        local_date: localDate,
        decision_id: decision.id,
        reason: decision.suppression_reason ?? "not_eligible",
      };
    }
    const receivable = snapshot.receivables.find(
      (item) => item.id === decision.target_receivable_id,
    );
    if (!receivable || receivable.status !== "unpaid") {
      throw new Error("receivable_not_payable");
    }
    const testRecipient = process.env.RUNWAY_TEST_RECIPIENT?.trim();
    const profile = await getProfile();
    if (
      mode === "test" &&
      (!testRecipient ||
        !profile?.operatorEmail ||
        testRecipient.toLowerCase() !== profile.operatorEmail.toLowerCase())
    ) {
      throw new Error("test_recipient_must_match_operator");
    }
    const actualRecipient = mode === "test" ? testRecipient : receivable.payer_email;
    if (!actualRecipient) throw new Error("test_recipient_not_configured");
    const sequence = receivable.reminder_count + 1;
    await db.insert(reminderDeliveries).values({
      decisionId: decision.id,
      receivableId: receivable.id,
      reminderSequence: sequence,
      intendedRecipient: receivable.payer_email,
      actualRecipient,
      automationMode: mode,
      status: "reserved",
      reservedAt: now.toISOString(),
    });
    try {
      const providerDeliveryId = await emailInvoiceReminder({
        intendedRecipient: receivable.payer_email,
        actualRecipient,
        payerName: receivable.payer_name,
        invoiceId: receivable.id,
        amountCents: receivable.amount_cents,
        dueDate: receivable.due_date,
        testMode: mode === "test",
        reminderSequence: sequence,
      });
      const sentAt = new Date().toISOString();
      await db
        .update(reminderDeliveries)
        .set({
          providerDeliveryId,
          status: "sent",
          sentAt,
          terminalAt: sentAt,
        })
        .where(eq(reminderDeliveries.decisionId, decision.id));
      await db
        .update(receivables)
        .set({
          reminderCount: sequence,
          lastReminderAt: sentAt,
          updatedAt: sentAt,
        })
        .where(eq(receivables.id, receivable.id));
      await db
        .update(schedulerExecutions)
        .set({
          status: "completed",
          completedAt: sentAt,
          decisionId: decision.id,
        })
        .where(eq(schedulerExecutions.localDate, localDate));
      return {
        state: "sent",
        local_date: localDate,
        decision_id: decision.id,
      };
    } catch (error) {
      const terminalAt = new Date().toISOString();
      await db
        .update(reminderDeliveries)
        .set({
          status: "failed",
          terminalAt,
          errorCode: errorCode(error),
        })
        .where(eq(reminderDeliveries.decisionId, decision.id));
      throw error;
    }
  } catch (error) {
    await db
      .update(schedulerExecutions)
      .set({
        status: "failed",
        completedAt: new Date().toISOString(),
        errorCode: errorCode(error),
      })
      .where(eq(schedulerExecutions.localDate, localDate));
    return {
      state: "failed",
      local_date: localDate,
      reason: errorCode(error),
    };
  }
}
