/**
 * Shared application contract for Pinch Runway.
 *
 * Money is represented as integer Australian cents throughout this codebase.
 * We intentionally retain the brief's concise `amount` field name while
 * documenting its unit here, rather than introducing floating-point dollars.
 */
export type Cents = number;

/**
 * Date strings are transport-friendly ISO-8601 values (YYYY-MM-DD or a full
 * timestamp where noted). Parsing and timezone handling stay at the boundary.
 */
export type IsoDate = string;
export type IsoDateTime = string;

export type ReliabilityBucket =
  | "never_late"
  | "sometimes_late"
  | "no_history";

export type InvoiceStatus = "paid" | "unpaid";

export type ForecastState = "comfortable" | "safe" | "tight" | "shortfall";

export interface Payer {
  id: string;
  name: string;
  reliability: ReliabilityBucket;
  /**
   * Null is meaningful: a new payer has no payment history, so the product
   * must not imply a lateness estimate.
   */
  avg_days_late: number | null;
}

export interface Invoice {
  id: string;
  payer_id: Payer["id"];
  /** Integer cents. */
  amount: Cents;
  due_date: IsoDate;
  status: InvoiceStatus;
  /** Pinch Payer has an active payment source or agreement. */
  payment_method_on_file?: boolean;
  /** Normalised from a Pinch Payment or a verified webhook. */
  pinch_dishonoured?: boolean;
  /** Only set after the owner explicitly confirms they shared the link. */
  reminder_shared_at?: IsoDateTime | null;
  /** The provider Payment that represents this collection, when known. */
  provider_payment_id?: string | null;
}

/** Inputs used to explain an invoice flag; none is a payer score. */
export interface InvoiceWarningInputs {
  overdue_days: number;
  pinch_dishonour: boolean;
  stale_shared_reminder: boolean;
  no_payment_method: boolean;
  unusually_old_or_large: boolean;
}

export interface WeeklyDrawExpense {
  id: string;
  type: "weekly_draw";
  /** Integer cents, declared by the business owner rather than inferred. */
  amount: Cents;
  due_date: null;
  note: string;
}

export interface LumpyExpense {
  id: string;
  type: "lumpy";
  /** Integer cents, declared by the business owner rather than inferred. */
  amount: Cents;
  due_date: IsoDate;
  note: string;
}

export type DeclaredExpense = WeeklyDrawExpense | LumpyExpense;

/** A wait can mean reliable coverage or that no known Pinch collection exists. */
export type WaitRecommendationReason =
  | "reliable_coverage"
  | "no_collection_target";

/**
 * The engine tells the UI whether it is reasonable to wait or whether the
 * business owner should create a collection request for one known invoice.
 *
 * This deliberately identifies our shared invoice record rather than a
 * provider-specific Pinch Payment or Payment Link. Lane A resolves it to the
 * appropriate Pinch request when (and only when) that live action is used.
 */
export interface WaitRecommendationAction {
  type: "wait";
  reason: WaitRecommendationReason;
  target_payer_id: null;
  target_invoice_id: null;
  rationale: string;
}

export interface CreatePaymentLinkRecommendationAction {
  type: "create_payment_link";
  target_payer_id: Payer["id"];
  target_invoice_id: Invoice["id"];
  rationale: string;
}

export type RecommendationAction =
  | WaitRecommendationAction
  | CreatePaymentLinkRecommendationAction;

/**
 * A forecast surplus/shortfall against declared commitments. Pinch Runway has
 * no bank-feed access, so lowest_balance must never be rendered as a bank
 * account balance.
 */
export interface ForecastResult {
  state: ForecastState;
  /** Integer cents; negative values represent a projected shortfall. */
  lowest_balance: Cents;
  cause: string;
  recommended_action: RecommendationAction;
}

export type PingAmountRole =
  | "reliable_invoice"
  | "reliable_margin"
  | "expected_margin"
  | "optimistic_shortfall"
  | "target_invoice";

export type ForecastPingCta =
  | {
      label: "Sit tight";
      action: WaitRecommendationAction & { reason: "reliable_coverage" };
    }
  | {
      label: "No Pinch collection to target";
      action: WaitRecommendationAction & { reason: "no_collection_target" };
    }
  | {
      label: "Create Pinch payment link";
      action: CreatePaymentLinkRecommendationAction;
    };

/** A concrete, source-grounded message for the pings-first interface. */
export interface ForecastPing {
  id: "weekly-forecast";
  state: ForecastState;
  text: string;
  amount: {
    cents: Cents;
    role: PingAmountRole;
  };
  consequence: string;
  cta: ForecastPingCta;
}

/**
 * A paid invoice record used only to derive a bilateral payer reliability
 * bucket. Days paid early are normalised to zero; this model records lateness,
 * not a broader credit score.
 */
export interface PaymentHistoryEntry {
  id: string;
  payer_id: Payer["id"];
  invoice_id: Invoice["id"];
  /** Integer cents. */
  amount: Cents;
  due_date: IsoDate;
  paid_date: IsoDate;
  days_late: number;
}

export interface PayerHistoryDiagnostic {
  eligible_payer_count: number;
  live_book_payer_count: number;
  eligible_percentage: number;
}

/**
 * The source union is deliberately discriminated. Demo fixtures cannot have
 * is_live: true, which gives every caller one shared, type-visible signal for
 * the required non-live banner.
 */
export type PinchConnectionState =
  | "demo"
  | "unconfigured"
  | "connecting"
  | "connected"
  | "error";

export interface DemoFixtureSource {
  source: "demo_fixture";
  connection_state: "demo";
  is_live: false;
  display_label: "Demo data — not connected to Pinch";
  last_synced_at: null;
}

export interface ConnectedPinchSandboxSource {
  source: "pinch_sandbox";
  connection_state: "connected";
  is_live: true;
  display_label: "Live Pinch sandbox data";
  last_synced_at: IsoDateTime;
}

export interface UnavailablePinchSandboxSource {
  source: "pinch_sandbox";
  connection_state: "unconfigured" | "connecting" | "error";
  is_live: false;
  display_label: "Pinch sandbox not connected";
  last_synced_at: null;
  error_message?: string;
}

export type PinchDataSource =
  | DemoFixtureSource
  | ConnectedPinchSandboxSource
  | UnavailablePinchSandboxSource;

/**
 * The payload consumed by the forecast and UI lanes. Every view must receive
 * data_source alongside records so it never silently treats demo records as
 * Pinch sandbox records.
 */
export interface RunwayDataSnapshot {
  data_source: PinchDataSource;
  payers: readonly Payer[];
  invoices: readonly Invoice[];
  payment_history: readonly PaymentHistoryEntry[];
  declared_expenses: readonly DeclaredExpense[];
}

export interface DemoScenario extends Omit<RunwayDataSnapshot, "data_source"> {
  id: string;
  title: string;
  description: string;
  today: IsoDate;
  data_source: DemoFixtureSource;
  expected_forecast: ForecastResult;
}
