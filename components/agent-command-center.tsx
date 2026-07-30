"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

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
    projectedLowDate: string | null;
    repairAmountCents: number | null;
    repairBufferCents: number | null;
    cashAtRiskCents: number | null;
    actionLabel: string;
    actionState: "recommended" | "in_progress" | "completed" | "paused";
    provenance: AgentProvenance;
  };
  forecast: {
    bufferCents: number;
    bufferMode: "auto" | "manual";
    bufferDailySpendCents: number;
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
    paymentLinkUrl?: string | null;
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
  heartbeat?: {
    enabled: boolean;
    lastCheckedAt: string | null;
    lastStatus: "running" | "completed" | "failed" | "skipped" | null;
  };
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
  heartbeat?: string;
  trigger?: string;
  reset?: string;
  riskBuffer?: string;
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
            <div className="agent-week" key={week.id} style={style} tabIndex={0}>
              <div className="agent-week-tooltip" aria-hidden="true">
                <strong>{dateLabel(week.startsOn)}</strong>
                <span>Cash only {aud(week.cashOnlyCents)}</span>
                <span>Expected {aud(week.expectedCents)}</span>
              </div>
              <div className="agent-week-bars" aria-hidden="true">
                <i
                  className={
                    week.cashOnlyCents < 0
                      ? "agent-week-cash agent-week-bar-negative"
                      : "agent-week-cash"
                  }
                />
                <i
                  className={
                    week.expectedCents < 0
                      ? "agent-week-expected agent-week-bar-negative"
                      : "agent-week-expected"
                  }
                />
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

/**
 * Positions a portalled popover against an anchor element using fixed
 * viewport coordinates, clamped to stay on-screen. Portalling to <body> is
 * what actually matters here - ancestors like .agent-risk-card use
 * overflow: hidden for their rounded-corner color bar, which silently clips
 * any absolutely-positioned popover nested inside it.
 */
function usePopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  align: "left" | "right",
) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    function reposition() {
      const anchor = anchorRef.current;
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const anchorRect = anchor.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      const margin = 12;
      let left =
        align === "right"
          ? anchorRect.right - popRect.width
          : anchorRect.left;
      left = Math.min(left, window.innerWidth - popRect.width - margin);
      left = Math.max(left, margin);
      let top = anchorRect.top - popRect.height - 10;
      if (top < margin) top = anchorRect.bottom + 10;
      setCoords({ top, left });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    // The buffer popover's height changes when its edit panel expands, so
    // watch for that instead of threading extra dependencies through here.
    const observer = new ResizeObserver(reposition);
    if (popRef.current) observer.observe(popRef.current);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      observer.disconnect();
    };
  }, [open, anchorRef, align]);

  return { popRef, coords };
}

function InfoPopover({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { popRef, coords } = usePopoverPosition(open, triggerRef, "left");

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open, popRef]);

  return (
    <span className="agent-stat-control">
      <button
        aria-expanded={open}
        aria-label={`Explain ${label}`}
        className="agent-stat-info-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        ?
      </button>
      {open
        ? createPortal(
            <div
              className="agent-stat-pop"
              ref={popRef}
              role="note"
              style={{
                top: coords?.top ?? 0,
                left: coords?.left ?? 0,
                visibility: coords ? "visible" : "hidden",
              }}
            >
              <strong className="agent-stat-pop-title">{title}</strong>
              {children}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function BufferControl({
  bufferCents,
  bufferMode,
  dailySpendCents,
  endpoint,
  onMessage,
  onSaved,
}: {
  bufferCents: number;
  bufferMode: "auto" | "manual";
  dailySpendCents: number;
  endpoint?: string;
  onMessage: (message: string) => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manualInput, setManualInput] = useState(
    String(Math.round(bufferCents / 100)),
  );
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { popRef, coords } = usePopoverPosition(open, triggerRef, "right");

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open, popRef]);

  async function saveMode(
    value: { mode: "auto" } | { mode: "manual"; manualCents: number },
  ) {
    if (!endpoint) return;
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Runway could not update the buffer.");
      }
      onMessage(
        value.mode === "manual"
          ? "Custom buffer saved."
          : "Buffer reset to automatic.",
      );
      setOpen(false);
      onSaved();
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : "Runway could not update the buffer.",
      );
    } finally {
      setSaving(false);
    }
  }

  function submitManualBuffer() {
    const dollars = Number(manualInput.replaceAll(",", "").trim());
    if (!Number.isFinite(dollars) || dollars <= 0) {
      onMessage("Enter a buffer amount greater than zero.");
      return;
    }
    void saveMode({ mode: "manual", manualCents: Math.round(dollars * 100) });
  }

  const popover = (
    <div
      className="agent-buffer-pop"
      ref={popRef}
      style={{
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        visibility: coords ? "visible" : "hidden",
      }}
    >
      <div className="agent-buffer-pop-head">
        <strong>Why {aud(bufferCents)}?</strong>
        <span
          className={`agent-provenance agent-provenance-${
            bufferMode === "manual" ? "simulated" : "live"
          }`}
        >
          {bufferMode === "manual" ? "manual" : "auto"}
        </span>
      </div>

      {bufferMode === "manual" ? (
        <p className="agent-buffer-note">
          You've set a fixed buffer. Runway uses this amount instead of the
          7-day formula until you reset it.
        </p>
      ) : (
        <>
          <div className="agent-buffer-formula">
            <div className="agent-buffer-formula-row">
              <span>Normal daily spend</span>
              <span>{aud(dailySpendCents)} / day</span>
            </div>
            <div className="agent-buffer-formula-row">
              <span>Buffer window</span>
              <span>× 7 days</span>
            </div>
            <div className="agent-buffer-formula-row agent-buffer-formula-total">
              <span>Buffer</span>
              <span>{aud(bufferCents)}</span>
            </div>
          </div>
          <p className="agent-buffer-note">
            Computed from seven days of your normal daily spend (variable
            and recurring expenses).
          </p>
        </>
      )}

      {endpoint ? (
        <>
          <button
            aria-expanded={editOpen}
            className="agent-buffer-edit-toggle"
            onClick={() => setEditOpen((current) => !current)}
            type="button"
          >
            {editOpen
              ? "Hide custom buffer ↑"
              : "Set a custom buffer instead →"}
          </button>

          {editOpen ? (
            <div className="agent-buffer-edit-panel">
              <p className="agent-buffer-edit-note">
                Overriding replaces the 7-day formula with a fixed number.
                Runway keeps using it — even after a bank connects — until
                you reset it.
              </p>
              <label htmlFor="agent-buffer-input">Custom buffer (AUD)</label>
              <div className="agent-buffer-edit-row">
                <input
                  id="agent-buffer-input"
                  inputMode="numeric"
                  onChange={(event) => setManualInput(event.target.value)}
                  type="text"
                  value={manualInput}
                />
                <button
                  className="agent-buffer-save"
                  disabled={saving}
                  onClick={submitManualBuffer}
                  type="button"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
              {bufferMode === "manual" ? (
                <button
                  className="agent-buffer-reset"
                  disabled={saving}
                  onClick={() => void saveMode({ mode: "auto" })}
                  type="button"
                >
                  Reset to automatic (7× daily spend)
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <span className="agent-unavailable">Controls not connected</span>
      )}
    </div>
  );

  return (
    <div className="agent-buffer-control">
      <button
        aria-expanded={open}
        className="agent-buffer-value"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        {aud(bufferCents)} buffer
        <span aria-hidden="true" className="agent-buffer-info-dot">
          ?
        </span>
      </button>

      {open ? createPortal(popover, document.body) : null}
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
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(
    model.heartbeat?.enabled ?? false,
  );
  const [heartbeatBusy, setHeartbeatBusy] = useState(false);
  const [presenterBusy, setPresenterBusy] = useState<"trigger" | "reset" | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [messageHovered, setMessageHovered] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const router = useRouter();

  // Auto-dismiss the status toast after a few seconds, unless the user is
  // actively hovering it. Re-runs (and restarts the timer) whenever the
  // message text or hover state changes.
  useEffect(() => {
    if (!message || messageHovered) return;
    const timeout = setTimeout(() => setMessage(""), 6_000);
    return () => clearTimeout(timeout);
  }, [message, messageHovered]);
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
      // The full agent narrative belongs in the Agent activity timeline, not
      // this transient toast — refresh so the timeline picks up the new run.
      setMessage(
        action === "trigger"
          ? "Scenario event received. See Agent activity below for what Runway did."
          : "Scenario reset. You’re ready for another run.",
      );
      router.refresh();
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

  async function toggleHeartbeat() {
    if (!endpoints.heartbeat) return;
    const enabled = !heartbeatEnabled;
    setHeartbeatBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoints.heartbeat, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        enabled?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Runway could not update the heartbeat.");
      }
      setHeartbeatEnabled(body.enabled ?? enabled);
      setMessage(
        (body.enabled ?? enabled)
          ? "Hourly heartbeat enabled. Runway will check mock finance, inbox and calendar context on the next hourly run."
          : "Hourly heartbeat paused. Existing history remains available.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Runway could not update the heartbeat.",
      );
    } finally {
      setHeartbeatBusy(false);
    }
  }

  async function copyPaymentLink(id: string, url: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      // Some browser contexts (older Safari, non-HTTPS, denied permission)
      // don't expose navigator.clipboard. Fall back to a hidden textarea.
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedLinkId(id);
    setTimeout(() => setCopiedLinkId((current) => (current === id ? null : current)), 1600);
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
            <dt>
              Pressure date
              <InfoPopover label="pressure date" title="What is the pressure date?">
                <p className="agent-stat-note">
                  The first day your <strong>cash-only</strong> balance —
                  money you&rsquo;re certain to have, not counting invoices
                  you&rsquo;re still waiting on — is projected to drop below
                  your buffer
                  {risk.repairBufferCents !== null
                    ? ` (${aud(risk.repairBufferCents)} at the time of this check)`
                    : ""}
                  .
                </p>
                {risk.repairBufferCents !== null &&
                risk.repairBufferCents !== model.forecast.bufferCents ? (
                  <p className="agent-stat-warning">
                    Your buffer has since changed to{" "}
                    {aud(model.forecast.bufferCents)}. Trigger a new check to
                    refresh this date.
                  </p>
                ) : null}
              </InfoPopover>
            </dt>
            <dd>{dateLabel(risk.riskDate)}</dd>
          </div>
          <div>
            <dt>
              Projected low
              <InfoPopover label="projected low" title="What is the projected low?">
                <p className="agent-stat-note">
                  The single lowest point your cash-only balance is expected
                  to reach across the full 13-week forecast
                  {risk.projectedLowDate
                    ? ` (around ${dateLabel(risk.projectedLowDate)})`
                    : ""}
                  . This isn&rsquo;t necessarily the pressure date above —
                  cash can keep falling after the buffer is first breached.
                </p>
              </InfoPopover>
            </dt>
            <dd>{aud(risk.projectedLowCents)}</dd>
          </div>
          <div>
            <dt>
              Gap to repair
              <InfoPopover label="gap to repair" title="How is this calculated?">
                {risk.cashAtRiskCents !== null &&
                risk.repairBufferCents !== null ? (
                  <>
                    <p className="agent-stat-note">
                      The shortfall between your buffer and the cash-only
                      balance on the pressure date — how far under buffer
                      you&rsquo;re projected to be the moment it&rsquo;s
                      first breached.
                    </p>
                    <div className="agent-stat-formula">
                      <div className="agent-stat-formula-row">
                        <span>Buffer</span>
                        <span>{aud(risk.repairBufferCents)}</span>
                      </div>
                      <div className="agent-stat-formula-row">
                        <span>Cash-only on {dateLabel(risk.riskDate)}</span>
                        <span>− {aud(risk.cashAtRiskCents)}</span>
                      </div>
                      <div className="agent-stat-formula-row agent-stat-formula-total">
                        <span>Gap to repair</span>
                        <span>{aud(risk.repairAmountCents)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="agent-stat-note">
                    The shortfall between your buffer and the cash-only
                    balance on the pressure date, once cash is projected to
                    breach it. No breach is currently projected, so there is
                    nothing to repair.
                  </p>
                )}
                {risk.repairBufferCents !== null &&
                risk.repairBufferCents !== model.forecast.bufferCents ? (
                  <p className="agent-stat-warning">
                    Computed with a {aud(risk.repairBufferCents)} buffer
                    active at the time — your current buffer is{" "}
                    {aud(model.forecast.bufferCents)}. Trigger a new check to
                    refresh this figure.
                  </p>
                ) : null}
              </InfoPopover>
            </dt>
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
            <BufferControl
              bufferCents={model.forecast.bufferCents}
              bufferMode={model.forecast.bufferMode}
              dailySpendCents={model.forecast.bufferDailySpendCents}
              endpoint={endpoints.riskBuffer}
              onMessage={setMessage}
              onSaved={() => router.refresh()}
            />
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
                    {item.paymentLinkUrl ? (
                      <div className="agent-event-link">
                        <span className="agent-event-link-url">
                          {item.paymentLinkUrl}
                        </span>
                        <div className="agent-event-link-actions">
                          <a
                            className="agent-link-btn agent-link-btn-primary"
                            href={item.paymentLinkUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open link
                          </a>
                          <button
                            className="agent-link-btn agent-link-btn-ghost"
                            onClick={() =>
                              void copyPaymentLink(item.id, item.paymentLinkUrl!)
                            }
                            type="button"
                          >
                            {copiedLinkId === item.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                    ) : null}
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

      {model.heartbeat ? (
        <section className="agent-panel agent-heartbeat-panel">
          <div className="agent-card-heading">
            <div>
              <p className="eyebrow">Hourly heartbeat</p>
              <h2>Mock-context monitoring</h2>
            </div>
            <span
              className={`agent-action-state agent-state-${
                heartbeatEnabled ? "completed" : "paused"
              }`}
            >
              {heartbeatEnabled ? "on" : "paused"}
            </span>
          </div>
          <p>
            Every hourly pass reads the mock inbox, mock calendar, financial
            snapshot and recent Runway history. It only records a summary; it
            does not send messages or take collection actions.
          </p>
          <div className="agent-heartbeat-actions">
            <small>
              {model.heartbeat.lastCheckedAt
                ? `Last check ${dateLabel(model.heartbeat.lastCheckedAt, true)}${
                    model.heartbeat.lastStatus
                      ? ` · ${model.heartbeat.lastStatus}`
                      : ""
                  }`
                : "No hourly check recorded yet."}
            </small>
            <button
              aria-pressed={heartbeatEnabled}
              disabled={!endpoints.heartbeat || heartbeatBusy}
              onClick={() => void toggleHeartbeat()}
              type="button"
            >
              {heartbeatBusy
                ? "Saving…"
                : heartbeatEnabled
                  ? "Pause hourly heartbeat"
                  : "Enable hourly heartbeat"}
            </button>
          </div>
        </section>
      ) : null}

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
        <p
          className="agent-control-message"
          onMouseEnter={() => setMessageHovered(true)}
          onMouseLeave={() => setMessageHovered(false)}
          role="status"
        >
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
