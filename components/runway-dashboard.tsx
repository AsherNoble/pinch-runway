import type { RunwaySnapshot } from "@/lib/runway-contracts";
import type { RunwayViewModel } from "@/lib/runway-view";
import { BankControls } from "./bank-controls";
import { ExpenseExclusions } from "./expense-exclusions";
import { PaymentLinkAction } from "./payment-link-action";

interface RunwayDashboardProps {
  snapshot: RunwaySnapshot;
  jobIds?: string;
  signedInEmail?: string | null;
  collectionPing?: RunwayViewModel;
}

function CollectionPingCard({ view }: { view: RunwayViewModel }) {
  const ping = view.pings[0];
  const cta = ping.cta;
  return (
    <section className="dashboard-card collection-ping-card" aria-labelledby="collection-ping-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live Pinch collection</p>
          <h2 id="collection-ping-title">This week’s call</h2>
        </div>
        <span className="demo-pill">
          {view.snapshot.data_source.is_live ? "Live sandbox" : "Fixture"}
        </span>
      </div>
      <p>{ping.text}</p>
      <p className="pending-note">{ping.consequence}</p>
      {cta.label === "Create Pinch payment link" ? (
        <PaymentLinkAction invoiceId={cta.action.target_invoice_id} />
      ) : (
        <div className="ping-actions ping-actions-status">
          <span className="ping-status-label">{cta.label}</span>
        </div>
      )}
    </section>
  );
}

function aud(cents: number, precise = false) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? 2 : 0,
  }).format(cents / 100);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00Z`));
}

function freshness(snapshot: RunwaySnapshot) {
  if (!snapshot.bank_source.last_synced_at) return snapshot.bank_source.display_label;
  return `${snapshot.bank_source.display_label} · ${new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
  }).format(new Date(snapshot.bank_source.last_synced_at))}`;
}

function ForecastChart({ snapshot }: { snapshot: RunwaySnapshot }) {
  const points = snapshot.forecast?.points ?? [];
  if (!points.length) {
    return (
      <div className="forecast-empty">
        Connect Basiq and select at least one AUD deposit account to build the
        30-day forecast.
      </div>
    );
  }
  const values = points.flatMap((point) => [
    point.cash_only_cents,
    point.expected_with_receivables_cents,
  ]);
  const min = Math.min(...values, snapshot.forecast!.risk_buffer_cents, 0);
  const max = Math.max(...values, snapshot.forecast!.risk_buffer_cents, 1);
  const range = Math.max(1, max - min);
  const x = (index: number) => 28 + (index / (points.length - 1)) * 704;
  const y = (value: number) => 210 - ((value - min) / range) * 170;
  const line = (key: "cash_only_cents" | "expected_with_receivables_cents") =>
    points.map((point, index) => `${x(index)},${y(point[key])}`).join(" ");

  return (
    <div className="chart-wrap">
      <svg
        aria-label="Thirty-day cash forecast"
        className="forecast-chart"
        role="img"
        viewBox="0 0 760 245"
      >
        <line className="chart-axis" x1="28" x2="732" y1={y(0)} y2={y(0)} />
        <line
          className="chart-buffer"
          x1="28"
          x2="732"
          y1={y(snapshot.forecast!.risk_buffer_cents)}
          y2={y(snapshot.forecast!.risk_buffer_cents)}
        />
        <polyline className="chart-line chart-cash" points={line("cash_only_cents")} />
        <polyline
          className="chart-line chart-expected"
          points={line("expected_with_receivables_cents")}
        />
        <text x="28" y="236">{shortDate(points[0].date)}</text>
        <text textAnchor="end" x="732" y="236">{shortDate(points.at(-1)!.date)}</text>
      </svg>
      <div className="chart-legend">
        <span><i className="legend-cash" />Cash only</span>
        <span><i className="legend-expected" />With expected receivables</span>
        <span><i className="legend-buffer" />Seven-day buffer</span>
      </div>
    </div>
  );
}

function recommendation(snapshot: RunwaySnapshot) {
  const decision = snapshot.reminder_decision;
  if (decision?.eligible && decision.target_receivable_id) {
    const item = snapshot.receivables.find(
      (receivable) => receivable.id === decision.target_receivable_id,
    );
    return {
      kicker: "Cash buffer action",
      title: `Follow up ${item?.payer_name ?? decision.target_receivable_id}`,
      body:
        `The cash-only path breaches your seven-day buffer on ${shortDate(
          decision.earliest_breach_date!,
        )}. This overdue ${aud(item?.amount_cents ?? 0)} invoice repairs the most of the earliest gap.`,
    };
  }
  if (snapshot.bank_source.state === "stale") {
    return {
      kicker: "Refresh before acting",
      title: "Bank data is too old for a recommendation",
      body: "Refresh the Basiq connection. Automatic reminders are paused while bank data is over 24 hours old.",
    };
  }
  if (!snapshot.forecast) {
    return {
      kicker: "Set up your runway",
      title: "Connect and choose your business accounts",
      body: "Runway will keep bank cash separate from invoices you have earned but not received.",
    };
  }
  return {
    kicker: "No immediate chase needed",
    title: "Your seven-day cash buffer holds",
    body: "The cash-only forecast does not breach the operating buffer in the next seven days. Expected invoices remain visible but are not counted as available cash.",
  };
}

export function RunwayDashboard({
  snapshot,
  jobIds,
  signedInEmail,
  collectionPing,
}: RunwayDashboardProps) {
  const expectedClosing =
    snapshot.forecast?.expected_with_receivables.closing_position_cents ?? null;
  const action = recommendation(snapshot);
  const unpaid = snapshot.receivables.filter((item) => item.status === "unpaid");
  const hasSelectedAccounts = snapshot.accounts.some((account) => account.selected);

  return (
    <main className="runway-shell runway-v2">
      <header className="runway-hero">
        <div>
          <p className="eyebrow">Runway · bank-aware cash flow</p>
          <h1>Know what’s cash. Know what’s coming.</h1>
          <p className="hero-copy">
            A 30-day operating view for one Australian sole trader, powered by
            selected Basiq sandbox accounts and an explicitly demo receivables ledger.
          </p>
        </div>
        <div className={`source-badge source-${snapshot.bank_source.state}`}>
          <span className="status-dot" aria-hidden="true" />
          {snapshot.bank_source.state.replace("_", " ")}
        </div>
      </header>

      <section className="source-strip" aria-label="Data freshness">
        <div>
          <strong>Bank:</strong> {freshness(snapshot)}
          {snapshot.bank_source.message ? ` — ${snapshot.bank_source.message}` : ""}
        </div>
        <div>
          <strong>Receivables:</strong> {snapshot.receivables_source.display_label}
        </div>
      </section>

      <section className="metric-grid" aria-label="Cash flow summary">
        <article className="metric-card metric-cash">
          <span>Cash available now</span>
          <strong>{aud(snapshot.operating_cash_cents)}</strong>
          <p>Selected AUD deposit accounts only. Credit and loans are excluded.</p>
        </article>
        <article className="metric-card">
          <span>Earned, not received</span>
          <strong>{aud(snapshot.earned_not_received_cents)}</strong>
          <p>Unpaid demo invoices. This is not spendable cash.</p>
        </article>
        <article className="metric-card">
          <span>Expected position · 30 days</span>
          <strong>{expectedClosing === null ? "—" : aud(expectedClosing)}</strong>
          <p>Cash plus expected invoice arrivals, with uncertainty shown below.</p>
        </article>
        <article className="metric-card metric-liability">
          <span>Selected credit & loans</span>
          <strong>{aud(snapshot.liabilities_cents)}</strong>
          <p>Shown separately; borrowing capacity is never treated as cash.</p>
        </article>
      </section>

      <section className="primary-action">
        <div>
          <p className="eyebrow">{action.kicker}</p>
          <h2>{action.title}</h2>
        </div>
        <p>{action.body}</p>
        <span className={`automation-pill mode-${snapshot.automation_mode}`}>
          Automation {snapshot.automation_mode}
        </span>
      </section>

      {collectionPing ? <CollectionPingCard view={collectionPing} /> : null}

      <section className="dashboard-card forecast-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Thirty-day runway</p>
            <h2>Available cash vs expected position</h2>
          </div>
          {snapshot.forecast ? (
            <div className="forecast-stat">
              Buffer {aud(snapshot.forecast.risk_buffer_cents)}
            </div>
          ) : null}
        </div>
        <ForecastChart snapshot={snapshot} />
        {snapshot.forecast ? (
          <div className="forecast-summary">
            <div>
              <span>Cash-only low</span>
              <strong>{aud(snapshot.forecast.cash_only.lowest_position_cents)}</strong>
              <small>{shortDate(snapshot.forecast.cash_only.lowest_position_date)}</small>
            </div>
            <div>
              <span>Cash-only close</span>
              <strong>{aud(snapshot.forecast.cash_only.closing_position_cents)}</strong>
              <small>Receivables excluded</small>
            </div>
            <div>
              <span>Expected close</span>
              <strong>{aud(snapshot.forecast.expected_with_receivables.closing_position_cents)}</strong>
              <small>Expected receipts included</small>
            </div>
          </div>
        ) : null}
      </section>

      <div className="detail-grid">
        <section className="dashboard-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Bank setup</p>
              <h2>Business accounts</h2>
            </div>
          </div>
          <BankControls
            accounts={snapshot.accounts}
            bankState={snapshot.bank_source.state}
            initialJobIds={jobIds}
            signedIn={Boolean(signedInEmail)}
          />
          {!hasSelectedAccounts && snapshot.accounts.length ? (
            <p className="inline-alert">No accounts selected. Forecasting is paused.</p>
          ) : null}
        </section>

        <section className="dashboard-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Expense baseline</p>
              <h2>Observed operating spend</h2>
            </div>
          </div>
          {snapshot.expense_profile ? (
            <>
              <div className="baseline-value">
                <strong>{aud(snapshot.expense_profile.normal_daily_spend_cents, true)}</strong>
                <span>normal daily spend · trailing {snapshot.expense_profile.lookback_days} days</span>
              </div>
              <ul className="compact-list">
                {snapshot.expense_profile.recurring.map((item) => (
                  <li key={item.merchant_key}>
                    <div><strong>{item.label}</strong><span>{item.cadence} · {item.occurrences} observed</span></div>
                    <strong>{aud(item.typical_amount_cents, true)}</strong>
                  </li>
                ))}
                {!snapshot.expense_profile.recurring.length ? (
                  <li><span>No expense met the three-payment recurring threshold.</span></li>
                ) : null}
              </ul>
              {snapshot.expense_profile.pending_debits.length ? (
                <p className="pending-note">
                  {snapshot.expense_profile.pending_debits.length} pending debit(s) are
                  included in the immediate outlook and may change.
                </p>
              ) : null}
              <ExpenseExclusions
                patterns={snapshot.expense_exclusion_patterns}
              />
            </>
          ) : (
            <p className="empty-copy">Expense baseline appears after a selected-account sync.</p>
          )}
        </section>
      </div>

      <section className="dashboard-card receivables-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Demo receivables</p>
            <h2>Invoice timing and aging</h2>
          </div>
          <span className="demo-pill">Not live Pinch data</span>
        </div>
        <div className="aging-grid">
          <div><span>Not due</span><strong>{aud(snapshot.receivables_aging.not_due_cents)}</strong></div>
          <div><span>1–7 days</span><strong>{aud(snapshot.receivables_aging.overdue_1_7_cents)}</strong></div>
          <div><span>8–30 days</span><strong>{aud(snapshot.receivables_aging.overdue_8_30_cents)}</strong></div>
          <div><span>31+ days</span><strong>{aud(snapshot.receivables_aging.overdue_31_plus_cents)}</strong></div>
        </div>
        {unpaid.length ? (
          <ul className="receivable-list">
            {unpaid.map((item) => {
              const uncertain = item.avg_days_late === null;
              return (
                <li key={item.id}>
                  <div>
                    <strong>{item.payer_name}</strong>
                    <span>{item.id} · due {shortDate(item.due_date)}</span>
                  </div>
                  <div className="receivable-timing">
                    <strong>{aud(item.amount_cents, true)}</strong>
                    <span className={uncertain ? "timing-uncertain" : "timing-observed"}>
                      {uncertain
                        ? "Arrival uncertain — no payer history"
                        : `Usually ${item.avg_days_late} day(s) late`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-copy">No unpaid receivables.</p>
        )}
      </section>

      <footer className="runway-footer">
        Operational guidance only — not accounting, tax, credit, investment, or
        personal financial advice. Raw bank transactions and account numbers are
        not retained by Runway.
      </footer>
    </main>
  );
}
