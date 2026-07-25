import { DEMO_SCENARIOS } from "@/lib/demo-fixtures";
import { getPinchReadiness } from "@/lib/pinch/config";

export const dynamic = "force-dynamic";

function formatAud(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00`));
}

function reliabilityLabel(reliability: string, averageDaysLate: number | null) {
  if (reliability === "never_late") return "Never late";
  if (reliability === "sometimes_late") {
    return `Usually ${averageDaysLate ?? "?"} days late`;
  }
  return "No history yet";
}

export default function Home() {
  const scenario = DEMO_SCENARIOS[0];
  const readiness = getPinchReadiness();
  const weeklyDraw = scenario.declared_expenses.find(
    (expense) => expense.type === "weekly_draw",
  );
  const lumpyItems = scenario.declared_expenses.filter(
    (expense) => expense.type === "lumpy",
  );

  return (
    <main className="runway-shell">
      <section className="runway-hero" aria-labelledby="runway-title">
        <div>
          <p className="eyebrow">Pinch Runway</p>
          <h1 id="runway-title">See the money you’ve earned before it lands.</h1>
          <p className="hero-copy">
            A pings-first cash-flow companion for sole traders collecting from
            their own clients through Pinch.
          </p>
        </div>
        <div className={`connection-badge connection-${readiness.state}`}>
          <span aria-hidden="true" className="status-dot" />
          <span>{readiness.display_label}</span>
        </div>
      </section>

      <section className="provenance-notice" aria-label="Data provenance">
        <strong>Fixture preview.</strong> Every number below is deterministic
        demo data, not a Pinch call or a bank balance. Selecting sandbox mode
        will never fall back here if a live call fails.
      </section>

      <div className="runway-grid">
        <section className="ping-panel" aria-labelledby="pings-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">What needs your attention</p>
              <h2 id="pings-title">Runway pings</h2>
            </div>
            <span className="state-pill state-comfortable">
              {scenario.expected_forecast.state}
            </span>
          </div>

          <article className="primary-ping">
            <p className="ping-kicker">This week’s call</p>
            <p className="ping-copy">{scenario.expected_forecast.cause}</p>
            <p className="ping-action">
              {scenario.expected_forecast.recommended_action}
            </p>
            <div className="ping-actions" aria-label="Live Pinch action status">
              <button type="button" disabled>
                Create Pinch payment link
              </button>
              <span>Available after live sandbox verification</span>
            </div>
          </article>

          <article className="check-in-card">
            <div>
              <p className="check-in-title">Weekly draw check-in</p>
              <p>
                Did {formatAud(weeklyDraw?.amount ?? 0)} cover you this week?
              </p>
            </div>
            <div className="choice-row" aria-label="Planned weekly check-in choices">
              <span>About right</span>
              <span>Needed more</span>
              <span>Had extra</span>
            </div>
          </article>

          <aside className="scope-note">
            <strong>Purposefully narrow:</strong> no bank feeds, household
            budgets, email, calendar, investment data, or regulated advice.
            Runway reasons from declared commitments and Pinch collection data.
          </aside>
        </section>

        <aside className="dashboard-panel" aria-labelledby="snapshot-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Backup view</p>
              <h2 id="snapshot-title">Current snapshot</h2>
            </div>
            <span className="demo-pill">Demo</span>
          </div>

          <div className="summary-row">
            <div>
              <span>Unpaid collections</span>
              <strong>
                {formatAud(
                  scenario.invoices.reduce((total, invoice) => total + invoice.amount, 0),
                )}
              </strong>
            </div>
            <div>
              <span>Declared weekly draw</span>
              <strong>{formatAud(weeklyDraw?.amount ?? 0)}</strong>
            </div>
            <div>
              <span>Forecast margin</span>
              <strong>{formatAud(scenario.expected_forecast.lowest_balance)}</strong>
            </div>
          </div>

          <div className="ledger-section">
            <h3>Unpaid payment records</h3>
            <ul className="invoice-list">
              {scenario.invoices.map((invoice) => {
                const payer = scenario.payers.find((item) => item.id === invoice.payer_id);
                return (
                  <li key={invoice.id}>
                    <div>
                      <strong>{payer?.name}</strong>
                      <span>Due {formatDate(invoice.due_date)}</span>
                    </div>
                    <div className="invoice-meta">
                      <strong>{formatAud(invoice.amount)}</strong>
                      <span className={`reliability-tag ${payer?.reliability ?? "no_history"}`}>
                        {reliabilityLabel(
                          payer?.reliability ?? "no_history",
                          payer?.avg_days_late ?? null,
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="ledger-section">
            <h3>Upcoming declared items</h3>
            {lumpyItems.length ? (
              <ul className="expense-list">
                {lumpyItems.map((item) => (
                  <li key={item.id}>
                    <span>{item.note}</span>
                    <span>
                      {formatAud(item.amount)} · {formatDate(item.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-copy">Nothing extra in the next seven days.</p>
            )}
          </div>
        </aside>
      </div>

      <section className="checkpoint-card" aria-labelledby="checkpoint-title">
        <div>
          <p className="eyebrow">Tomorrow’s non-negotiable</p>
          <h2 id="checkpoint-title">The product only becomes live with Pinch proof.</h2>
        </div>
        <ol>
          <li>Read real sandbox payers and collection payments.</li>
          <li>Derive reliability from real successful payment attempts.</li>
          <li>Create a real sandbox Payment Link and show its provider result.</li>
        </ol>
      </section>
    </main>
  );
}
