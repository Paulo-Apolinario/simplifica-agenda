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
