import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Minimal, non-sensitive action ledger. Australia/Sydney date is supplied by server code. */
export const collectionActions = sqliteTable("collection_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: text("invoice_id").notNull(),
  actionDate: text("action_date").notNull(),
  state: text("state", { enum: ["reserving", "link_created", "shared", "failed_known", "outcome_unknown"] }).notNull(),
  pinchLinkId: text("pinch_link_id"),
  createdAt: text("created_at").notNull(),
  reservedAt: text("reserved_at").notNull(),
  linkCreatedAt: text("link_created_at"),
  sharedAt: text("shared_at"),
  resendEmailId: text("resend_email_id"),
  emailedAt: text("emailed_at"),
  errorCode: text("error_code"),
  errorStatus: integer("error_status"),
}, (table) => [uniqueIndex("collection_actions_invoice_day").on(table.invoiceId, table.actionDate)]);

export const pinchWebhookEvents = sqliteTable("pinch_webhook_events", {
  eventId: text("event_id").primaryKey(),
  receivedAt: text("received_at").notNull(),
  eventType: text("event_type").notNull(),
  paymentId: text("payment_id"),
  status: text("status"),
});

export const runwayProfiles = sqliteTable("runway_profiles", {
  id: integer("id").primaryKey(),
  operatorEmail: text("operator_email").notNull(),
  basiqUserId: text("basiq_user_id"),
  bankState: text("bank_state", {
    enum: [
      "connected",
      "syncing",
      "stale",
      "consent_required",
      "error",
      "demo",
    ],
  }).notNull(),
  consentStatus: text("consent_status", {
    enum: ["unknown", "valid", "required", "revoked", "expired"],
  }).notNull(),
  connectStateHash: text("connect_state_hash"),
  lastSyncedAt: text("last_synced_at"),
  syncError: text("sync_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    accountId: text("account_id").primaryKey(),
    profileId: integer("profile_id").notNull(),
    name: text("name").notNull(),
    maskedNumber: text("masked_number"),
    institution: text("institution"),
    accountClass: text("account_class").notNull(),
    cashRole: text("cash_role").notNull(),
    currency: text("currency").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    availableFundsCents: integer("available_funds_cents"),
    selected: integer("selected", { mode: "boolean" }).notNull(),
    lastUpdatedAt: text("last_updated_at"),
    syncedAt: text("synced_at").notNull(),
  },
  (table) => [
    index("bank_accounts_profile_selected").on(table.profileId, table.selected),
  ],
);

export const bankSnapshots = sqliteTable(
  "bank_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id").notNull(),
    createdAt: text("created_at").notNull(),
    operatingCashCents: integer("operating_cash_cents").notNull(),
    liabilitiesCents: integer("liabilities_cents").notNull(),
    expenseProfileJson: text("expense_profile_json"),
  },
  (table) => [index("bank_snapshots_profile_created").on(table.profileId, table.createdAt)],
);

export const expenseExclusions = sqliteTable(
  "expense_exclusions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id").notNull(),
    pattern: text("pattern").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("expense_exclusions_profile_pattern").on(
      table.profileId,
      table.pattern,
    ),
  ],
);

export const receivables = sqliteTable(
  "receivables",
  {
    id: text("id").primaryKey(),
    payerName: text("payer_name").notNull(),
    payerEmail: text("payer_email").notNull(),
    safeAddress: text("safe_address").notNull(),
    amountCents: integer("amount_cents").notNull(),
    issuedDate: text("issued_date").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status", {
      enum: ["unpaid", "paid", "written_off"],
    }).notNull(),
    paidDate: text("paid_date"),
    payerHistoryCount: integer("payer_history_count").notNull(),
    avgDaysLate: integer("avg_days_late"),
    reminderCount: integer("reminder_count").notNull(),
    lastReminderAt: text("last_reminder_at"),
    source: text("source", { enum: ["demo"] }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("receivables_status_due").on(table.status, table.dueDate),
  ],
);

export const reminderDecisions = sqliteTable(
  "reminder_decisions",
  {
    id: text("id").primaryKey(),
    localDate: text("local_date").notNull(),
    evaluatedAt: text("evaluated_at").notNull(),
    targetReceivableId: text("target_receivable_id"),
    eligible: integer("eligible", { mode: "boolean" }).notNull(),
    suppressionReason: text("suppression_reason"),
    earliestBreachDate: text("earliest_breach_date"),
    riskBufferCents: integer("risk_buffer_cents").notNull(),
    cashAtBreachCents: integer("cash_at_breach_cents"),
    repairAmountCents: integer("repair_amount_cents"),
    forecastJson: text("forecast_json").notNull(),
  },
  (table) => [
    uniqueIndex("reminder_decisions_local_target").on(
      table.localDate,
      table.targetReceivableId,
    ),
  ],
);

export const reminderDeliveries = sqliteTable(
  "reminder_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    decisionId: text("decision_id").notNull(),
    receivableId: text("receivable_id").notNull(),
    reminderSequence: integer("reminder_sequence").notNull(),
    intendedRecipient: text("intended_recipient").notNull(),
    actualRecipient: text("actual_recipient").notNull(),
    automationMode: text("automation_mode", {
      enum: ["test", "live"],
    }).notNull(),
    providerDeliveryId: text("provider_delivery_id"),
    status: text("status", {
      enum: ["reserved", "sent", "failed", "cancelled"],
    }).notNull(),
    reservedAt: text("reserved_at").notNull(),
    sentAt: text("sent_at"),
    terminalAt: text("terminal_at"),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("reminder_deliveries_decision").on(table.decisionId),
    uniqueIndex("reminder_deliveries_invoice_sequence").on(
      table.receivableId,
      table.reminderSequence,
    ),
  ],
);

export const schedulerExecutions = sqliteTable("scheduler_executions", {
  localDate: text("local_date").primaryKey(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status", {
    enum: ["running", "completed", "failed", "skipped"],
  }).notNull(),
  decisionId: text("decision_id"),
  errorCode: text("error_code"),
});

export const basiqWebhookEvents = sqliteTable("basiq_webhook_events", {
  eventId: text("event_id").primaryKey(),
  receivedAt: text("received_at").notNull(),
  eventType: text("event_type").notNull(),
  entityUrl: text("entity_url"),
});

export const agentPermissions = sqliteTable("agent_permissions", {
  actionClass: text("action_class", {
    enum: [
      "collection_email",
      "payment_link",
      "calendar_edit",
      "receipt_request",
    ],
  }).primaryKey(),
  mode: text("mode", {
    enum: ["blocked", "ask", "auto"],
  }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    triggerType: text("trigger_type", {
      enum: ["demo_event", "whatsapp", "manual", "heartbeat"],
    }).notNull(),
    status: text("status", {
      enum: ["running", "awaiting_approval", "completed", "failed"],
    }).notNull(),
    provenance: text("provenance", {
      enum: ["live", "simulated", "fallback"],
    }).notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    summary: text("summary"),
    forecastJson: text("forecast_json"),
    errorCode: text("error_code"),
  },
  (table) => [index("agent_runs_started").on(table.startedAt)],
);

export const agentHeartbeatSettings = sqliteTable("agent_heartbeat_settings", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentHeartbeatExecutions = sqliteTable(
  "agent_heartbeat_executions",
  {
    scheduledHour: text("scheduled_hour").primaryKey(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    status: text("status", {
      enum: ["running", "completed", "failed", "skipped"],
    }).notNull(),
    runId: text("run_id"),
    errorCode: text("error_code"),
  },
  (table) => [index("agent_heartbeat_executions_started").on(table.startedAt)],
);

export const agentToolCalls = sqliteTable(
  "agent_tool_calls",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    toolName: text("tool_name").notNull(),
    actionClass: text("action_class"),
    status: text("status", {
      enum: ["proposed", "awaiting_approval", "succeeded", "failed"],
    }).notNull(),
    provenance: text("provenance", {
      enum: ["live", "simulated", "fallback"],
    }).notNull(),
    inputJson: text("input_json").notNull(),
    resultJson: text("result_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("agent_tool_calls_run").on(table.runId, table.createdAt)],
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id"),
    channel: text("channel", {
      enum: ["whatsapp", "web", "system"],
    }).notNull(),
    direction: text("direction", {
      enum: ["inbound", "outbound"],
    }).notNull(),
    providerMessageId: text("provider_message_id"),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_messages_provider_id").on(table.providerMessageId),
    index("agent_messages_created").on(table.createdAt),
  ],
);

export const simulatedOutbox = sqliteTable(
  "simulated_outbox",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    threadId: text("thread_id").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["drafted", "sent"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("simulated_outbox_run").on(table.runId, table.createdAt)],
);

/**
 * The approval queue behind the "Ask me" permission mode.
 *
 * When a tool's action class is set to "ask", the runtime refuses to run the
 * side effect and parks the proposed action here instead. The owner resolves it
 * from the command centre, and only an explicit approval executes the tool.
 * Without this table "Ask me" would be indistinguishable from "Blocked" —
 * the run would simply stop with no way to say yes.
 */
export const agentApprovals = sqliteTable(
  "agent_approvals",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    // One approval per audited tool call. The unique index makes a retried
    // enqueue a no-op rather than a duplicate row in the owner's queue.
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    actionClass: text("action_class", {
      enum: [
        "collection_email",
        "payment_link",
        "calendar_edit",
        "receipt_request",
      ],
    }).notNull(),
    inputJson: text("input_json").notNull(),
    summary: text("summary").notNull(),
    status: text("status", {
      enum: ["pending", "executing", "executed", "denied", "failed"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
    resultJson: text("result_json"),
  },
  (table) => [
    uniqueIndex("agent_approvals_tool_call").on(table.toolCallId),
    index("agent_approvals_status").on(table.status, table.createdAt),
  ],
);

/**
 * Mutations the agent has made to the seeded calendar fixture.
 *
 * Runway does not talk to Google Calendar. The calendar the agent reads is a
 * hard-coded fixture (lib/agent-integrations/google-seeded.ts), so an edit has
 * nowhere to land unless we record it. Each row is one edit, replayed as an
 * overlay on the fixture at read time. That keeps the fixture immutable while
 * making the `calendar_edit` permission observably real: what the agent changes
 * under "Auto" is what it reads back later.
 */
export const simulatedCalendarEdits = sqliteTable(
  "simulated_calendar_edits",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    eventId: text("event_id").notNull(),
    summary: text("summary"),
    startDateTime: text("start_date_time"),
    endDateTime: text("end_date_time"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("simulated_calendar_edits_event").on(table.eventId, table.createdAt),
  ],
);

export const demoAgentState = sqliteTable("demo_agent_state", {
  id: integer("id").primaryKey(),
  scenarioState: text("scenario_state", {
    enum: ["ready", "triggered", "completed"],
  }).notNull(),
  activeRunId: text("active_run_id"),
  updatedAt: text("updated_at").notNull(),
});
