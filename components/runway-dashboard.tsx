import type { PinchReadiness } from "@/lib/pinch/config";
import type { RunwayViewModel } from "@/lib/runway-view";
import { PaymentLinkAction } from "./payment-link-action";

interface RunwayDashboardProps {
  view: RunwayViewModel;
  readiness: PinchReadiness;
}

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
  }).format(new Date(value + "T12:00:00"));
}

function invoiceStatusLabel(invoice: RunwayViewModel["snapshot"]["invoices"][number]) {
  if (invoice.pinch_dishonoured) return "Pinch dishonour recorded";
  if (invoice.payment_method_on_file === false) return "No payment method on file";
  return "Collection pending";
}

function sourceTag(view: RunwayViewModel) {
  if (view.snapshot.data_source.is_live) return "Live sandbox";
  if (view.snapshot.data_source.source === "demo_fixture") return "Fixture";
  return "Sandbox unavailable";
}

function provenanceCopy(view: RunwayViewModel) {
  const source = view.snapshot.data_source;

  if (source.source === "demo_fixture") {
    return (
      <>
        <strong>Fixture preview.</strong> Every number below is deterministic
        demo data, not a Pinch call or a bank balance. Selecting sandbox mode
        will never fall back here if a live call fails.
      </>
    );
  }

  if (source.is_live) {
    return (
      <>
        <strong>Live Pinch sandbox data.</strong> This snapshot is labelled
        from its source and the coverage floor below is not a bank balance.
      </>
    );
  }

  return (
    <>
      <strong>Pinch sandbox data is unavailable.</strong> {source.error_message ??
        "No fixture substitute is shown for a failed live read."}
    </>
  );
}

function PingAction({
  cta,
}: {
  cta: RunwayViewModel["pings"][number]["cta"];
}) {
  if (cta.label === "Create Pinch payment link") {
    return (
      <div className="ping-actions" aria-label="Pinch payment link action status">
        <PaymentLinkAction invoiceId={cta.action.target_invoice_id} />
      </div>
    );
  }

  return (
    <div className="ping-actions ping-actions-status">
      <span className="ping-status-label">{cta.label}</span>
    </div>
  );
}

/**
 * Presentational only: it consumes a labelled, shared-contract view model
 * rather than raw Pinch payloads. The same component can render a future live
 * snapshot without swapping UI logic or silently displaying fixtures.
 */
export function RunwayDashboard({
  view,
  readiness,
}: RunwayDashboardProps) {
  const { snapshot, analysis, forecast, pings } = view;
  const unpaidInvoices = snapshot.invoices.filter(
    (invoice) => invoice.status === "unpaid",
  );
  const unpaidCollections = unpaidInvoices.reduce(
    (total, invoice) => total + invoice.amount,
    0,
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
        <div className={"connection-badge connection-" + readiness.state}>
          <span aria-hidden="true" className="status-dot" />
          <span>{readiness.display_label}</span>
        </div>
      </section>

      <section className="provenance-notice" aria-label="Data provenance">
        {provenanceCopy(view)}
      </section>

      <div className="runway-grid">
        <section className="ping-panel" aria-labelledby="pings-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">What needs your attention</p>
              <h2 id="pings-title">Runway pings</h2>
            </div>
            <span className={"state-pill state-" + forecast.state}>
              {forecast.state}
            </span>
          </div>

          <div className="ping-feed" aria-live="polite">
            {pings.map((ping, index) => (
              <article
                className={index === 0 ? "primary-ping" : "secondary-ping"}
                key={ping.id}
              >
                <p className="ping-kicker">
                  {index === 0 ? "This week’s call" : "Runway update"}
                </p>
                <p className="ping-copy">{ping.text}</p>
                <p className="ping-action">{ping.consequence}</p>
                <PingAction cta={ping.cta} />
              </article>
            ))}
          </div>

          <article className="check-in-card">
            <div>
              <p className="check-in-title">Weekly draw check-in</p>
              <p>
                Did {formatAud(analysis.weekly_draw.amount)} cover you this
                week?
              </p>
            </div>
            <div
              className="choice-row"
              aria-label="Planned weekly check-in choices"
            >
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
            <span className="demo-pill">{sourceTag(view)}</span>
          </div>

          <div className="snapshot-state">
            <span>Forecast state</span>
            <strong className={"snapshot-state-" + forecast.state}>
              {forecast.state}
            </strong>
          </div>

          <div className="summary-row">
            <div>
              <span>Unpaid collections</span>
              <strong>{formatAud(unpaidCollections)}</strong>
            </div>
            <div>
              <span>Declared weekly draw</span>
              <strong>{formatAud(analysis.weekly_draw.amount)}</strong>
            </div>
            <div>
              <span>Expected coverage floor</span>
              <strong>{formatAud(forecast.lowest_balance)}</strong>
            </div>
          </div>

          <p className="coverage-caption">
            Coverage floor means projected collections less declared commitments
            in this seven-day window — not a bank balance.
          </p>

          <div className="ledger-section">
            <h3>Unpaid payment records</h3>
            <ul className="invoice-list">
              {unpaidInvoices.map((invoice) => {
                const payer = snapshot.payers.find(
                  (item) => item.id === invoice.payer_id,
                );
                return (
                  <li key={invoice.id}>
                    <div>
                      <strong>{payer?.name ?? "Unknown payer"}</strong>
                      <span>Due {formatDate(invoice.due_date)}</span>
                    </div>
                    <div className="invoice-meta">
                      <strong>{formatAud(invoice.amount)}</strong>
                      <span
                        className={
                          "reliability-tag collection-pending"
                        }
                      >
                        {invoiceStatusLabel(invoice)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="ledger-section">
            <h3>Upcoming declared items</h3>
            {analysis.in_window_lumpy_expenses.length ? (
              <ul className="expense-list">
                {analysis.in_window_lumpy_expenses.map((item) => (
                  <li key={item.expense_id}>
                    <span>{item.note}</span>
                    <span>
                      {formatAud(item.amount)} · {formatDate(item.date)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-copy">
                Nothing extra declared inside the next seven days.
              </p>
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
          <li>Read payment methods and verified Payment statuses.</li>
          <li>Create a real sandbox Payment Link and show its provider result.</li>
        </ol>
      </section>
    </main>
  );
}
