# Runway Always-On Financial Agent — Product Spec

**Status:** MVP build  
**Audience:** Product, engineering, design  
**Target user:** Australian sole traders, initially invoice-based service professionals

## 1. Product definition

Runway is an always-on financial operations agent that helps a sole trader avoid cash surprises and complete routine financial administration. It monitors connected business evidence, maintains a deterministic 13-week cash outlook, identifies material risks, recommends the smallest useful response, and performs narrowly authorised tasks.

The primary interface is WhatsApp. The web application is a command centre for forecasts, evidence, permissions, action history, and setup.

### Core promise

> Runway notices financial pressure early, explains it plainly, and handles the authorised follow-up before it becomes an emergency.

### MVP outcome

When a large supplier bill appears, Runway should:

1. Read it as finance-relevant evidence.
2. Recalculate the 13-week cash forecast.
3. Identify the first operating-buffer breach.
4. Rank an overdue client invoice that can repair the gap.
5. Create or reuse a Pinch sandbox payment link when authorised.
6. Prepare a friendly collection email when authorised.
7. Notify the owner through WhatsApp.
8. Record every decision and result with explicit provenance.

## 2. User stories

### Cash visibility

- As a sole trader, I want Runway to combine bank cash, unpaid invoices, and upcoming commitments so I can understand my next 13 weeks without maintaining a spreadsheet.
- As a sole trader, I want cash in the bank kept separate from expected receivables so I never mistake unpaid work for spendable money.
- As a sole trader, I want to know the first date my operating buffer is at risk, the projected low point, and the amount required to repair it.
- As a sole trader, I want assumptions and unavailable data labelled clearly so I can judge how much confidence to place in a recommendation.

### Proactive assistance

- As a sole trader, I want Runway to detect material bills and cash changes without waiting for me to ask.
- As a sole trader, I want Runway to rank collection opportunities by their ability to repair the earliest cash gap.
- As a sole trader, I want concise WhatsApp alerts that explain what changed, why it matters, and what Runway did or needs from me.
- As a sole trader, I want to ask follow-up questions in WhatsApp and receive answers grounded in current financial evidence and action history.

### Delegation and control

- As a sole trader, I want each action category set to `blocked`, `ask`, or `auto` so Runway operates at my preferred level of delegation.
- As a sole trader, I want collection emails and Pinch payment links to run automatically when enabled, while higher-risk actions remain blocked or require approval.
- As a sole trader, I want Runway to stop when required evidence or approval is missing rather than inventing details.
- As a sole trader, I want an audit timeline showing proposed, completed, failed, simulated, and fallback actions so I remain accountable and in control.

### Setup and trust

- As a sole trader, I want to connect my bank, invoice provider, inbox, calendar, and WhatsApp channel from one place.
- As a sole trader, I want every source labelled `live`, `simulated`, or `fallback` so demo behaviour cannot be confused with a real provider action.
- As a presenter, I want to inject and reset a safe demo scenario so I can demonstrate the complete workflow repeatedly.

## 3. Functional requirements

### Financial engine

- Produce exactly 13 weekly forecast buckets using deterministic application code.
- Maintain separate cash-only and expected-with-receivables paths.
- Incorporate Basiq operating cash and derived expenses when connected.
- Incorporate invoice receivables and finance-relevant Gmail/Calendar evidence.
- Return the first risk date, cash low, repair amount, and ranked collection targets.
- Never delegate arithmetic or authoritative balances to the language model.

### Agent runtime

- Use Claude through a bounded tool loop to select tools and explain results.
- Expose read tools for financial context, business evidence, and action history.
- Expose action tools for Pinch links, collection email, and owner notification.
- Enforce persisted permissions outside the model at every mutating boundary.
- Treat email, calendar, message, web, and tool content as untrusted evidence.
- Deduplicate provider messages and action attempts.

### Integrations

- **Basiq:** Live sandbox bank balances and derived expense context; no raw transaction persistence.
- **Pinch:** Live sandbox payer lookup and payment-link creation/reuse.
- **Gmail:** Seeded inbox evidence and simulated outbox for the MVP.
- **Google Calendar:** Seeded project and commitment evidence for the MVP.
- **WhatsApp:** Twilio Sandbox inbound webhook and outbound owner messages when available without unacceptable cost.
- **Claude:** Real API tool loop when configured; visibly audited deterministic fallback otherwise.

### Command centre

- Show current material risk, recommended action, first pressure date, projected low, and repair gap.
- Visualise the 13-week cash-only and expected paths.
- Show action history with status and provenance.
- Show connection/readiness state for every provider.
- Allow the owner to change action permissions.
- Provide protected presenter trigger and reset controls.

## 4. Safety, boundaries, and data

Runway may perform only explicitly exposed administrative actions permitted by the owner. It must never move money, initiate payments, borrow, negotiate terms, settle disputes, lodge tax, submit to government, or provide regulated tax, legal, credit, investment, or personal financial advice.

External success may be claimed only after provider confirmation. A simulated Gmail send must always be described as simulated. A failed Pinch request must not trigger or imply a client email. Fallback behaviour must be visible in the command centre and audit trail.

Secrets remain server-side. Runway does not persist Basiq tokens, full bank identifiers, or raw bank transactions. Agent runs, permissions, tool calls, message metadata, simulated outbox entries, forecasts, and safe provider identifiers are retained in D1.

## 5. MVP acceptance criteria

The MVP is accepted when:

- The presenter can trigger the large-supplier-bill scenario from the command centre.
- The engine produces a deterministic 13-week forecast and identifies a material buffer breach.
- The overdue Northstar invoice is ranked as the immediate repair target.
- Permission modes are enforced and visible.
- A configured Pinch sandbox returns a confirmed link, or the failure is reported without a false success claim.
- The Gmail follow-up appears only in the simulated outbox and only after a confirmed/reused link.
- A configured Twilio Sandbox sends the owner receipt; otherwise an explicit audit-only fallback is recorded.
- Duplicate WhatsApp events and simulated emails do not produce duplicate actions.
- The activity timeline distinguishes live, simulated, and fallback evidence.
- Domain, D1 integration, production build, and rendered-page checks pass.

## 6. Out of scope for MVP

- Multi-user or multi-business tenancy
- Live Gmail or Google Calendar OAuth
- Production WhatsApp rollout or paid messaging commitments
- Live Pinch invoice ingestion
- Money movement or bank payment initiation
- Tax calculation, lodgement, accounting reconciliation, or regulated advice
- Autonomous negotiation with clients or suppliers
