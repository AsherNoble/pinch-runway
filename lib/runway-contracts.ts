import type { Cents, IsoDate, IsoDateTime } from "./contracts";

export type DataReadinessState =
  | "connected"
  | "syncing"
  | "stale"
  | "consent_required"
  | "error"
  | "demo";

export interface DataSourceReadiness {
  state: DataReadinessState;
  display_label: string;
  last_synced_at: IsoDateTime | null;
  message?: string;
}

export type BankAccountClass =
  | "transaction"
  | "savings"
  | "credit-card"
  | "loan"
  | "mortgage"
  | "other";

export type BankCashRole = "operating_cash" | "liability" | "excluded";

export interface BankAccountSummary {
  id: string;
  name: string;
  /** Only the final four characters are retained. */
  masked_number: string | null;
  institution: string | null;
  account_class: BankAccountClass;
  cash_role: BankCashRole;
  currency: string;
  balance_cents: Cents;
  available_funds_cents: Cents | null;
  selected: boolean;
  last_updated_at: IsoDateTime | null;
}

export type TransactionDirection = "debit" | "credit";
export type TransactionStatus = "posted" | "pending";

/**
 * Ephemeral normalised transaction input. These records are used during a
 * sync and deliberately never persisted to D1.
 */
export interface BankTransaction {
  id: string;
  account_id: string;
  description: string;
  amount_cents: Cents;
  direction: TransactionDirection;
  status: TransactionStatus;
  post_date: IsoDate;
  transaction_class: string | null;
}

export type RecurringCadence = "weekly" | "fortnightly" | "monthly";

export interface RecurringExpense {
  merchant_key: string;
  label: string;
  cadence: RecurringCadence;
  cadence_days: 7 | 14 | 30;
  typical_amount_cents: Cents;
  occurrences: number;
  last_seen_on: IsoDate;
  projected_dates: readonly IsoDate[];
}

export interface PendingDebit {
  id: string;
  description: string;
  amount_cents: Cents;
  post_date: IsoDate;
  changeable: true;
}

export interface ExpenseProfile {
  lookback_days: number;
  posted_debits_cents: Cents;
  excluded_debits_cents: Cents;
  variable_debits_cents: Cents;
  variable_daily_average_cents: Cents;
  normal_daily_spend_cents: Cents;
  recurring: readonly RecurringExpense[];
  pending_debits: readonly PendingDebit[];
  derived_at: IsoDateTime;
}

export type ReceivableStatus = "unpaid" | "paid" | "written_off";

export interface Receivable {
  id: string;
  payer_name: string;
  payer_email: string;
  safe_address: string;
  amount_cents: Cents;
  issued_date: IsoDate;
  due_date: IsoDate;
  status: ReceivableStatus;
  paid_date: IsoDate | null;
  payer_history_count: number;
  avg_days_late: number | null;
  reminder_count: number;
  last_reminder_at: IsoDateTime | null;
  source: "demo";
}

export type ReceivableAgingBucket =
  | "not_due"
  | "1_7_days"
  | "8_30_days"
  | "31_plus_days";

export interface ReceivableAging {
  not_due_cents: Cents;
  overdue_1_7_cents: Cents;
  overdue_8_30_cents: Cents;
  overdue_31_plus_cents: Cents;
  total_unpaid_cents: Cents;
}

export interface ForecastPoint {
  date: IsoDate;
  projected_expenses_cents: Cents;
  pending_debits_cents: Cents;
  expected_receipts_cents: Cents;
  cash_only_cents: Cents;
  expected_with_receivables_cents: Cents;
  uncertain_receivable_ids: readonly string[];
}

export interface ForecastPathSummary {
  closing_position_cents: Cents;
  lowest_position_cents: Cents;
  lowest_position_date: IsoDate;
  first_buffer_breach_date: IsoDate | null;
}

export interface DualForecast {
  opening_operating_cash_cents: Cents;
  risk_buffer_cents: Cents;
  cash_only: ForecastPathSummary;
  expected_with_receivables: ForecastPathSummary;
  points: readonly ForecastPoint[];
}

export type ReminderSuppressionReason =
  | "no_cash_risk"
  | "bank_data_not_ready"
  | "receivables_not_ready"
  | "no_overdue_invoice"
  | "cadence_limit"
  | "send_cap"
  | "outside_weekday_evaluation";

export interface ReminderDecision {
  id: string;
  evaluated_at: IsoDateTime;
  local_date: IsoDate;
  eligible: boolean;
  target_receivable_id: string | null;
  earliest_breach_date: IsoDate | null;
  risk_buffer_cents: Cents;
  cash_at_breach_cents: Cents | null;
  repair_amount_cents: Cents | null;
  suppression_reason: ReminderSuppressionReason | null;
}

export interface RunwaySnapshot {
  generated_at: IsoDateTime;
  bank_source: DataSourceReadiness;
  receivables_source: DataSourceReadiness;
  accounts: readonly BankAccountSummary[];
  operating_cash_cents: Cents;
  liabilities_cents: Cents;
  earned_not_received_cents: Cents;
  expense_profile: ExpenseProfile | null;
  expense_exclusion_patterns: readonly string[];
  receivables: readonly Receivable[];
  receivables_aging: ReceivableAging;
  forecast: DualForecast | null;
  reminder_decision: ReminderDecision | null;
  automation_mode: "off" | "test" | "live";
}
