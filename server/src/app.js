import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { db, createId } from "./database.js";
import { allowRoles, publicUser, requireAuth } from "./auth.js";
import { SQLiteSessionStore } from "./session-store.js";
import { findScheduleConflict } from "./schedule.js";

const app = express();
const sessionSecret = process.env.SESSION_SECRET ?? "desenvolvimento-local-chave-segura-32";
if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || sessionSecret.length < 32)) {
  throw new Error("Defina SESSION_SECRET com pelo menos 32 caracteres em produção.");
}
const paymentMethods = ["dinheiro", "pix", "cartao_credito", "cartao_debito", "transferencia"];
const statuses = ["agendado", "confirmado", "concluido", "cancelado", "faltou"];

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(session({
  name: "simplifica.sid",
  secret: sessionSecret,
  store: new SQLiteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true"
      || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false"),
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}));

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

function withinWorkingHours(tenantId, professionalId, startsAt, endsAt) {
  if (startsAt.slice(0, 10) !== endsAt.slice(0, 10)) return false;
  const weekday = new Date(`${startsAt.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const business = db.prepare(`
    SELECT opens_at AS opensAt, closes_at AS closesAt
    FROM business_hours WHERE tenant_id = ? AND weekday = ?
  `).get(tenantId, weekday);
  if (!business?.opensAt || !business.closesAt) return false;
  const professional = db.prepare(`
    SELECT opens_at AS opensAt, closes_at AS closesAt
    FROM professional_hours WHERE tenant_id = ? AND professional_id = ? AND weekday = ?
  `).get(tenantId, professionalId, weekday);
  const startTime = startsAt.slice(11, 16);
  const endTime = endsAt.slice(11, 16);
  return startTime >= business.opensAt && endTime <= business.closesAt
    && (!professional || (professional.opensAt && professional.closesAt
      && startTime >= professional.opensAt && endTime <= professional.closesAt));
}

function requiredText(value, label, maxLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw Object.assign(new Error(`${label} é obrigatório.`), { status: 400 });
  }
  return value.trim();
}

function validDateTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return false;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const normalizedDate = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  return normalizedDate === date && hour < 24 && minute < 60 && second < 60;
}

function validClockTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour < 24 && minute < 60;
}

function validMonth(value) {
  return /^\d{4}-\d{2}$/.test(value) && Number(value.slice(5, 7)) >= 1 && Number(value.slice(5, 7)) <= 12;
}

function addLocalMinutes(value, minutes) {
  const wallTime = new Date(`${value.slice(0, 19)}Z`);
  wallTime.setUTCMinutes(wallTime.getUTCMinutes() + minutes);
  return wallTime.toISOString().slice(0, 19);
}

function localNow(tenantId) {
  const timezone = db.prepare("SELECT timezone FROM business_settings WHERE tenant_id = ?").get(tenantId)?.timezone
    ?? "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function scheduleConflict(res, details) {
  const conflict = findScheduleConflict(db, details);
  if (!conflict) return false;
  fail(res, 409, conflict.type === "bloqueio"
    ? "Este horário está bloqueado."
    : "Este profissional já tem um atendimento nesse horário.");
  return true;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function sendCsv(res, filename, headers, rows) {
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${body}`);
}

function tenant(req) {
  return req.user.tenantId;
}

function appointmentRows(tenantId, where = "", params = []) {
  return db.prepare(`
    SELECT a.id, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status,
      a.price_cents AS priceCents, a.payment_method AS paymentMethod,
      a.commission_percent AS commissionPercent, a.notes,
      c.id AS clientId, c.name AS clientName, c.phone AS clientPhone,
      s.id AS serviceId, s.name AS serviceName, s.duration_minutes AS durationMinutes,
      u.id AS professionalId, u.name AS professionalName
    FROM appointments a
    JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? ${where}
    ORDER BY a.starts_at
  `).all(tenantId, ...params);
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const slug = String(req.body?.slug ?? "").trim().toLowerCase();
  if (!email || !password) return fail(res, 400, "Informe e-mail e senha.");

  const candidates = db.prepare(`
    SELECT u.*, t.slug FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE lower(u.email) = ? AND u.active = 1 AND (? = '' OR t.slug = ?)
  `).all(email, slug, slug);

  if (candidates.length > 1) return fail(res, 400, "Informe o identificador do negócio para entrar.");
  const user = candidates[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return fail(res, 401, "E-mail ou senha incorretos.");
  }

  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "Não foi possível iniciar a sessão." });
    req.session.user = publicUser(user);
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: "Não foi possível salvar a sessão." });
      res.json({ user: req.session.user });
    });
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));
app.post("/api/auth/logout", requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("simplifica.sid", { httpOnly: true, sameSite: "lax" });
    res.status(204).end();
  });
});

app.get("/api/overview", requireAuth, (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, 400, "Mês inválido.");
  const summary = db.prepare(`
    SELECT
      count(*) FILTER (WHERE substr(starts_at, 1, 10) = substr(?, 1, 10)
        AND status NOT IN ('cancelado', 'faltou')) AS today_count,
      count(DISTINCT client_id) FILTER (WHERE substr(starts_at, 1, 7) = ?
        AND status NOT IN ('cancelado', 'faltou')) AS active_clients,
      coalesce(sum(price_cents) FILTER (
        WHERE substr(starts_at, 1, 7) = ? AND status = 'concluido'), 0) AS month_revenue,
      count(*) FILTER (WHERE substr(starts_at, 1, 7) = ?
        AND status NOT IN ('cancelado', 'faltou')) AS month_count
    FROM appointments WHERE tenant_id = ?
      AND (? != 'profissional' OR professional_id = ?)
  `).get(localNow(tenant(req)), month, month, month, tenant(req), req.user.role, req.user.id);
  const upcoming = appointmentRows(tenant(req),
    `AND a.starts_at >= ? AND a.status NOT IN ('cancelado', 'faltou')
      ${req.user.role === "profissional" ? "AND a.professional_id = ?" : ""}`,
    req.user.role === "profissional" ? [localNow(tenant(req)), req.user.id] : [localNow(tenant(req))],
  ).slice(0, 6);
  res.json({
    todayCount: summary.today_count,
    activeClients: summary.active_clients,
    monthRevenueCents: req.user.role === "dono" ? summary.month_revenue : null,
    monthCount: summary.month_count,
    upcoming,
  });
});

app.get("/api/clients", requireAuth, (req, res) => {
  const search = `%${String(req.query.search ?? "").trim()}%`;
  const clients = db.prepare(`
    SELECT c.id, c.name, c.phone, c.email, c.notes, c.created_at AS createdAt,
      count(a.id) AS appointmentCount,
      max(a.starts_at) FILTER (WHERE a.status = 'concluido') AS lastVisit
    FROM clients c
    LEFT JOIN appointments a ON a.client_id = c.id AND a.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND (? = '%%' OR c.name LIKE ? OR c.phone LIKE ?)
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE
  `).all(tenant(req), search, search, search);
  res.json({ clients });
});

app.post("/api/clients", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const name = requiredText(req.body?.name, "Nome");
  const phone = String(req.body?.phone ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const notes = String(req.body?.notes ?? "").trim();
  const id = createId();
  try {
    db.prepare("INSERT INTO clients (id, tenant_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, tenant(req), name, phone, email, notes);
    res.status(201).json({ client: db.prepare("SELECT id, name, phone, email, notes FROM clients WHERE id = ?").get(id) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return fail(res, 409, "Já existe um cliente com este telefone.");
    throw error;
  }
});

app.patch("/api/clients/:id", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const existing = db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(req.params.id, tenant(req));
  if (!existing) return fail(res, 404, "Cliente não encontrado.");
  const name = requiredText(req.body?.name, "Nome");
  try {
    db.prepare("UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? AND tenant_id = ?")
      .run(name, String(req.body?.phone ?? "").trim(), String(req.body?.email ?? "").trim(),
        String(req.body?.notes ?? "").trim(), req.params.id, tenant(req));
    res.json({ client: db.prepare("SELECT id, name, phone, email, notes FROM clients WHERE id = ?").get(req.params.id) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return fail(res, 409, "Já existe um cliente com este telefone.");
    throw error;
  }
});

app.get("/api/clients/:id/history", requireAuth, (req, res) => {
  const client = db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(req.params.id, tenant(req));
  if (!client) return fail(res, 404, "Cliente não encontrado.");
  const history = appointmentRows(tenant(req),
    `AND a.client_id = ? ${req.user.role === "profissional" ? "AND a.professional_id = ?" : ""}`,
    req.user.role === "profissional" ? [req.params.id, req.user.id] : [req.params.id]).reverse();
  res.json({ history });
});

app.get("/api/services", requireAuth, (_req, res) => {
  const services = db.prepare(`
    SELECT s.id, s.name, s.duration_minutes AS durationMinutes, s.price_cents AS priceCents, s.active,
      group_concat(u.name, ', ') AS professionalNames
    FROM services s LEFT JOIN professional_services ps ON ps.service_id = s.id
      AND ps.tenant_id = s.tenant_id
    LEFT JOIN users u ON u.id = ps.professional_id AND u.tenant_id = s.tenant_id AND u.active = 1
    WHERE s.tenant_id = ? GROUP BY s.id ORDER BY s.name
  `).all(tenant(_req));
  res.json({ services });
});

app.post("/api/services", requireAuth, allowRoles("dono"), (req, res) => {
  const name = requiredText(req.body?.name, "Nome do serviço");
  const durationMinutes = Number(req.body?.durationMinutes);
  const priceCents = Number(req.body?.priceCents);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720
    || !Number.isInteger(priceCents) || priceCents < 0) {
    return fail(res, 400, "Informe uma duração e um preço válidos.");
  }
  const id = createId();
  db.prepare("INSERT INTO services (id, tenant_id, name, duration_minutes, price_cents) VALUES (?, ?, ?, ?, ?)")
    .run(id, tenant(req), name, durationMinutes, priceCents);
  const professionalIds = Array.isArray(req.body.professionalIds) ? req.body.professionalIds : [];
  const assign = db.prepare(`
    INSERT INTO professional_services (tenant_id, professional_id, service_id)
    SELECT ?, id, ? FROM users WHERE tenant_id = ? AND id = ? AND role = 'profissional'
  `);
  const transaction = db.transaction(() => professionalIds.forEach((proId) => assign.run(tenant(req), id, tenant(req), proId)));
  transaction();
  res.status(201).json({ id });
});

app.patch("/api/services/:id", requireAuth, allowRoles("dono"), (req, res) => {
  const service = db.prepare("SELECT id FROM services WHERE id = ? AND tenant_id = ?").get(req.params.id, tenant(req));
  if (!service) return fail(res, 404, "Serviço não encontrado.");
  const name = requiredText(req.body?.name, "Nome do serviço");
  const duration = Number(req.body?.durationMinutes);
  const price = Number(req.body?.priceCents);
  if (!Number.isInteger(duration) || duration < 5 || duration > 720 || !Number.isInteger(price) || price < 0) {
    return fail(res, 400, "Informe uma duração e um preço válidos.");
  }
  db.prepare("UPDATE services SET name = ?, duration_minutes = ?, price_cents = ?, active = ? WHERE id = ? AND tenant_id = ?")
    .run(name, duration, price, req.body.active === false ? 0 : 1, req.params.id, tenant(req));
  const ids = Array.isArray(req.body.professionalIds) ? req.body.professionalIds : null;
  if (ids) {
    const update = db.transaction(() => {
      db.prepare("DELETE FROM professional_services WHERE tenant_id = ? AND service_id = ?").run(tenant(req), req.params.id);
      const add = db.prepare(`
        INSERT INTO professional_services (tenant_id, professional_id, service_id)
        SELECT ?, id, ? FROM users WHERE tenant_id = ? AND id = ? AND role = 'profissional'
      `);
      ids.forEach((id) => add.run(tenant(req), req.params.id, tenant(req), id));
    });
    update();
  }
  res.json({ ok: true });
});

app.get("/api/professionals/:id/hours", requireAuth, (req, res) => {
  const professional = db.prepare(`
    SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional'
  `).get(req.params.id, tenant(req));
  if (!professional) return fail(res, 404, "Profissional não encontrado.");
  const hours = db.prepare(`
    SELECT weekday, opens_at AS opensAt, closes_at AS closesAt
    FROM professional_hours WHERE tenant_id = ? AND professional_id = ? ORDER BY weekday
  `).all(tenant(req), req.params.id);
  res.json({ hours });
});

app.put("/api/professionals/:id/hours", requireAuth, allowRoles("dono"), (req, res) => {
  const professional = db.prepare(`
    SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional'
  `).get(req.params.id, tenant(req));
  if (!professional) return fail(res, 404, "Profissional não encontrado.");
  if (!Array.isArray(req.body?.hours) || req.body.hours.length !== 7) {
    return fail(res, 400, "Informe os horários dos sete dias da semana.");
  }
  const save = db.prepare(`
    INSERT INTO professional_hours (tenant_id, professional_id, weekday, opens_at, closes_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(professional_id, weekday) DO UPDATE
      SET opens_at = excluded.opens_at, closes_at = excluded.closes_at
  `);
  const update = db.transaction(() => {
    const savedWeekdays = new Set();
    for (const hour of req.body.hours) {
      const weekday = Number(hour.weekday);
      const open = hour.opensAt || null;
      const close = hour.closesAt || null;
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6
        || savedWeekdays.has(weekday)
        || ((open === null) !== (close === null)) || (open && open >= close)
        || (open && !validClockTime(open)) || (close && !validClockTime(close))) {
        throw Object.assign(new Error("Revise os horários de atendimento."), { status: 400 });
      }
      savedWeekdays.add(weekday);
      save.run(tenant(req), req.params.id, weekday, open, close);
    }
  });
  update();
  res.json({ ok: true });
});

app.get("/api/professionals", requireAuth, (_req, res) => {
  const professionals = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.commission_percent AS commissionPercent,
      u.active, group_concat(ps.service_id, ',') AS serviceIds
    FROM users u LEFT JOIN professional_services ps ON ps.professional_id = u.id AND ps.tenant_id = u.tenant_id
    WHERE u.tenant_id = ? AND u.role = 'profissional'
    GROUP BY u.id ORDER BY u.name
  `).all(tenant(_req)).map((pro) => ({ ...pro, serviceIds: pro.serviceIds ? pro.serviceIds.split(",") : [] }));
  res.json({ professionals });
});

app.get("/api/team-members", requireAuth, allowRoles("dono"), (_req, res) => {
  const team = db.prepare(`
    SELECT id, name, email, phone, role, commission_percent AS commissionPercent, active
    FROM users WHERE tenant_id = ? AND role IN ('profissional', 'recepcao')
    ORDER BY role, name
  `).all(tenant(_req));
  res.json({ team });
});

app.post("/api/team-members", requireAuth, allowRoles("dono"), async (req, res) => {
  const name = requiredText(req.body?.name, "Nome");
  const email = requiredText(req.body?.email, "E-mail").toLowerCase();
  const password = requiredText(req.body?.password, "Senha", 200);
  const role = req.body?.role;
  if (!["profissional", "recepcao"].includes(role)) return fail(res, 400, "Perfil inválido.");
  if (password.length < 8) return fail(res, 400, "A senha deve ter pelo menos 8 caracteres.");
  const commission = role === "profissional" ? Number(req.body?.commissionPercent ?? 0) : 0;
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail(res, 400, "Comissão inválida.");
  const passwordHash = await bcrypt.hash(password, 12);
  const id = createId();
  try {
    const create = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, tenant_id, name, email, password_hash, role, phone, commission_percent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenant(req), name, email, passwordHash, role, String(req.body?.phone ?? "").trim(), commission);
      if (role === "profissional") {
        const assign = db.prepare(`
          INSERT INTO professional_services (tenant_id, professional_id, service_id)
          SELECT ?, ?, id FROM services WHERE tenant_id = ? AND id = ?
        `);
        (Array.isArray(req.body.serviceIds) ? req.body.serviceIds : [])
          .forEach((serviceId) => assign.run(tenant(req), id, tenant(req), serviceId));
        db.prepare(`
          INSERT INTO professional_hours (tenant_id, professional_id, weekday, opens_at, closes_at)
          SELECT tenant_id, ?, weekday, opens_at, closes_at FROM business_hours WHERE tenant_id = ?
        `).run(id, tenant(req));
      }
    });
    create();
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return fail(res, 409, "Já existe uma conta com este e-mail.");
    throw error;
  }
  res.status(201).json({ id });
});

app.patch("/api/team-members/:id", requireAuth, allowRoles("dono"), (req, res) => {
  const member = db.prepare(`
    SELECT id, role FROM users WHERE id = ? AND tenant_id = ? AND role IN ('profissional', 'recepcao')
  `).get(req.params.id, tenant(req));
  if (!member) return fail(res, 404, "Pessoa da equipe não encontrada.");
  const commission = member.role === "profissional" ? Number(req.body?.commissionPercent ?? 0) : 0;
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail(res, 400, "Comissão inválida.");
  db.prepare(`
    UPDATE users SET name = ?, phone = ?, commission_percent = ?, active = ?
    WHERE id = ? AND tenant_id = ?
  `).run(requiredText(req.body?.name, "Nome"), String(req.body?.phone ?? "").trim(), commission,
    req.body?.active === false ? 0 : 1, req.params.id, tenant(req));
  res.json({ ok: true });
});

app.post("/api/professionals", requireAuth, allowRoles("dono"), async (req, res) => {
  const name = requiredText(req.body?.name, "Nome");
  const email = requiredText(req.body?.email, "E-mail").toLowerCase();
  const password = requiredText(req.body?.password, "Senha", 200);
  if (password.length < 8) return fail(res, 400, "A senha deve ter pelo menos 8 caracteres.");
  const commission = Number(req.body?.commissionPercent ?? 0);
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail(res, 400, "Comissão inválida.");
  const passwordHash = await bcrypt.hash(password, 12);
  const id = createId();
  try {
    const insert = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, tenant_id, name, email, password_hash, role, phone, commission_percent)
        VALUES (?, ?, ?, ?, ?, 'profissional', ?, ?)
      `).run(id, tenant(req), name, email, passwordHash, String(req.body?.phone ?? "").trim(), commission);
      const assign = db.prepare(`
        INSERT INTO professional_services (tenant_id, professional_id, service_id)
        SELECT ?, ?, id FROM services WHERE tenant_id = ? AND id = ?
      `);
      (Array.isArray(req.body.serviceIds) ? req.body.serviceIds : [])
        .forEach((serviceId) => assign.run(tenant(req), id, tenant(req), serviceId));
      db.prepare(`
        INSERT INTO professional_hours (tenant_id, professional_id, weekday, opens_at, closes_at)
        SELECT tenant_id, ?, weekday, opens_at, closes_at FROM business_hours WHERE tenant_id = ?
      `).run(id, tenant(req));
    });
    insert();
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return fail(res, 409, "Já existe uma conta com este e-mail.");
    throw error;
  }
  res.status(201).json({ id });
});

app.patch("/api/professionals/:id", requireAuth, allowRoles("dono"), (req, res) => {
  const professional = db.prepare(`
    SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional'
  `).get(req.params.id, tenant(req));
  if (!professional) return fail(res, 404, "Profissional não encontrado.");
  const commission = Number(req.body?.commissionPercent ?? 0);
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail(res, 400, "Comissão inválida.");
  db.prepare("UPDATE users SET phone = ?, commission_percent = ?, active = ? WHERE id = ? AND tenant_id = ?")
    .run(String(req.body?.phone ?? "").trim(), commission, req.body.active === false ? 0 : 1, req.params.id, tenant(req));
  res.json({ ok: true });
});

app.get("/api/schedule", requireAuth, (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!validDateTime(from) || !validDateTime(to) || from >= to) return fail(res, 400, "Período da agenda inválido.");
  const appointmentFilter = req.user.role === "profissional" ? "AND a.professional_id = ?" : "";
  const appointments = appointmentRows(tenant(req),
    `AND a.starts_at < ? AND a.ends_at > ? ${appointmentFilter}`,
    req.user.role === "profissional" ? [to, from, req.user.id] : [to, from]);
  const blockedSlots = db.prepare(`
    SELECT id, professional_id AS professionalId, starts_at AS startsAt,
      ends_at AS endsAt, reason
    FROM blocked_slots WHERE tenant_id = ? AND starts_at < ? AND ends_at > ?
      AND (? != 'profissional' OR professional_id IS NULL OR professional_id = ?)
    ORDER BY starts_at
  `).all(tenant(req), to, from, req.user.role, req.user.id);
  res.json({ appointments, blockedSlots });
});

app.post("/api/appointments", requireAuth, allowRoles("dono", "profissional", "recepcao"), (req, res) => {
  const { clientId, professionalId, serviceId } = req.body ?? {};
  const startsAt = String(req.body?.startsAt ?? "");
  if (!validDateTime(startsAt) || !clientId || !professionalId || !serviceId) {
    return fail(res, 400, "Informe cliente, profissional, serviço e horário válidos.");
  }
  if (req.user.role === "profissional" && professionalId !== req.user.id) {
    return fail(res, 403, "Profissionais só podem agendar na própria agenda.");
  }
  const chosen = db.prepare(`
    SELECT s.duration_minutes AS duration, s.price_cents AS price,
      u.commission_percent AS commission
    FROM services s
    JOIN professional_services ps ON ps.service_id = s.id AND ps.tenant_id = s.tenant_id
    JOIN users u ON u.id = ps.professional_id AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? AND s.id = ? AND u.id = ? AND s.active = 1 AND u.active = 1
  `).get(tenant(req), serviceId, professionalId);
  const client = db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(clientId, tenant(req));
  if (!chosen || !client) return fail(res, 400, "Cliente, serviço ou profissional inválido.");
  const normalizedStart = startsAt.length === 16 ? `${startsAt}:00` : startsAt;
  if (normalizedStart <= localNow(tenant(req))) return fail(res, 400, "Escolha um horário futuro.");
  const endsAt = addLocalMinutes(normalizedStart, chosen.duration);
  if (!withinWorkingHours(tenant(req), professionalId, normalizedStart, endsAt)) {
    return fail(res, 400, "O horário está fora do expediente deste profissional.");
  }
  const id = createId();
  const create = db.transaction(() => {
    if (scheduleConflict(res, { tenantId: tenant(req), professionalId, startsAt: normalizedStart, endsAt })) return false;
    db.prepare(`
      INSERT INTO appointments
        (id, tenant_id, client_id, professional_id, service_id, starts_at, ends_at,
         price_cents, commission_percent, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenant(req), clientId, professionalId, serviceId, normalizedStart, endsAt,
      chosen.price, chosen.commission, String(req.body?.notes ?? "").trim());
    return true;
  });
  if (!create()) return;
  res.status(201).json({ id });
});

app.patch("/api/appointments/:id", requireAuth, allowRoles("dono", "profissional", "recepcao"), (req, res) => {
  const appointment = db.prepare(`
    SELECT id, professional_id AS professionalId, service_id AS serviceId,
      starts_at AS startsAt, ends_at AS endsAt, status, price_cents AS priceCents,
      payment_method AS paymentMethod, notes
    FROM appointments WHERE id = ? AND tenant_id = ?
  `).get(req.params.id, tenant(req));
  if (!appointment) return fail(res, 404, "Atendimento não encontrado.");
  if (req.user.role === "profissional" && appointment.professionalId !== req.user.id) {
    return fail(res, 403, "Este atendimento não pertence à sua agenda.");
  }
  const status = req.body?.status ?? appointment.status;
  const method = req.body?.paymentMethod === undefined ? appointment.paymentMethod : req.body.paymentMethod;
  const priceCents = req.body?.priceCents === undefined ? appointment.priceCents : Number(req.body.priceCents);
  if (!statuses.includes(status)) return fail(res, 400, "Status inválido.");
  if (method && !paymentMethods.includes(method)) return fail(res, 400, "Forma de pagamento inválida.");
  if (!Number.isInteger(priceCents) || priceCents < 0) return fail(res, 400, "Valor inválido.");

  let startsAt = appointment.startsAt;
  let endsAt = appointment.endsAt;
  if (req.body?.startsAt !== undefined) {
    if (!validDateTime(req.body.startsAt)) return fail(res, 400, "Novo horário inválido.");
    const service = db.prepare("SELECT duration_minutes FROM services WHERE id = ? AND tenant_id = ?")
      .get(appointment.serviceId, tenant(req));
    startsAt = req.body.startsAt.length === 16 ? `${req.body.startsAt}:00` : req.body.startsAt;
    endsAt = addLocalMinutes(startsAt, service.duration_minutes);
    if (startsAt <= localNow(tenant(req))) return fail(res, 400, "Escolha um horário futuro.");
    if (!withinWorkingHours(tenant(req), appointment.professionalId, startsAt, endsAt)) {
      return fail(res, 400, "O horário está fora do expediente deste profissional.");
    }
  }
  const update = db.transaction(() => {
    if (startsAt !== appointment.startsAt && scheduleConflict(res, {
      tenantId: tenant(req),
      professionalId: appointment.professionalId,
      startsAt,
      endsAt,
      excludeAppointmentId: appointment.id,
    })) return false;
    db.prepare(`
      UPDATE appointments SET starts_at = ?, ends_at = ?, status = ?,
        payment_method = ?, price_cents = ?, notes = ?
      WHERE id = ? AND tenant_id = ?
    `).run(startsAt, endsAt, status, method || (status === "concluido" ? "dinheiro" : ""),
      priceCents, req.body?.notes === undefined ? appointment.notes : String(req.body.notes),
      appointment.id, tenant(req));
    return true;
  });
  if (!update()) return;
  res.json({ ok: true });
});

app.post("/api/blocked-slots", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const startsAt = String(req.body?.startsAt ?? "");
  const endsAt = String(req.body?.endsAt ?? "");
  if (!validDateTime(startsAt) || !validDateTime(endsAt) || startsAt >= endsAt) {
    return fail(res, 400, "Informe um período de bloqueio válido.");
  }
  const professionalId = req.body?.professionalId || null;
  if (professionalId && !db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional'")
    .get(professionalId, tenant(req))) return fail(res, 400, "Profissional inválido.");
  const conflict = db.prepare(`
    SELECT id FROM appointments WHERE tenant_id = ?
      AND status NOT IN ('cancelado', 'faltou')
      AND (? IS NULL OR professional_id = ?)
      AND starts_at < ? AND ends_at > ? LIMIT 1
  `).get(tenant(req), professionalId, professionalId, endsAt, startsAt);
  if (conflict) return fail(res, 409, "Não é possível bloquear um horário com atendimento agendado.");
  const id = createId();
  db.prepare(`
    INSERT INTO blocked_slots (id, tenant_id, professional_id, starts_at, ends_at, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, tenant(req), professionalId, startsAt, endsAt, String(req.body?.reason ?? "").trim());
  res.status(201).json({ id });
});

app.delete("/api/blocked-slots/:id", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const result = db.prepare("DELETE FROM blocked_slots WHERE id = ? AND tenant_id = ?").run(req.params.id, tenant(req));
  if (!result.changes) return fail(res, 404, "Bloqueio não encontrado.");
  res.status(204).end();
});

app.get("/api/settings", requireAuth, (req, res) => {
  const settings = db.prepare("SELECT business_name AS businessName, logo_url AS logoUrl, address, phone, timezone, theme FROM business_settings WHERE tenant_id = ?")
    .get(tenant(req));
  const hours = db.prepare("SELECT weekday, opens_at AS opensAt, closes_at AS closesAt FROM business_hours WHERE tenant_id = ? ORDER BY weekday")
    .all(tenant(req));
  res.json({ settings, hours });
});

app.put("/api/settings", requireAuth, allowRoles("dono"), (req, res) => {
  const businessName = requiredText(req.body?.businessName, "Nome do negócio");
  const theme = req.body?.theme === "escuro" ? "escuro" : "claro";
  const update = db.transaction(() => {
    db.prepare(`
      UPDATE business_settings SET business_name = ?, logo_url = ?, address = ?,
        phone = ?, theme = ? WHERE tenant_id = ?
    `).run(businessName, String(req.body?.logoUrl ?? "").trim(), String(req.body?.address ?? "").trim(),
      String(req.body?.phone ?? "").trim(), theme, tenant(req));
    if (Array.isArray(req.body?.hours)) {
      const save = db.prepare(`
        INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id, weekday) DO UPDATE SET opens_at = excluded.opens_at, closes_at = excluded.closes_at
      `);
      for (const hour of req.body.hours) {
        const weekday = Number(hour.weekday);
        const open = hour.opensAt || null;
        const close = hour.closesAt || null;
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6
          || ((open === null) !== (close === null)) || (open && open >= close)
          || (open && !validClockTime(open)) || (close && !validClockTime(close))) {
          throw Object.assign(new Error("Revise os horários de funcionamento."), { status: 400 });
        }
        save.run(tenant(req), weekday, open, close);
      }
    }
  });
  update();
  res.json({ ok: true });
});

app.get("/api/reports", requireAuth, allowRoles("dono"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const revenue = db.prepare(`
    SELECT coalesce(sum(price_cents), 0) AS revenue_cents,
      count(*) AS completed_count
    FROM appointments WHERE tenant_id = ? AND substr(starts_at, 1, 7) = ? AND status = 'concluido'
  `).get(tenant(req), month);
  const byService = db.prepare(`
    SELECT s.id, s.name, count(a.id) AS count, coalesce(sum(a.price_cents), 0) AS revenueCents
    FROM appointments a JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND substr(a.starts_at, 1, 7) = ? AND a.status = 'concluido'
    GROUP BY s.id ORDER BY count DESC
  `).all(tenant(req), month);
  const byProfessional = db.prepare(`
    SELECT u.id, u.name, count(a.id) AS count,
      coalesce(sum(a.price_cents), 0) AS revenueCents,
      coalesce(sum(round(a.price_cents * a.commission_percent / 100)), 0) AS commissionCents
    FROM appointments a JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND substr(a.starts_at, 1, 7) = ? AND a.status = 'concluido'
    GROUP BY u.id ORDER BY revenueCents DESC
  `).all(tenant(req), month);
  const inactiveClients = db.prepare(`
    SELECT c.id, c.name, c.phone, max(a.starts_at) AS lastVisit
    FROM clients c JOIN appointments a ON a.client_id = c.id AND a.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND a.status = 'concluido'
    GROUP BY c.id
    HAVING date(max(a.starts_at)) <= date(?, '-30 days')
    ORDER BY lastVisit
  `).all(tenant(req), localNow(tenant(req)).slice(0, 10));
  res.json({ month, revenueCents: revenue.revenue_cents, completedCount: revenue.completed_count,
    byService, byProfessional, inactiveClients });
});

app.get("/api/export/clients.csv", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const clients = db.prepare("SELECT name, phone, email, notes, created_at FROM clients WHERE tenant_id = ? ORDER BY name")
    .all(tenant(req));
  sendCsv(res, "clientes.csv", ["Nome", "Telefone", "E-mail", "Observações", "Cadastro"], clients.map((c) =>
    [c.name, c.phone, c.email, c.notes, c.created_at]));
});

app.get("/api/export/appointments.csv", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const rows = appointmentRows(tenant(req));
  sendCsv(res, "atendimentos.csv",
    ["Data e hora", "Cliente", "Telefone", "Serviço", "Profissional", "Status", "Valor (centavos)", "Pagamento"],
    rows.map((a) => [a.startsAt, a.clientName, a.clientPhone, a.serviceName, a.professionalName,
      a.status, a.priceCents, a.paymentMethod]));
});

app.get("/api/export/backup", requireAuth, allowRoles("dono"), async (_req, res, next) => {
  const backupPath = path.join(os.tmpdir(), `simplifica-agenda-${crypto.randomUUID()}.sqlite`);
  try {
    await db.backup(backupPath);
    res.download(backupPath, "simplifica-agenda-backup.sqlite", (error) => {
      fs.rm(backupPath, { force: true }, (cleanupError) => {
        if (cleanupError) console.error("Falha ao remover arquivo temporário de backup:", cleanupError);
      });
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    fs.rm(backupPath, { force: true }, () => {});
    next(error);
  }
});

app.get("/api/public/:slug", (req, res) => {
  const business = db.prepare(`
    SELECT t.id AS tenantId, t.slug, b.business_name AS businessName, b.logo_url AS logoUrl,
      b.phone, b.address
    FROM tenants t JOIN business_settings b ON b.tenant_id = t.id WHERE t.slug = ?
  `).get(req.params.slug);
  if (!business) return fail(res, 404, "Negócio não encontrado.");
  const services = db.prepare(`
    SELECT id, name, duration_minutes AS durationMinutes, price_cents AS priceCents
    FROM services WHERE tenant_id = ? AND active = 1 ORDER BY name
  `).all(business.tenantId);
  const professionals = db.prepare(`
    SELECT u.id, u.name, group_concat(ps.service_id, ',') AS service_ids
    FROM users u JOIN professional_services ps ON ps.professional_id = u.id AND ps.tenant_id = u.tenant_id
    WHERE u.tenant_id = ? AND u.role = 'profissional' AND u.active = 1
    GROUP BY u.id ORDER BY u.name
  `).all(business.tenantId).map((pro) => ({ id: pro.id, name: pro.name, serviceIds: pro.service_ids.split(",") }));
  res.json({ business, services, professionals });
});

app.get("/api/public/:slug/slots", (req, res) => {
  const { serviceId, professionalId, date } = req.query;
  if (!serviceId || !professionalId || typeof date !== "string" || !validDateTime(`${date}T00:00`)) {
    return fail(res, 400, "Informe serviço, profissional e data válidos.");
  }
  const business = db.prepare(`
    SELECT t.id AS tenantId FROM tenants t WHERE t.slug = ?
  `).get(req.params.slug);
  if (!business) return fail(res, 404, "Negócio não encontrado.");
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const selected = db.prepare(`
    SELECT s.duration_minutes AS duration,
      ph.opens_at AS professionalOpens, ph.closes_at AS professionalCloses,
      ph.professional_id AS hasProfessionalSchedule,
      bh.opens_at AS businessOpens, bh.closes_at AS businessCloses
    FROM services s
    JOIN professional_services ps ON ps.service_id = s.id AND ps.tenant_id = s.tenant_id
    JOIN users u ON u.id = ps.professional_id AND u.tenant_id = s.tenant_id
    LEFT JOIN professional_hours ph ON ph.professional_id = u.id AND ph.weekday = ?
    LEFT JOIN business_hours bh ON bh.tenant_id = s.tenant_id AND bh.weekday = ?
    WHERE s.tenant_id = ? AND s.id = ? AND u.id = ? AND s.active = 1 AND u.active = 1
  `).get(weekday, weekday, business.tenantId, serviceId, professionalId);
  if (!selected) return fail(res, 400, "Serviço ou profissional inválido.");
  if (!selected.businessOpens || !selected.businessCloses) return res.json({ slots: [] });
  if (selected.hasProfessionalSchedule
    && (!selected.professionalOpens || !selected.professionalCloses)) return res.json({ slots: [] });
  const opens = selected.hasProfessionalSchedule
    ? (selected.professionalOpens > selected.businessOpens ? selected.professionalOpens : selected.businessOpens)
    : selected.businessOpens;
  const closes = selected.hasProfessionalSchedule
    ? (selected.professionalCloses < selected.businessCloses ? selected.professionalCloses : selected.businessCloses)
    : selected.businessCloses;
  if (!opens || !closes) return res.json({ slots: [] });
  const slots = [];
  const startMinute = Number(opens.slice(0, 2)) * 60 + Number(opens.slice(3, 5));
  const closeMinute = Number(closes.slice(0, 2)) * 60 + Number(closes.slice(3, 5));
  const nowLocal = localNow(business.tenantId).slice(0, 16);
  for (let minute = startMinute; minute + selected.duration <= closeMinute; minute += 30) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const startsAt = `${date}T${time}:00`;
    const endsAt = addLocalMinutes(startsAt, selected.duration);
    if (`${date}T${time}` <= nowLocal) continue;
    if (!findScheduleConflict(db, { tenantId: business.tenantId, professionalId, startsAt, endsAt })) slots.push(time);
  }
  res.json({ slots });
});

app.post("/api/public/:slug/appointments", (req, res) => {
  const business = db.prepare("SELECT id, timezone FROM tenants JOIN business_settings ON business_settings.tenant_id = tenants.id WHERE slug = ?").get(req.params.slug);
  if (!business) return fail(res, 404, "Negócio não encontrado.");
  const name = requiredText(req.body?.name, "Nome");
  const phone = requiredText(req.body?.phone, "Telefone");
  const { serviceId, professionalId } = req.body ?? {};
  const startsAt = String(req.body?.startsAt ?? "");
  if (!validDateTime(startsAt) || !serviceId || !professionalId) return fail(res, 400, "Escolha serviço, profissional e horário.");
  const selected = db.prepare(`
    SELECT s.duration_minutes AS duration, s.price_cents AS price, u.commission_percent AS commission
    FROM services s JOIN professional_services ps ON ps.service_id = s.id AND ps.tenant_id = s.tenant_id
    JOIN users u ON u.id = ps.professional_id AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? AND s.id = ? AND u.id = ? AND s.active = 1 AND u.active = 1
  `).get(business.id, serviceId, professionalId);
  if (!selected) return fail(res, 400, "Serviço ou profissional inválido.");
  const normalizedStart = startsAt.length === 16 ? `${startsAt}:00` : startsAt;
  if (normalizedStart <= localNow(business.id)) return fail(res, 400, "Escolha um horário futuro.");
  const endsAt = addLocalMinutes(normalizedStart, selected.duration);
  if (!withinWorkingHours(business.id, professionalId, normalizedStart, endsAt)) {
    return fail(res, 400, "O horário está fora do expediente deste profissional.");
  }
  const id = createId();
  const create = db.transaction(() => {
    if (scheduleConflict(res, {
      tenantId: business.id, professionalId, startsAt: normalizedStart, endsAt,
    })) return false;
    let client = db.prepare("SELECT id FROM clients WHERE tenant_id = ? AND phone = ?")
      .get(business.id, phone);
    if (!client) {
      const clientId = createId();
      db.prepare("INSERT INTO clients (id, tenant_id, name, phone) VALUES (?, ?, ?, ?)")
        .run(clientId, business.id, name, phone);
      client = { id: clientId };
    }
    db.prepare(`
      INSERT INTO appointments
        (id, tenant_id, client_id, professional_id, service_id, starts_at, ends_at, price_cents, commission_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, business.id, client.id, professionalId, serviceId, normalizedStart, endsAt,
      selected.price, selected.commission);
    return true;
  });
  if (!create()) return;
  res.status(201).json({ id, message: "Seu horário foi solicitado. O negócio poderá confirmar pelo WhatsApp." });
});

const webDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (fs.existsSync(path.join(webDirectory, "index.html"))) {
  app.use(express.static(webDirectory));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDirectory, "index.html")));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(error.status ?? 500).json({
    error: error.status ? error.message : "Ocorreu um erro interno. Tente novamente.",
  });
});

export default app;
