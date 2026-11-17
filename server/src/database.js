import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const configuredPath = process.env.DATABASE_PATH ?? "./data/simplifica-agenda.sqlite";
const databasePath = path.resolve(process.cwd(), configuredPath);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('dono', 'profissional', 'recepcao')),
    phone TEXT NOT NULL DEFAULT '',
    commission_percent REAL NOT NULL DEFAULT 0 CHECK (commission_percent BETWEEN 0 AND 100),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, email)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(tenant_id, lower(email));
  CREATE TABLE IF NOT EXISTS business_logos (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    image_type TEXT NOT NULL,
    image_blob BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS business_settings (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    logo_url TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    theme TEXT NOT NULL DEFAULT 'claro' CHECK (theme IN ('claro', 'escuro'))
  );
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS clients_search_idx ON clients(tenant_id, name, phone);
  CREATE UNIQUE INDEX IF NOT EXISTS clients_phone_idx
    ON clients(tenant_id, phone) WHERE phone != '';
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS professional_services (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (professional_id, service_id)
  );
  CREATE TABLE IF NOT EXISTS business_hours (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    opens_at TEXT,
    closes_at TEXT,
    PRIMARY KEY (tenant_id, weekday),
    CHECK ((opens_at IS NULL AND closes_at IS NULL) OR (opens_at < closes_at))
  );
  CREATE TABLE IF NOT EXISTS professional_hours (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    opens_at TEXT,
    closes_at TEXT,
    PRIMARY KEY (professional_id, weekday),
    CHECK ((opens_at IS NULL AND closes_at IS NULL) OR (opens_at < closes_at))
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES clients(id),
    professional_id TEXT NOT NULL REFERENCES users(id),
    service_id TEXT NOT NULL REFERENCES services(id),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'agendado'
      CHECK (status IN ('agendado', 'confirmado', 'concluido', 'cancelado', 'faltou')),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    payment_method TEXT NOT NULL DEFAULT '',
    commission_percent REAL NOT NULL DEFAULT 0 CHECK (commission_percent BETWEEN 0 AND 100),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (starts_at < ends_at)
  );
  CREATE INDEX IF NOT EXISTS appointments_schedule_idx
    ON appointments(tenant_id, professional_id, starts_at, ends_at, status);
  CREATE INDEX IF NOT EXISTS appointments_client_idx ON appointments(tenant_id, client_id, starts_at);
  CREATE TABLE IF NOT EXISTS blocked_slots (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    CHECK (starts_at < ends_at)
  );
  CREATE TABLE IF NOT EXISTS commission_payments (
    appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_id TEXT NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    paid_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS commission_payments_professional_idx
    ON commission_payments(tenant_id, professional_id);
  CREATE TABLE IF NOT EXISTS support_employees (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS commission_adjustments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    changed_by TEXT NOT NULL REFERENCES users(id),
    old_percent REAL NOT NULL,
    new_percent REAL NOT NULL,
    old_house_percent REAL NOT NULL,
    new_house_percent REAL NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
`);


/* Additive migration: preserve existing staff, logins, schedules and services. */
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(column => column.name);
if (!userColumns.includes("staff_code")) db.exec("ALTER TABLE users ADD COLUMN staff_code TEXT");
if (!userColumns.includes("activation_hash")) db.exec("ALTER TABLE users ADD COLUMN activation_hash TEXT");
if (!userColumns.includes("activation_expires_at")) db.exec("ALTER TABLE users ADD COLUMN activation_expires_at INTEGER");
// Additive migrations: neither recreate user accounts nor rewrite paid appointments.
function ensureColumn(table, name, declaration) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
}
ensureColumn("business_settings", "whatsapp", "TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "job_title", "TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "login_code", "TEXT");
ensureColumn("services", "house_share_percent", "REAL NOT NULL DEFAULT 0 CHECK (house_share_percent BETWEEN 0 AND 100)");
ensureColumn("services", "commission_mode", "TEXT NOT NULL DEFAULT 'professional'");
ensureColumn("services", "service_commission_percent", "REAL NOT NULL DEFAULT 0");
ensureColumn("appointments", "house_share_percent", "REAL NOT NULL DEFAULT 0 CHECK (house_share_percent BETWEEN 0 AND 100)");
ensureColumn("blocked_slots", "created_by_user_id", "TEXT");
ensureColumn("business_settings", "booking_min_notice_minutes", "INTEGER NOT NULL DEFAULT 60");
ensureColumn("business_settings", "booking_max_days", "INTEGER NOT NULL DEFAULT 60");
ensureColumn("business_settings", "booking_slot_interval_minutes", "INTEGER NOT NULL DEFAULT 30");
ensureColumn("business_settings", "booking_cancellation_hours", "INTEGER NOT NULL DEFAULT 12");
ensureColumn("business_settings", "booking_allow_cancellation", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("services", "public_enabled", "INTEGER NOT NULL DEFAULT 1");
// Per-professional overrides do not change already scheduled or settled services.
db.exec(`
  CREATE TABLE IF NOT EXISTS professional_service_commissions (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    commission_percent REAL NOT NULL CHECK (commission_percent BETWEEN 0 AND 100),
    house_share_percent REAL NOT NULL DEFAULT 0 CHECK (house_share_percent BETWEEN 0 AND 100),
    PRIMARY KEY (tenant_id, professional_id, service_id)
  );
  CREATE TABLE IF NOT EXISTS payout_batches (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    professional_id TEXT NOT NULL REFERENCES users(id),
    period TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    paid_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS saas_admins (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'comercial',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    notes TEXT NOT NULL DEFAULT '',
    due_date TEXT
  );
  CREATE TABLE IF NOT EXISTS whatsapp_notifications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    opened_at TEXT,
    opened_by TEXT REFERENCES users(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_notification_event_idx
    ON whatsapp_notifications(tenant_id, appointment_id, status);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS appointment_audit (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS appointment_audit_tenant_time_idx
    ON appointment_audit(tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS appointment_audit_appointment_idx
    ON appointment_audit(tenant_id, appointment_id, created_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_cash_closings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cash_date TEXT NOT NULL,
    closed_by TEXT NOT NULL REFERENCES users(id),
    closed_by_name TEXT NOT NULL,
    expected_total_cents INTEGER NOT NULL CHECK (expected_total_cents >= 0),
    expected_cash_cents INTEGER NOT NULL CHECK (expected_cash_cents >= 0),
    counted_cash_cents INTEGER NOT NULL CHECK (counted_cash_cents >= 0),
    difference_cents INTEGER NOT NULL,
    method_totals_json TEXT NOT NULL,
    receipt_count INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    closed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (tenant_id, cash_date)
  );
  CREATE INDEX IF NOT EXISTS daily_cash_closings_history_idx
    ON daily_cash_closings(tenant_id, cash_date DESC);
`);
ensureColumn("appointments", "paid_on", "TEXT");
ensureColumn("appointments", "paid_at", "TEXT");

// Preserve old "paid" records without assuming a transfer actually happened.
// Legacy rows become unverified; only explicitly confirmed transfers reduce salary balances.
const wasConfirmed = db.prepare("PRAGMA table_info(commission_payments)").all().some(col => col.name === "transfer_confirmed");
ensureColumn("commission_payments", "transfer_confirmed", "INTEGER NOT NULL DEFAULT 1");
if (!wasConfirmed) db.exec("UPDATE commission_payments SET transfer_confirmed = 0");
ensureColumn("appointments", "completed_on", "TEXT");
ensureColumn("appointments", "payment_reconciled_by", "TEXT");

function businessDateFromTimestamp(timestamp, timezone) {
  const parsed = new Date(timestamp.endsWith("Z") ? timestamp : timestamp.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}
// Recover exact historic receipt/completion dates only from traceable audit events.
// If the source has no timestamp, leave the record pending manual reconciliation.
db.transaction(() => {
  const rows = db.prepare(`SELECT a.id, a.tenant_id AS tenantId, a.payment_method AS method,
      a.paid_on AS paidOn, a.completed_on AS completedOn, a.status,
      b.timezone
    FROM appointments a JOIN business_settings b ON b.tenant_id = a.tenant_id
    WHERE (a.payment_method != '' AND a.paid_on IS NULL)
       OR (a.status = 'concluido' AND a.completed_on IS NULL)`).all();
  const events = db.prepare(`SELECT action, created_at AS createdAt, after_json AS afterJson
    FROM appointment_audit WHERE tenant_id = ? AND appointment_id = ?
    ORDER BY created_at ASC, rowid ASC`);
  const pay = db.prepare("UPDATE appointments SET paid_on = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ? AND tenant_id = ?");
  const complete = db.prepare("UPDATE appointments SET completed_on = ? WHERE id = ? AND tenant_id = ?");
  for (const row of rows) {
    const history = events.all(row.tenantId, row.id);
    if (row.method && !row.paidOn) {
      const event = history.find(event => event.action === "pagamento" && (() => {
        try { return Boolean(JSON.parse(event.afterJson || "{}").paymentMethod); } catch { return false; }
      })());
      if (event) {
        const date = businessDateFromTimestamp(event.createdAt, row.timezone);
        if (date) pay.run(date, event.createdAt, row.id, row.tenantId);
      }
    }
    if (row.status === "concluido" && !row.completedOn) {
      const event = history.find(event => {
        try { return JSON.parse(event.afterJson || "{}").status === "concluido"
          && (event.action === "conclusao" || event.action === "status"); }
        catch { return false; }
      });
      if (event) {
        const date = businessDateFromTimestamp(event.createdAt, row.timezone);
        if (date) complete.run(date, row.id, row.tenantId);
      }
    }
  }
})();
ensureColumn("appointments", "booking_source", "TEXT NOT NULL DEFAULT 'internal'");
ensureColumn("commission_payments", "batch_id", "TEXT");
ensureColumn("whatsapp_notifications", "delivery_state", "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn("appointments", "management_token_hash", "TEXT");
ensureColumn("appointments", "whatsapp_opt_in", "INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS appointment_management_token_idx ON appointments(management_token_hash) WHERE management_token_hash IS NOT NULL");

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS global_staff_login_code_idx ON users(login_code) WHERE login_code IS NOT NULL");
db.transaction(() => {
  const members = db.prepare(`SELECT id, staff_code FROM users WHERE role = 'profissional'
    AND login_code IS NULL ORDER BY created_at, tenant_id, id`).all();
  const getMax = db.prepare("SELECT COALESCE(MAX(CAST(login_code AS INTEGER)), 0) AS n FROM users");
  const assign = db.prepare("UPDATE users SET login_code = ? WHERE id = ?");
  for (const member of members) {
    const next = getMax.get().n + 1;
    if (next > 999) throw new Error("Limite de 999 acessos de profissionais por instalação.");
    assign.run(String(next).padStart(3, "0"), member.id);
  }
})();

export function allocateLoginCode() {
  const n = db.prepare("SELECT COALESCE(MAX(CAST(login_code AS INTEGER)), 0) AS n FROM users").get().n + 1;
  if (n > 999) throw new Error("Limite de 999 acessos de profissionais por instalação.");
  return String(n).padStart(3, "0");
}

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS staff_code_by_tenant_idx
  ON users(tenant_id, staff_code) WHERE staff_code IS NOT NULL`);
db.transaction(() => {
  const existing = db.prepare(`SELECT id, tenant_id FROM users
    WHERE role = 'profissional' ORDER BY tenant_id, created_at, id`).all();
  const getMax = db.prepare(`SELECT COALESCE(MAX(CAST(staff_code AS INTEGER)), 0) AS max_code
    FROM users WHERE tenant_id = ? AND role = 'profissional'`);
  const assign = db.prepare("UPDATE users SET staff_code = ? WHERE id = ? AND staff_code IS NULL");
  for (const member of existing) {
    const next = getMax.get(member.tenant_id).max_code + 1;
    if (next > 999) throw new Error("Limite de 999 profissionais por comércio excedido.");
    assign.run(String(next).padStart(3, "0"), member.id);
  }
})();

export function allocateStaffCode(tenantId) {
  const max = db.prepare(`SELECT COALESCE(MAX(CAST(staff_code AS INTEGER)), 0) AS max_code
    FROM users WHERE tenant_id = ? AND role = 'profissional'`).get(tenantId).max_code;
  if (max >= 999) throw new Error("Limite de 999 profissionais por comércio excedido.");
  return String(max + 1).padStart(3, "0");
}

export const createId = () => randomUUID();
