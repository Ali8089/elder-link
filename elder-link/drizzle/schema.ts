// Drizzle schema — mirrors supabase/migrations/*.sql.
// Kept in sync so `drizzle-kit` can generate diffs and editors get types.
// The SQL migrations remain the source of truth for RLS policies and functions.
import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(), // 'admin' | 'operator'
}, (t) => [unique().on(t.userId, t.role)]);

export const elders = pgTable("elders", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  referenceNumber: text("reference_number").notNull().default(""),
  district: text("district").notNull().default(""),
  centre: text("centre").notNull().default(""),
  phone: text("phone").notNull().default(""),
  preferredLanguage: text("preferred_language").notNull().default("yue"),
  preferredCallTime: text("preferred_call_time").notNull().default(""),
  consentElder: boolean("consent_elder").notNull().default(false),
  consentContact: boolean("consent_contact").notNull().default(false),
  consentService: boolean("consent_service").notNull().default(false),
  consentCheckedAt: timestamp("consent_checked_at", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | active | opted_out
  checkIntervalDays: integer("check_interval_days").notNull().default(2),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
  lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id").notNull(),
  name: text("name").notNull(),
  relation: text("relation").notNull().default(""),
  phone: text("phone").notNull(),
  priority: integer("priority").notNull(),
});

export const callJobs = pgTable("call_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id").notNull(),
  kind: text("kind").notNull(), // scheduled | demo | sensor | retry
  attempt: integer("attempt").notNull().default(1),
  status: text("status").notNull().default("queued"),
  outcome: text("outcome"),
  activitySuggestion: text("activity_suggestion"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id").notNull(),
  callJobId: uuid("call_job_id"),
  reason: text("reason").notNull(),
  severity: integer("severity").notNull().default(2),
  status: text("status").notNull().default("open"),
  note: text("note"),
  version: integer("version").notNull().default(1),
  triggerAt: timestamp("trigger_at", { withTimezone: true }).notNull().defaultNow(),
  escalationStartedAt: timestamp("escalation_started_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const escalationSteps = pgTable("escalation_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull(),
  stepOrder: integer("step_order").notNull(),
  target: text("target").notNull(), // contact1 | contact2 | operator
  targetLabel: text("target_label").notNull().default(""),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const sensorAlerts = pgTable("sensor_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id").notNull(),
  externalId: text("external_id").notNull().unique(),
  alertType: text("alert_type").notNull().default("inactivity"),
  callJobId: uuid("call_job_id"),
  status: text("status").notNull().default("open"),
  safeNote: text("safe_note"),
  humanInformedAt: timestamp("human_informed_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const telephonyEvents = pgTable("telephony_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull().unique(),
  callJobId: uuid("call_job_id"),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: uuid("actor"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  zh: text("zh").notNull(),
  en: text("en").notNull(),
  active: boolean("active").notNull().default(true),
});

export const activityInterests = pgTable("activity_interests", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id").notNull(),
  activityCode: text("activity_code").notNull(),
  callJobId: uuid("call_job_id"),
  source: text("source").notNull().default("staff"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id").notNull(),
  caseId: uuid("case_id"),
  target: text("target").notNull(),
  channel: text("channel").notNull().default("phone"),
  status: text("status").notNull().default("pending"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  ip: text("ip").notNull().default(""),
  fails: integer("fails").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.email, t.ip)]);

export const schedulerRuns = pgTable("scheduler_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  jobsCreated: integer("jobs_created").notNull().default(0),
  jobsRun: integer("jobs_run").notNull().default(0),
  chainsAdvanced: integer("chains_advanced").notNull().default(0),
  purged: integer("purged").notNull().default(0),
  ok: boolean("ok").notNull().default(true),
  detail: text("detail"),
});

export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull(),
  ref: text("ref"),
  value: integer("value").notNull().default(1),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
