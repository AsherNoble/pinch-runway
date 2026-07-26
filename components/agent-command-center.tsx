"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

export type AgentProvenance = "live" | "simulated" | "fallback";
export type AgentPermissionMode = "blocked" | "ask" | "auto";
export type AgentSourceName =
  | "Basiq"
  | "Pinch"
  | "Gmail"
  | "Calendar"
  | "Workers AI"
  | "WhatsApp";

export interface AgentCommandCenterViewModel {
  generatedAt: string;
  greeting?: string;
  risk: {
    level: "comfortable" | "watch" | "material" | "critical";
    eyebrow: string;
    title: string;
    summary: string;
    riskDate: string | null;
    projectedLowCents: number | null;
    repairAmountCents: number | null;
    actionLabel: string;
    actionState: "recommended" | "in_progress" | "completed" | "paused";
    provenance: AgentProvenance;
  };
  forecast: {
    bufferCents: number;
    weeks: readonly {
      id: string;
      label: string;
      startsOn: string;
      cashOnlyCents: number;
      expectedCents: number;
    }[];
  };
  activity: readonly {
    id: string;
    title: string;
    detail: string;
    occurredAt: string;
    state: "queued" | "running" | "completed" | "failed" | "needs_approval";
    provenance: AgentProvenance;
  }[];
  sources: readonly {
    name: AgentSourceName;
    status: "ready" | "seeded" | "degraded" | "offline" | "not_configured";
    detail: string;
    updatedAt: string | null;
    provenance: AgentProvenance;
  }[];
  permissions: readonly {
    actionClass: string;
    label: string;
    description: string;
    mode: AgentPermissionMode;
  }[];
  /**
   * Actions the agent proposed while their action class was set to "Ask me".
   * They have not run. Each one needs an explicit owner decision.
   */
  approvals: readonly {
    id: string;
    actionClass: string;
    label: string;
    summary: string;
    requestedAt: string;
  }[];
  presenter?: {
    enabled: boolean;
    scenarioLabel: string;
    triggerLabel?: string;
    resetLabel?: string;
  };
}

export interface AgentCommandCenterEndpoints {
  permission?: string;
  approval?: string;
  trigger?: string;
  reset?: string;
}

export interface AgentCommandCenterProps {
  model: AgentCommandCenterViewModel;
  endpoints?: AgentCommandCenterEndpoints;
}

const permissionModes: readonly {
  mode: AgentPermissionMode;
  label: string;
}[] = [
  { mode: "blocked", label: "Blocked" },
  { mode: "ask", label: "Ask me" },
  { mode: "auto", label: "Auto" },
];

function aud(cents: number | null) {
  if (cents === null) return "Not available";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function dateLabel(value: string | null, includeTime = false) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    ...(includeTime
      ? {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "Australia/Sydney",
        }
      : {}),
  }).format(date);
}

function sourceStatusLabel(
  status: AgentCommandCenterViewModel["sources"][number]["status"],
) {
  return status.replaceAll("_", " ");
}

function ProvenanceBadge({ value }: { value: AgentProvenance }) {
  return (
    <span className={`agent-provenance agent-provenance-${value}`}>
      {value}
    </span>
  );
}

function Forecast({
  forecast,
}: {
  forecast: AgentCommandCenterViewModel["forecast"];
}) {
  const weeks = forecast.weeks.slice(0, 13);
  if (!weeks.length) {
    return (
      <p className="agent-empty">
        There is not enough connected data to build the 13-week view yet.
      </p>
    );
  }

  const values = weeks.flatMap((week) => [
    week.cashOnlyCents,
    week.expectedCents,
  ]);
  const minimum = Math.min(0, forecast.bufferCents, ...values);
  const maximum = Math.max(1, forecast.bufferCents, ...values);
  const range = Math.max(1, maximum - minimum);
  const position = (value: number) => ((value - minimum) / range) * 100;
  const zero = position(0);
  const buffer = position(forecast.bufferCents);

  return (
    <div className="agent-forecast">
      <div className="agent-chart-legend" aria-hidden="true">
        <span><i className="agent-legend-cash" />Cash only</span>
        <span><i className="agent-legend-expected" />Expected</span>
        <span><i className="agent-legend-buffer" />Buffer</span>
      </div>
      <div
        aria-label={`Thirteen-week forecast. The operating buffer is ${aud(
          forecast.bufferCents,
        )}.`}
        className="agent-week-chart"
        role="img"
        style={
          {
            "--agent-zero": `${zero}%`,
            "--agent-buffer": `${buffer}%`,
          } as CSSProperties
        }
      >
        <span className="agent-buffer-line" aria-hidden="true" />
        <span className="agent-zero-line" aria-hidden="true" />
        {weeks.map((week) => {
          const cashStart = position(Math.min(0, week.cashOnlyCents));
          const expectedStart = position(Math.min(0, week.expectedCents));
          const style = {
            "--agent-cash-start": `${cashStart}%`,
            "--agent-cash-size": `${Math.max(
              1,
              Math.abs(position(week.cashOnlyCents) - zero),
            )}%`,
            "--agent-expected-start": `${expectedStart}%`,
            "--agent-expected-size": `${Math.max(
              1,
              Math.abs(position(week.expectedCents) - zero),
            )}%`,
          } as CSSProperties;
          return (
            <div
              className="agent-week"
              key={week.id}
              style={style}
              title={`${week.label}: cash only ${aud(
                week.cashOnlyCents,
              )}; expected ${aud(week.expectedCents)}`}
            >
              <div className="agent-week-bars" aria-hidden="true">
                <i className="agent-week-cash" />
                <i className="agent-week-expected" />
              </div>
              <span>{week.label}</span>
              <span className="agent-sr-only">
                {dateLabel(week.startsOn)}: cash only {aud(week.cashOnlyCents)};
                expected {aud(week.expectedCents)}.
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AgentCommandCenter({
  model,
  endpoints = {},
}: AgentCommandCenterProps) {
  const [permissions, setPermissions] = useState(() =>
    Object.fromEntries(
      model.permissions.map((permission) => [
        permission.actionClass,
        permission.mode,
      ]),
    ) as Record<string, AgentPermissionMode>,
  );
  const [busyPermission, setBusyPermission] = useState<string | null>(null);
  const [busyApproval, setBusyApproval] = useState<string | null>(null);
  // Decisions are hidden immediately so a resolved action cannot be clicked
  // twice while the server component re-renders.
  const [resolvedApprovals, setResolvedApprovals] = useState<readonly string[]>(
    [],
  );
  const [presenterBusy, setPresenterBusy] = useState<"trigger" | "reset" | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const router = useRouter();
  const pendingApprovals = model.approvals.filter(
    (approval) => !resolvedApprovals.includes(approval.id),
  );

  async function savePermission(
    actionClass: string,
    mode: AgentPermissionMode,
  ) {
    if (!endpoints.permission) return;
    setBusyPermission(actionClass);
    setMessage("");
    try {
      const response = await fetch(endpoints.permission, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionClass, mode }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        mode?: AgentPermissionMode;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Runway could not update that permission.");
      }
      setPermissions((current) => ({
        ...current,
        [actionClass]: body.mode ?? mode,
      }));
      setMessage("Permission updated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Runway could not update that permission.",
      );
    } finally {
      setBusyPermission(null);
    }
  }

  /**
   * Sends the owner's decision on a parked action. Approving runs the side
   * effect server-side; this component never executes anything itself.
   */
  async function decideApproval(
    approvalId: string,
    decision: "approve" | "deny",
  ) {
    if (!endpoints.approval) return;
    setBusyApproval(approvalId);
    setMessage("");
    try {
      const response = await fetch(endpoints.approval, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Runway could not record that decision.");
      }
      setResolvedApprovals((current) => [...current, approvalId]);
      setMessage(
        body.message ??
          (decision === "approve"
            ? "Approved. Runway completed the action."
            : "Action denied. Runway did not run it."),
      );
      // Pull the server state so the audit timeline reflects the new outcome.
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Runway could not record that decision.",
      );
    } finally {
      setBusyApproval(null);
    }
  }

  async function runPresenterAction(action: "trigger" | "reset") {
    const endpoint = endpoints[action];
    if (!endpoint) return;
    setPresenterBusy(action);
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.error ?? `Runway could not ${action} the demo scenario.`,
        );
      }
      setMessage(
        body.message ??
          (action === "trigger"
            ? "Scenario event received. The agent is working."
            : "Scenario reset. You’re ready for another run."),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Runway could not ${action} the demo scenario.`,
      );
    } finally {
      setPresenterBusy(null);
    }
  }

  const risk = model.risk;
  return (
    <main className="agent-command-center">
      <header className="agent-command-header">
        <div>
          <p className="eyebrow">Runway · always-on money ops</p>
          <h1>{model.greeting ?? "Here’s what needs your attention."}</h1>
          <p>
            Your cash, invoices and business commitments in one practical view.
            Generated {dateLabel(model.generatedAt, true)}.
          </p>
        </div>
        <div className="agent-listening">
          <span aria-hidden="true" />
          Agent monitoring
        </div>
      </header>

      <section
        className={`agent-risk-card agent-risk-${risk.level}`}
        aria-labelledby="agent-risk-title"
      >
        <div className="agent-risk-copy">
          <div className="agent-card-heading">
            <div>
              <p className="eyebrow">{risk.eyebrow}</p>
              <h2 id="agent-risk-title">{risk.title}</h2>
            </div>
            <div className="agent-badge-row">
              <span className={`agent-action-state agent-state-${risk.actionState}`}>
                {risk.actionState.replaceAll("_", " ")}
              </span>
              <ProvenanceBadge value={risk.provenance} />
            </div>
          </div>
          <p>{risk.summary}</p>
          <div className="agent-recommended-action">
            <span>Runway’s move</span>
            <strong>{risk.actionLabel}</strong>
          </div>
        </div>
        <dl className="agent-risk-stats">
          <div>
            <dt>Pressure date</dt>
            <dd>{dateLabel(risk.riskDate)}</dd>
          </div>
          <div>
            <dt>Projected low</dt>
            <dd>{aud(risk.projectedLowCents)}</dd>
          </div>
          <div>
            <dt>Gap to repair</dt>
            <dd>{aud(risk.repairAmountCents)}</dd>
          </div>
        </dl>
      </section>

      <div className="agent-main-grid">
        <section className="agent-panel agent-forecast-panel">
          <div className="agent-card-heading">
            <div>
              <p className="eyebrow">Thirteen-week outlook</p>
              <h2>How the next quarter looks</h2>
            </div>
            <span className="agent-buffer-value">
              {aud(model.forecast.bufferCents)} buffer
            </span>
          </div>
          <Forecast forecast={model.forecast} />
        </section>

        <section className="agent-panel agent-activity-panel">
          <div className="agent-card-heading">
            <div>
              <p className="eyebrow">Agent activity</p>
              <h2>What Runway did and why</h2>
            </div>
          </div>
          {model.activity.length ? (
            <ol className="agent-timeline">
              {model.activity.map((item) => (
                <li className={`agent-event agent-event-${item.state}`} key={item.id}>
                  <span className="agent-event-marker" aria-hidden="true" />
                  <div>
                    <div className="agent-event-heading">
                      <strong>{item.title}</strong>
                      <ProvenanceBadge value={item.provenance} />
                    </div>
                    <p>{item.detail}</p>
                    <time dateTime={item.occurredAt}>
                      {dateLabel(item.occurredAt, true)} ·{" "}
                      {item.state.replaceAll("_", " ")}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="agent-empty">
              Nothing to report yet. Runway will log each recommendation and
              action here.
            </p>
          )}
        </section>
      </div>

      <section className="agent-panel agent-source-section">
        <div className="agent-card-heading">
          <div>
            <p className="eyebrow">Connected context</p>
            <h2>What the agent can currently see</h2>
          </div>
          <p>Every source says whether it is live, seeded or using a fallback.</p>
        </div>
        <div className="agent-source-grid">
          {model.sources.map((source) => (
            <article
              className={`agent-source-card agent-source-${source.status}`}
              key={source.name}
            >
              <div className="agent-source-heading">
                <span className="agent-source-mark" aria-hidden="true">
                  {source.name.slice(0, 1)}
                </span>
                <div>
                  <h3>{source.name}</h3>
                  <span>{sourceStatusLabel(source.status)}</span>
                </div>
                <ProvenanceBadge value={source.provenance} />
              </div>
              <p>{source.detail}</p>
              <small>
                {source.updatedAt
                  ? `Updated ${dateLabel(source.updatedAt, true)}`
                  : "No successful sync recorded"}
              </small>
            </article>
          ))}
        </div>
      </section>

      {pendingApprovals.length ? (
        <section
          aria-labelledby="agent-approval-title"
          className="agent-panel agent-approval-section"
        >
          <div className="agent-card-heading">
            <div>
              <p className="eyebrow">Waiting on you</p>
              <h2 id="agent-approval-title">
                {pendingApprovals.length === 1
                  ? "Runway paused one action for your decision"
                  : `Runway paused ${pendingApprovals.length} actions for your decision`}
              </h2>
            </div>
            {!endpoints.approval ? (
              <span className="agent-unavailable">Controls not connected</span>
            ) : null}
          </div>
          <ul className="agent-approval-list">
            {pendingApprovals.map((approval) => (
              <li className="agent-approval-row" key={approval.id}>
                <div>
                  <strong>{approval.label}</strong>
                  <p>{approval.summary}</p>
                  <time dateTime={approval.requestedAt}>
                    Proposed {dateLabel(approval.requestedAt, true)} · nothing has
                    run yet
                  </time>
                </div>
                <div className="agent-approval-actions">
                  <button
                    className="agent-approve"
                    disabled={!endpoints.approval || busyApproval === approval.id}
                    onClick={() => void decideApproval(approval.id, "approve")}
                    type="button"
                  >
                    {busyApproval === approval.id ? "Working…" : "Approve"}
                  </button>
                  <button
                    className="agent-deny"
                    disabled={!endpoints.approval || busyApproval === approval.id}
                    onClick={() => void decideApproval(approval.id, "deny")}
                    type="button"
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="agent-panel agent-permission-section">
        <div className="agent-card-heading">
          <div>
            <p className="eyebrow">Your rules</p>
            <h2>You decide how much Runway can do</h2>
          </div>
          {!endpoints.permission ? (
            <span className="agent-unavailable">Controls not connected</span>
          ) : null}
        </div>
        <div className="agent-permission-list">
          {model.permissions.map((permission) => (
            <div className="agent-permission-row" key={permission.actionClass}>
              <div>
                <strong>{permission.label}</strong>
                <p>{permission.description}</p>
              </div>
              <div
                aria-label={`${permission.label} permission`}
                className="agent-segmented-control"
                role="group"
              >
                {permissionModes.map(({ mode, label }) => (
                  <button
                    aria-pressed={permissions[permission.actionClass] === mode}
                    className={
                      permissions[permission.actionClass] === mode
                        ? "agent-mode-selected"
                        : undefined
                    }
                    disabled={
                      !endpoints.permission ||
                      busyPermission === permission.actionClass
                    }
                    key={mode}
                    onClick={() =>
                      void savePermission(permission.actionClass, mode)
                    }
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="agent-permission-note">
          Blocked stops the action outright. Ask me pauses it here for your
          approval before anything happens. Auto lets Runway act and log it.
        </p>
      </section>

      {model.presenter?.enabled ? (
        <details className="agent-presenter-panel">
          <summary>Presenter controls</summary>
          <div className="agent-presenter-content">
            <div>
              <span>Demo scenario</span>
              <strong>{model.presenter.scenarioLabel}</strong>
              <p>
                These controls affect seeded demo state. They do not claim an
                external action succeeded unless its provider confirms it.
              </p>
            </div>
            <div className="agent-presenter-actions">
              <button
                disabled={!endpoints.trigger || presenterBusy !== null}
                onClick={() => void runPresenterAction("trigger")}
                type="button"
              >
                {presenterBusy === "trigger"
                  ? "Injecting…"
                  : (model.presenter.triggerLabel ?? "Inject large bill")}
              </button>
              <button
                disabled={!endpoints.reset || presenterBusy !== null}
                onClick={() => void runPresenterAction("reset")}
                type="button"
              >
                {presenterBusy === "reset"
                  ? "Resetting…"
                  : (model.presenter.resetLabel ?? "Reset scenario")}
              </button>
            </div>
          </div>
        </details>
      ) : null}

      {message ? (
        <p className="agent-control-message" role="status">
          {message}
        </p>
      ) : null}

      <footer className="agent-command-footer">
        Runway helps with day-to-day financial operations. It does not move
        money or provide tax, credit, investment or personal financial advice.
      </footer>
    </main>
  );
}
