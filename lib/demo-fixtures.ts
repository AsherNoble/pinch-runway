import type { DemoFixtureSource, DemoScenario } from "./contracts";

/**
 * This source object is intentionally used by every fixture. It is not a
 * fallback for a failed Pinch call: it is explicit, fabricated demo data.
 */
export const DEMO_FIXTURE_SOURCE: DemoFixtureSource = {
  source: "demo_fixture",
  connection_state: "demo",
  is_live: false,
  display_label: "Demo data — not connected to Pinch",
  last_synced_at: null,
};

/**
 * Deterministic, fake scenarios for local development and the forecast lane.
 * Monetary values are integer cents. expected_forecast is a fixture assertion,
 * not a result fetched from Pinch or an account-balance claim.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: "demo-comfortable-reliable-coverage",
    title: "Comfortable — reliable invoice covers the weekly draw",
    description:
      "Fake data: a never-late payer alone covers the declared weekly draw, so there is no reason to touch a personal buffer.",
    today: "2026-07-25",
    data_source: { ...DEMO_FIXTURE_SOURCE },
    payers: [
      {
        id: "demo-payer-reliable-studio",
        name: "Demo Reliable Studio",
        reliability: "never_late",
        avg_days_late: 0,
      },
      {
        id: "demo-payer-new-client",
        name: "Demo New Client",
        reliability: "no_history",
        avg_days_late: null,
      },
    ],
    invoices: [
      {
        id: "demo-invoice-reliable-comfortable",
        payer_id: "demo-payer-reliable-studio",
        amount: 99000,
        due_date: "2026-07-28",
        status: "unpaid",
      },
      {
        id: "demo-invoice-new-comfortable",
        payer_id: "demo-payer-new-client",
        amount: 25000,
        due_date: "2026-07-30",
        status: "unpaid",
      },
    ],
    payment_history: [
      {
        id: "demo-payment-reliable-1",
        payer_id: "demo-payer-reliable-studio",
        invoice_id: "demo-historical-invoice-reliable-1",
        amount: 72000,
        due_date: "2026-05-10",
        paid_date: "2026-05-10",
        days_late: 0,
      },
      {
        id: "demo-payment-reliable-2",
        payer_id: "demo-payer-reliable-studio",
        invoice_id: "demo-historical-invoice-reliable-2",
        amount: 81000,
        due_date: "2026-06-10",
        paid_date: "2026-06-10",
        days_late: 0,
      },
    ],
    declared_expenses: [
      {
        id: "demo-weekly-draw-comfortable",
        type: "weekly_draw",
        amount: 65000,
        due_date: null,
        note: "Declared weekly living draw",
      },
    ],
    expected_forecast: {
      state: "comfortable",
      lowest_balance: 34000,
      cause:
        "Demo Reliable Studio's $990 invoice alone covers this week's declared $650 draw and they have never paid late.",
      recommended_action:
        "Sit tight — no need to touch your buffer or send a reminder today.",
    },
  },
  {
    id: "demo-safe-lumpy-expense-covered",
    title: "Safe — reliable invoice covers draw and BAS",
    description:
      "Fake data: a reliable invoice covers the weekly draw plus a lumpy BAS item, with a modest remaining margin.",
    today: "2026-07-25",
    data_source: { ...DEMO_FIXTURE_SOURCE },
    payers: [
      {
        id: "demo-payer-reliable-studio",
        name: "Demo Reliable Studio",
        reliability: "never_late",
        avg_days_late: 0,
      },
      {
        id: "demo-payer-slow-steady",
        name: "Demo Slow & Steady",
        reliability: "sometimes_late",
        avg_days_late: 7,
      },
    ],
    invoices: [
      {
        id: "demo-invoice-reliable-safe",
        payer_id: "demo-payer-reliable-studio",
        amount: 90000,
        due_date: "2026-07-27",
        status: "unpaid",
      },
      {
        id: "demo-invoice-slow-safe",
        payer_id: "demo-payer-slow-steady",
        amount: 32000,
        due_date: "2026-07-20",
        status: "unpaid",
      },
    ],
    payment_history: [
      {
        id: "demo-payment-reliable-safe-1",
        payer_id: "demo-payer-reliable-studio",
        invoice_id: "demo-historical-invoice-reliable-safe-1",
        amount: 90000,
        due_date: "2026-06-15",
        paid_date: "2026-06-15",
        days_late: 0,
      },
      {
        id: "demo-payment-slow-safe-1",
        payer_id: "demo-payer-slow-steady",
        invoice_id: "demo-historical-invoice-slow-safe-1",
        amount: 32000,
        due_date: "2026-04-05",
        paid_date: "2026-04-10",
        days_late: 5,
      },
      {
        id: "demo-payment-slow-safe-2",
        payer_id: "demo-payer-slow-steady",
        invoice_id: "demo-historical-invoice-slow-safe-2",
        amount: 32000,
        due_date: "2026-05-05",
        paid_date: "2026-05-14",
        days_late: 9,
      },
      {
        id: "demo-payment-slow-safe-3",
        payer_id: "demo-payer-slow-steady",
        invoice_id: "demo-historical-invoice-slow-safe-3",
        amount: 32000,
        due_date: "2026-06-05",
        paid_date: "2026-06-12",
        days_late: 7,
      },
    ],
    declared_expenses: [
      {
        id: "demo-weekly-draw-safe",
        type: "weekly_draw",
        amount: 65000,
        due_date: null,
        note: "Declared weekly living draw",
      },
      {
        id: "demo-lumpy-bas-safe",
        type: "lumpy",
        amount: 17000,
        due_date: "2026-07-30",
        note: "BAS payment",
      },
    ],
    expected_forecast: {
      state: "safe",
      lowest_balance: 8000,
      cause:
        "Demo Reliable Studio's $900 invoice covers the declared $650 draw and $170 BAS item, leaving an $80 projected margin.",
      recommended_action:
        "Sit tight — the reliable invoice is enough for this week's commitments.",
    },
  },
  {
    id: "demo-tight-overdue-unreliable-invoice",
    title: "Tight — only a sometimes-late invoice covers commitments",
    description:
      "Fake data: the only covering invoice is already overdue and this payer usually pays about a week late.",
    today: "2026-07-25",
    data_source: { ...DEMO_FIXTURE_SOURCE },
    payers: [
      {
        id: "demo-payer-slow-steady",
        name: "Demo Slow & Steady",
        reliability: "sometimes_late",
        avg_days_late: 7,
      },
    ],
    invoices: [
      {
        id: "demo-invoice-slow-tight",
        payer_id: "demo-payer-slow-steady",
        amount: 93000,
        due_date: "2026-07-20",
        status: "unpaid",
      },
    ],
    payment_history: [
      {
        id: "demo-payment-slow-tight-1",
        payer_id: "demo-payer-slow-steady",
        invoice_id: "demo-historical-invoice-slow-tight-1",
        amount: 76000,
        due_date: "2026-04-01",
        paid_date: "2026-04-06",
        days_late: 5,
      },
      {
        id: "demo-payment-slow-tight-2",
        payer_id: "demo-payer-slow-steady",
        invoice_id: "demo-historical-invoice-slow-tight-2",
        amount: 78000,
        due_date: "2026-05-01",
        paid_date: "2026-05-10",
        days_late: 9,
      },
      {
        id: "demo-payment-slow-tight-3",
        payer_id: "demo-payer-slow-steady",
        invoice_id: "demo-historical-invoice-slow-tight-3",
        amount: 79000,
        due_date: "2026-06-01",
        paid_date: "2026-06-08",
        days_late: 7,
      },
    ],
    declared_expenses: [
      {
        id: "demo-weekly-draw-tight",
        type: "weekly_draw",
        amount: 65000,
        due_date: null,
        note: "Declared weekly living draw",
      },
      {
        id: "demo-lumpy-insurance-tight",
        type: "lumpy",
        amount: 24000,
        due_date: "2026-07-30",
        note: "Quarterly insurance",
      },
    ],
    expected_forecast: {
      state: "tight",
      lowest_balance: 4000,
      cause:
        "The only covering invoice is $930 from Demo Slow & Steady; it is overdue and their previous payments ran 5–9 days late.",
      recommended_action:
        "Send a reminder to Demo Slow & Steady now — waiting until next week leaves almost no room for the declared draw and insurance.",
    },
  },
  {
    id: "demo-shortfall-chase-late-payer",
    title: "Shortfall — chase the overdue payer today",
    description:
      "Fake data: even both outstanding invoices landing on time do not cover the weekly draw and a Friday BAS item.",
    today: "2026-07-25",
    data_source: { ...DEMO_FIXTURE_SOURCE },
    payers: [
      {
        id: "demo-payer-late-client",
        name: "Demo Late Client",
        reliability: "sometimes_late",
        avg_days_late: 7,
      },
      {
        id: "demo-payer-new-client",
        name: "Demo New Client",
        reliability: "no_history",
        avg_days_late: null,
      },
    ],
    invoices: [
      {
        id: "demo-invoice-late-shortfall",
        payer_id: "demo-payer-late-client",
        amount: 50000,
        due_date: "2026-07-21",
        status: "unpaid",
      },
      {
        id: "demo-invoice-new-shortfall",
        payer_id: "demo-payer-new-client",
        amount: 10000,
        due_date: "2026-07-26",
        status: "unpaid",
      },
    ],
    payment_history: [
      {
        id: "demo-payment-late-shortfall-1",
        payer_id: "demo-payer-late-client",
        invoice_id: "demo-historical-invoice-late-shortfall-1",
        amount: 50000,
        due_date: "2026-04-12",
        paid_date: "2026-04-17",
        days_late: 5,
      },
      {
        id: "demo-payment-late-shortfall-2",
        payer_id: "demo-payer-late-client",
        invoice_id: "demo-historical-invoice-late-shortfall-2",
        amount: 50000,
        due_date: "2026-05-12",
        paid_date: "2026-05-21",
        days_late: 9,
      },
      {
        id: "demo-payment-late-shortfall-3",
        payer_id: "demo-payer-late-client",
        invoice_id: "demo-historical-invoice-late-shortfall-3",
        amount: 50000,
        due_date: "2026-06-12",
        paid_date: "2026-06-19",
        days_late: 7,
      },
    ],
    declared_expenses: [
      {
        id: "demo-weekly-draw-shortfall",
        type: "weekly_draw",
        amount: 65000,
        due_date: null,
        note: "Declared weekly living draw",
      },
      {
        id: "demo-lumpy-bas-shortfall",
        type: "lumpy",
        amount: 16000,
        due_date: "2026-07-31",
        note: "Friday BAS payment",
      },
    ],
    expected_forecast: {
      state: "shortfall",
      lowest_balance: -21000,
      cause:
        "Even if Demo Late Client's $500 and Demo New Client's $100 invoices land on time, the declared $650 draw plus Friday's $160 BAS payment leaves $210 uncovered.",
      recommended_action:
        "Chase Demo Late Client today, not Monday: their $500 invoice is four days overdue and their prior payments ran 5–9 days late.",
    },
  },
];
