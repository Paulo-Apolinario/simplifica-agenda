import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { db, createId, allocateStaffCode, allocateLoginCode } from "./database.js";
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

// Lightweight per-process protection for login and the installation endpoint.
// Production clusters should additionally rate-limit at the reverse proxy.
const accessAttempts = new Map();
function limitAttempts(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + ":" + req.ip;
    const now = Date.now();
    if (accessAttempts.size > 5000) {
      for (const [entryKey, entry] of accessAttempts) {
        if (entry.resetAt <= now) accessAttempts.delete(entryKey);
      }
      if (accessAttempts.size > 5000) accessAttempts.clear();
    }
    const record = accessAttempts.get(key);
    if (!record || record.resetAt <= now) {
      accessAttempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (record.count >= max) {
      res.setHeader("Retry-After", String(Math.ceil((record.resetAt - now) / 1000)));
      return fail(res, 429, "Muitas tentativas. Tente novamente mais tarde.");
    }
    record.count += 1;
    next();
  };
}

// Reject cross-origin browser writes. No external service needs to call these endpoints.
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("Origin");
  if (!origin) return next();
  const forwardedHost = req.get("X-Forwarded-Host");
  const expectedHost = req.get("Host");
  const allowedHosts = [expectedHost, forwardedHost].filter(Boolean);
  let url;
  try { url = new URL(origin); } catch { return fail(res, 403, "Origem inválida."); }
  if (!["http:", "https:"].includes(url.protocol) || !allowedHosts.includes(url.host)) {
    return fail(res, 403, "Origem não autorizada.");
  }
  next();
});

// The demonstration tenant is strictly read-only; presentation data stays intact.
const DEMO_TENANT_ID = "tenant-salao-demo";
const isDemoTenant = (tenantId) => tenantId === DEMO_TENANT_ID;
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.startsWith("/auth/") || req.path.startsWith("/installation/")) return next();
  if (req.session?.user && isDemoTenant(req.session.user.tenantId)) {
    return fail(res, 403, "A demonstração é somente leitura. Entre com uma conta comercial para salvar alterações.");
  }
  next();
});

// Installation is only possible while the database has no businesses.
const demoEnabled = process.env.DEMO_MODE === "true"
  || (process.env.NODE_ENV !== "production" && process.env.DEMO_MODE !== "false");
app.get("/api/installation/status", (_req, res) => {
  const configured = Boolean(db.prepare("SELECT 1 FROM tenants LIMIT 1").get());
  res.setHeader("Cache-Control", "no-store");
  res.json({ needsSetup: !configured, demoEnabled });
});

app.post("/api/installation/setup", limitAttempts("setup", 8, 15 * 60 * 1000), async (req, res) => {
  if (db.prepare("SELECT 1 FROM tenants LIMIT 1").get()) {
    return fail(res, 409, "A instalação já foi configurada.");
  }
  const expectedToken = process.env.INSTALL_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    return fail(res, 503, "Configure INSTALL_TOKEN com pelo menos 32 caracteres no servidor.");
  }
  const token = String(req.body?.installToken ?? "");
  const expected = Buffer.from(expectedToken);
  const submitted = Buffer.from(token);
  if (expected.length !== submitted.length || !crypto.timingSafeEqual(expected, submitted)) {
    return fail(res, 403, "Código de instalação inválido.");
  }
  const businessName = requiredText(req.body?.businessName, "Nome do comércio", 120);
  const ownerName = requiredText(req.body?.ownerName, "Nome do responsável", 120);
  const ownerEmail = requiredText(req.body?.ownerEmail, "E-mail", 200).toLowerCase();
  const password = String(req.body?.password ?? "");
  const slug = String(req.body?.slug ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    return fail(res, 400, "Identificador inválido. Use letras minúsculas, números e hífens.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return fail(res, 400, "E-mail inválido.");
  if (password.length < 12 || password.length > 200) {
    return fail(res, 400, "Use uma senha de 12 a 200 caracteres.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const businessId = createId();
  const ownerId = createId();
  const days = [
    [0, null, null], [1, "09:00", "18:00"], [2, "09:00", "18:00"],
    [3, "09:00", "18:00"], [4, "09:00", "18:00"], [5, "09:00", "18:00"],
    [6, "09:00", "13:00"],
  ];
  try {
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM tenants LIMIT 1").get()) throw new Error("already-configured");
      db.prepare("INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)").run(businessId, businessName, slug);
      db.prepare("INSERT INTO business_settings (tenant_id, business_name) VALUES (?, ?)").run(businessId, businessName);
      db.prepare("INSERT INTO users (id, tenant_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'dono')")
        .run(ownerId, businessId, ownerName, ownerEmail, passwordHash);
      const insertHour = db.prepare("INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)");
      days.forEach(([day, opens, closes]) => insertHour.run(businessId, day, opens, closes));
    })();
  } catch (error) {
    if (error.message === "already-configured") return fail(res, 409, "Instalação já configurada.");
    throw error;
  }
  res.status(201).json({ ok: true, slug });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const staffPasswordValid = (password) =>
  typeof password === "string" && /^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{6,8}$/.test(password);
function generateActivation() {
  const token = crypto.randomBytes(24).toString("base64url");
  return { token, hash: crypto.createHash("sha256").update(token).digest("hex"), expires: Date.now() + 24 * 60 * 60 * 1000 };
}
const codeFailures = new Map();
function staffLoginLimit(req, res, next) {
  const slug = String(req.body?.slug ?? "").trim().toLowerCase();
  const code = String(req.body?.staffCode ?? "").trim();
  const key = code;
  const now = Date.now();
  if (codeFailures.size > 4000) {
    for (const [k, v] of codeFailures) if (v.until <= now) codeFailures.delete(k);
  }
  const entry = codeFailures.get(key);
  if (entry && entry.until > now && entry.count >= 5) {
    res.setHeader("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
    return fail(res, 429, "Acesso temporariamente bloqueado. Aguarde 15 minutos.");
  }
  req.staffLoginKey = key;
  next();
}
function recordStaffFailure(req) {
  const now = Date.now(), key = req.staffLoginKey;
  const item = codeFailures.get(key);
  if (!item || item.until <= now) codeFailures.set(key, { count: 1, until: now + 15 * 60 * 1000 });
  else item.count += 1;
}
app.post("/api/auth/staff-login", limitAttempts("staff-ip", 20, 15 * 60 * 1000), staffLoginLimit, async (req, res) => {
  const slug = String(req.body?.slug ?? "").trim().toLowerCase();
  const code = String(req.body?.staffCode ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!/^\d{3}$/.test(code) || !password) return fail(res, 400, "Informe código de três dígitos e senha.");
  const user = db.prepare(`SELECT u.*, t.slug FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE u.login_code = ? AND u.role = 'profissional' AND u.active = 1`).get(code);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    recordStaffFailure(req);
    return fail(res, 401, "Código ou senha incorretos.");
  }
  codeFailures.delete(req.staffLoginKey);
  req.session.regenerate(error => {
    if (error) return fail(res, 500, "Não foi possível iniciar a sessão.");
    req.session.user = publicUser(user);
    req.session.save(saveError => saveError ? fail(res, 500, "Erro ao salvar sessão.") : res.json({ user: req.session.user }));
  });
});
app.post("/api/auth/activate-professional", limitAttempts("staff-activate", 8, 15 * 60 * 1000), (req, res) => {
  const slug = String(req.body?.slug ?? "").trim().toLowerCase();
  const staffCode = String(req.body?.staffCode ?? "").trim();
  const token = String(req.body?.activationToken ?? "");
  const password = String(req.body?.password ?? "");
  if (!/^\d{3}$/.test(staffCode) || !token) return fail(res, 400, "Informe código e código de ativação.");
  if (!staffPasswordValid(password)) return fail(res, 400, "A senha deve ter 6 a 8 caracteres, com letras e números.");
  const member = db.prepare(`SELECT u.* FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE u.login_code = ? AND u.role = 'profissional' AND u.active = 1`).get(staffCode);
  if (!member || !member.activation_hash || !member.activation_expires_at || member.activation_expires_at < Date.now()) {
    return fail(res, 403, "Ativação inválida ou expirada. Solicite um novo código ao administrador.");
  }
  const givenHash = crypto.createHash("sha256").update(token).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(givenHash), Buffer.from(member.activation_hash))) {
    return fail(res, 403, "Ativação inválida ou expirada.");
  }
  bcrypt.hash(password, 12).then(hash => {
    const result = db.prepare(`UPDATE users SET password_hash = ?, activation_hash = NULL,
      activation_expires_at = NULL WHERE id = ? AND tenant_id = ? AND activation_hash = ?`)
      .run(hash, member.id, member.tenant_id, givenHash);
    if (!result.changes) return fail(res, 409, "Ativação já utilizada.");
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?").run(member.id, member.tenant_id);
    res.json({ ok: true });
  }).catch(() => fail(res, 500, "Não foi possível definir a senha."));
});
app.post("/api/auth/login", limitAttempts("login", 15, 15 * 60 * 1000), async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const slug = String(req.body?.slug ?? "").trim().toLowerCase();
  if (!email || !password) return fail(res, 400, "Informe e-mail e senha.");

  const candidates = db.prepare(`
    SELECT u.*, t.slug FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE lower(u.email) = ? AND u.role != 'profissional' AND u.active = 1 AND (? = '' OR t.slug = ?)
  `).all(email, slug, slug);

  if (candidates.length > 1) return fail(res, 400, "Informe o identificador do negócio para entrar.");
  const user = candidates[0];
  if (!user || user.role === "profissional" || !(await bcrypt.compare(password, user.password_hash))) {
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

app.get("/api/account", requireAuth, (req, res) => {
  const account = db.prepare(`
    SELECT name, email, phone, role, staff_code AS staffCode FROM users WHERE id = ? AND tenant_id = ?
  `).get(req.user.id, req.user.tenantId);
  res.setHeader("Cache-Control", "no-store");
  res.json({ account });
});

app.patch("/api/account", requireAuth, async (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND tenant_id = ? AND active = 1`)
    .get(req.user.id, req.user.tenantId);
  const currentPassword = String(req.body?.currentPassword ?? "");
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return fail(res, 403, "Senha atual incorreta.");
  }
  const name = requiredText(req.body?.name ?? user.name, "Nome", 120);
  const phone = String(req.body?.phone ?? user.phone).trim();
  if (phone.length > 40) return fail(res, 400, "Telefone inválido.");
  const newPassword = String(req.body?.newPassword ?? "");
  if (user.role === "profissional" && newPassword && !staffPasswordValid(newPassword)) return fail(res, 400, "A senha deve ter 6 a 8 caracteres, com letras e números.");
  if (user.role !== "profissional" && newPassword && (newPassword.length < 12 || newPassword.length > 200)) {
    return fail(res, 400, "A nova senha deve ter entre 12 e 200 caracteres.");
  }
  if (newPassword && newPassword === currentPassword) {
    return fail(res, 400, "A nova senha precisa ser diferente da atual.");
  }
  const hash = newPassword ? await bcrypt.hash(newPassword, 12) : null;
  db.transaction(() => {
    db.prepare(`UPDATE users SET name = ?, phone = ?, password_hash = COALESCE(?, password_hash)
      WHERE id = ? AND tenant_id = ?`).run(name, phone, hash, user.id, user.tenant_id);
    if (hash) db.prepare("DELETE FROM sessions WHERE user_id = ? AND tenant_id = ? AND sid != ?")
      .run(user.id, user.tenant_id, req.sessionID);
  })();
  const nextUser = { ...req.user, name, phone };
  req.session.user = nextUser;
  req.session.save((error) => {
    if (error) return res.status(500).json({ error: "Não foi possível salvar a sessão." });
    res.json({ user: nextUser });
  });
});

app.post("/api/team-members/:id/reset-password", requireAuth, allowRoles("dono"), async (req, res) => {
  const member = db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role IN ('profissional', 'recepcao')")
    .get(req.params.id, tenant(req));
  if (!member) return fail(res, 404, "Pessoa da equipe não encontrada.");
  const password = String(req.body?.password ?? "");
  if (member.role === "profissional" ? !staffPasswordValid(password) : password.length < 12 || password.length > 200) {
    return fail(res, 400, member.role === "profissional" ? "Use 6 a 8 caracteres, com letras e números." : "A senha deve ter entre 12 e 200 caracteres.");
  }
  const hash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?")
      .run(hash, member.id, tenant(req));
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?").run(member.id, tenant(req));
  })();
  res.json({ ok: true });
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
  const blockedToday = req.user.role === "profissional"
    ? db.prepare(`SELECT count(*) AS total FROM blocked_slots
      WHERE tenant_id = ? AND professional_id = ? AND starts_at < ? AND ends_at > ?`)
      .get(tenant(req), req.user.id, `${localNow(tenant(req)).slice(0, 10)}T23:59:59`, `${localNow(tenant(req)).slice(0, 10)}T00:00:00`).total
    : null;
  const earnings = req.user.role === "profissional" ? professionalEarnings(tenant(req), req.user.id) : null;
  const completedToday = req.user.role === "profissional" ? db.prepare(`SELECT count(*) AS total FROM appointments WHERE tenant_id = ? AND professional_id = ? AND status = 'concluido' AND substr(starts_at, 1, 10) = ?`).get(tenant(req), req.user.id, localNow(tenant(req)).slice(0, 10)).total : null;
  res.json({
    completedToday,
    blockedToday,
    earningsDueCents: earnings?.dueCents ?? null,
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
    WHERE c.tenant_id = ? AND c.notes != '__internal_anonymous__' AND (? = '%%' OR c.name LIKE ? OR c.phone LIKE ?)
      AND (? != 'profissional' OR EXISTS (
        SELECT 1 FROM appointments own
        WHERE own.tenant_id = c.tenant_id AND own.client_id = c.id AND own.professional_id = ?
      ))
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE
  `).all(tenant(req), search, search, search, req.user.role, req.user.id);
  res.json({ clients });
});

// Shared booking directory: minimal data available to the staff of this business.
// Full notes, e-mail and unrelated appointment history remain protected.
app.get("/api/booking/clients", requireAuth, (req, res) => {
  const search = String(req.query.search ?? "").trim().slice(0, 100);
  const pattern = `%${search}%`;
  const clients = db.prepare(`
    SELECT id, name, phone FROM clients
    WHERE tenant_id = ? AND notes != '__internal_anonymous__'
      AND (name LIKE ? OR phone LIKE ?)
    ORDER BY name COLLATE NOCASE LIMIT 200
  `).all(tenant(req), pattern, pattern);
  res.setHeader("Cache-Control", "no-store");
  res.json({ clients });
});

// A professional may register a client contacted directly, but cannot edit
// existing client records or see private notes and unrelated appointment history.
app.post("/api/booking/clients", requireAuth, allowRoles("profissional"), (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const phone = String(req.body?.phone ?? "").trim();
  if (!name || name.length > 120) return fail(res, 400, "Informe o nome do cliente (até 120 caracteres).");
  if (phone.length > 40) return fail(res, 400, "Telefone inválido.");
  const id = createId();
  try {
    db.prepare("INSERT INTO clients (id, tenant_id, name, phone) VALUES (?, ?, ?, ?)")
      .run(id, tenant(req), name, phone);
    res.status(201).json({ client: { id, name, phone } });
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) return fail(res, 409, "Telefone já cadastrado. Selecione o cliente existente.");
    throw error;
  }
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
  const houseSharePercent = Number(req.body?.houseSharePercent ?? 0);
  if (!Number.isFinite(houseSharePercent) || houseSharePercent < 0 || houseSharePercent > 100)
    return fail(res, 400, "Retenção para materiais deve estar entre 0% e 100%.");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720
    || !Number.isInteger(priceCents) || priceCents < 0) {
    return fail(res, 400, "Informe uma duração e um preço válidos.");
  }
  const id = createId();
  db.prepare("INSERT INTO services (id, tenant_id, name, duration_minutes, price_cents, house_share_percent) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, tenant(req), name, durationMinutes, priceCents, houseSharePercent);
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
  const houseShare = Number(req.body?.houseSharePercent ?? 0);
  if (!Number.isFinite(houseShare) || houseShare < 0 || houseShare > 100) return fail(res, 400, "Retenção do estabelecimento inválida.");
  if (!Number.isInteger(duration) || duration < 5 || duration > 720 || !Number.isInteger(price) || price < 0) {
    return fail(res, 400, "Informe uma duração e um preço válidos.");
  }
  db.prepare("UPDATE services SET name = ?, duration_minutes = ?, price_cents = ?, active = ?, house_share_percent = ? WHERE id = ? AND tenant_id = ?")
    .run(name, duration, price, req.body.active === false ? 0 : 1, houseShare, req.params.id, tenant(req));
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
    SELECT id, name, email, phone, role, staff_code AS staffCode, login_code AS loginCode,
      job_title AS jobTitle, commission_percent AS commissionPercent, active
    FROM users WHERE tenant_id = ? AND role IN ('profissional', 'recepcao')
    ORDER BY role, name
  `).all(tenant(_req));
  const support = db.prepare(`
    SELECT id, name, phone, job_title AS jobTitle, active FROM support_employees
    WHERE tenant_id = ? ORDER BY name
  `).all(tenant(_req)).map(row => ({ ...row, role: "sem_acesso", commissionPercent: 0, loginCode: null }));
  res.json({ team: [...team, ...support] });
});

app.post("/api/team-members", requireAuth, allowRoles("dono"), async (req, res) => {
  const name = requiredText(req.body?.name, "Nome");
  const role = req.body?.role;
  if (!["profissional", "recepcao", "sem_acesso"].includes(role)) return fail(res, 400, "Perfil inválido.");
  const jobTitle = String(req.body?.jobTitle ?? (role === "recepcao" ? "Recepção" : role === "profissional" ? "Profissional" : "")).trim();
  if (!jobTitle || jobTitle.length > 80) return fail(res, 400, "Informe o cargo ou função (até 80 caracteres).");
  if (role === "sem_acesso") {
    const id = createId();
    db.prepare("INSERT INTO support_employees (id, tenant_id, name, job_title, phone) VALUES (?, ?, ?, ?, ?)")
      .run(id, tenant(req), name, jobTitle, String(req.body?.phone ?? "").trim());
    return res.status(201).json({ id, role, jobTitle });
  }
  const email = role === "recepcao" ? requiredText(req.body?.email, "E-mail").toLowerCase() : "";
  const password = role === "recepcao" ? requiredText(req.body?.password, "Senha", 200) : "";
  if (role === "recepcao" && password.length < 12) return fail(res, 400, "A senha deve ter pelo menos 12 caracteres.");
  const commission = role === "profissional" ? Number(req.body?.commissionPercent ?? 0) : 0;
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail(res, 400, "Comissão inválida.");
  const id = createId();
  const activation = role === "profissional" ? generateActivation() : null;
  const passwordHash = await bcrypt.hash(role === "profissional" ? crypto.randomBytes(32).toString("hex") : password, 12);
  let staffCode = null;
  let loginCode = null;
  try {
    const create = db.transaction(() => {
      staffCode = role === "profissional" ? allocateStaffCode(tenant(req)) : null;
      loginCode = role === "profissional" ? allocateLoginCode() : null;
      db.prepare(`
        INSERT INTO users (id, tenant_id, name, email, password_hash, role, phone, commission_percent,
          staff_code, login_code, job_title, activation_hash, activation_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenant(req), name, role === "profissional" ? `${id}@staff.invalid` : email,
        passwordHash, role, String(req.body?.phone ?? "").trim(), commission,
        staffCode, loginCode, jobTitle, activation?.hash ?? null, activation?.expires ?? null);
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
  res.status(201).json({ id, staffCode, loginCode, activationToken: activation?.token ?? null });
});

app.post("/api/team-members/:id/activation", requireAuth, allowRoles("dono"), (req, res) => {
  const member = db.prepare("SELECT id, staff_code AS staffCode, login_code AS loginCode FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional' AND active = 1")
    .get(req.params.id, tenant(req));
  if (!member) return fail(res, 404, "Profissional não encontrado.");
  const activation = generateActivation();
  db.transaction(() => {
    db.prepare("UPDATE users SET activation_hash = ?, activation_expires_at = ? WHERE id = ? AND tenant_id = ?")
      .run(activation.hash, activation.expires, member.id, tenant(req));
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?").run(member.id, tenant(req));
  })();
  res.json({ staffCode: member.staffCode, loginCode: member.loginCode, activationToken: activation.token, expiresInHours: 24 });
});

app.patch("/api/team-members/:id", requireAuth, allowRoles("dono"), (req, res) => {
  const support = db.prepare("SELECT id, name, job_title AS jobTitle, phone, active FROM support_employees WHERE id = ? AND tenant_id = ?")
    .get(req.params.id, tenant(req));
  if (support) {
    const name = requiredText(req.body?.name ?? support.name, "Nome");
    const jobTitle = String(req.body?.jobTitle ?? support.jobTitle).trim();
    if (!jobTitle || jobTitle.length > 80) return fail(res, 400, "Cargo inválido.");
    db.prepare("UPDATE support_employees SET name = ?, job_title = ?, phone = ?, active = ? WHERE id = ? AND tenant_id = ?")
      .run(name, jobTitle, String(req.body?.phone ?? support.phone), req.body?.active === false ? 0 : 1, support.id, tenant(req));
    return res.json({ ok: true });
  }
  const member = db.prepare(`
    SELECT id, role FROM users WHERE id = ? AND tenant_id = ? AND role IN ('profissional', 'recepcao')
  `).get(req.params.id, tenant(req));
  if (!member) return fail(res, 404, "Pessoa da equipe não encontrada.");
  const commission = member.role === "profissional" ? Number(req.body?.commissionPercent ?? 0) : 0;
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail(res, 400, "Comissão inválida.");
  db.prepare(`
    UPDATE users SET name = ?, phone = ?, commission_percent = ?, active = ?,
      job_title = COALESCE(?, job_title)
    WHERE id = ? AND tenant_id = ?
  `).run(requiredText(req.body?.name, "Nome"), String(req.body?.phone ?? "").trim(), commission,
    req.body?.active === false ? 0 : 1,
    req.body?.jobTitle === undefined ? null : String(req.body.jobTitle).trim().slice(0, 80),
    req.params.id, tenant(req));
  res.json({ ok: true });
});

app.post("/api/professionals", requireAuth, allowRoles("dono"), async (req, res) => {
  return fail(res, 410, "Cadastre profissionais em Equipe e acessos para gerar código e ativação.");
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
    SELECT b.id, b.professional_id AS professionalId, b.starts_at AS startsAt,
      b.ends_at AS endsAt, b.reason, b.created_by_user_id AS createdByUserId,
      COALESCE(creator.name, 'Não identificado') AS createdByName,
      COALESCE(pro.name, 'Equipe completa') AS professionalName
    FROM blocked_slots b
    LEFT JOIN users creator ON creator.id = b.created_by_user_id AND creator.tenant_id = b.tenant_id
    LEFT JOIN users pro ON pro.id = b.professional_id AND pro.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? AND b.starts_at < ? AND b.ends_at > ?
      AND (? != 'profissional' OR b.professional_id IS NULL OR b.professional_id = ?)
    ORDER BY b.starts_at
  `).all(tenant(req), to, from, req.user.role, req.user.id);
  res.json({ appointments, blockedSlots });
});

// Commission is earned when a service is completed; payment requires an explicit owner action.
// The retained percentage is expressed in points of the service price.
const commissionCents = row => Math.round(row.priceCents * Math.max(0,
  row.commissionPercent - (row.houseSharePercent ?? 0)) / 100);
function professionalEarnings(tenantId, professionalId, month = null) {
  const whereMonth = month ? " AND substr(a.starts_at, 1, 7) = ?" : "";
  const params = month ? [tenantId, professionalId, month] : [tenantId, professionalId];
  const rows = db.prepare(`SELECT a.id, a.starts_at AS startsAt, s.name AS serviceName,
    c.name AS clientName, a.price_cents AS priceCents,
    a.commission_percent AS commissionPercent,
    cp.amount_cents AS paidCents, cp.paid_at AS paidAt
    FROM appointments a
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
    LEFT JOIN commission_payments cp ON cp.appointment_id = a.id AND cp.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.professional_id = ? AND a.status = 'concluido'${whereMonth}
    ORDER BY a.starts_at DESC`).all(...params);
  const services = rows.map(row => ({
    ...row, earnedCents: commissionCents(row), paid: row.paidCents !== null,
  }));
  const earnedCents = services.reduce((sum, row) => sum + row.earnedCents, 0);
  const paidCents = services.reduce((sum, row) => sum + (row.paidCents ?? 0), 0);
  return { services, earnedCents, paidCents, dueCents: earnedCents - paidCents };
}
app.get("/api/professional/earnings", requireAuth, allowRoles("profissional"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  res.setHeader("Cache-Control", "no-store");
  res.json({ month, ...professionalEarnings(tenant(req), req.user.id, month),
    allTime: professionalEarnings(tenant(req), req.user.id) });
});
app.get("/api/commissions", requireAuth, allowRoles("dono"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const rows = db.prepare(`SELECT a.id, a.professional_id AS professionalId, u.name AS professionalName,
    a.starts_at AS startsAt, a.price_cents AS priceCents,
    a.commission_percent AS commissionPercent, a.house_share_percent AS houseSharePercent, s.name AS serviceName,
    cp.amount_cents AS paidCents, cp.paid_at AS paidAt
    FROM appointments a JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    LEFT JOIN commission_payments cp ON cp.appointment_id = a.id AND cp.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.status = 'concluido' AND substr(a.starts_at, 1, 7) = ?
    ORDER BY a.starts_at DESC`).all(tenant(req), month);
  res.json({ month, commissions: rows.map(row => ({...row,
    earnedCents: commissionCents(row), paid: row.paidCents !== null })) });
});
app.patch("/api/commissions/:id", requireAuth, allowRoles("dono"), (req, res) => {
  const appointment = db.prepare(`SELECT id, commission_percent AS commissionPercent,
    house_share_percent AS houseSharePercent FROM appointments
    WHERE id = ? AND tenant_id = ? AND status = 'concluido'`).get(req.params.id, tenant(req));
  if (!appointment) return fail(res, 404, "Serviço concluído não encontrado.");
  if (db.prepare("SELECT 1 FROM commission_payments WHERE appointment_id = ? AND tenant_id = ?")
    .get(appointment.id, tenant(req))) return fail(res, 409, "Comissão já paga. Não é permitido ajustar sem estorno auditado.");
  const percentage = Number(req.body?.commissionPercent);
  const house = Number(req.body?.houseSharePercent);
  const reason = String(req.body?.reason ?? "").trim();
  if (![percentage, house].every(v => Number.isFinite(v) && v >= 0 && v <= 100))
    return fail(res, 400, "Percentuais devem estar entre 0% e 100%.");
  if (reason.length < 5 || reason.length > 250) return fail(res, 400, "Informe o motivo do ajuste (5 a 250 caracteres).");
  db.transaction(() => {
    db.prepare("UPDATE appointments SET commission_percent = ?, house_share_percent = ? WHERE id = ? AND tenant_id = ?")
      .run(percentage, house, appointment.id, tenant(req));
    db.prepare(`INSERT INTO commission_adjustments (id, tenant_id, appointment_id, changed_by,
      old_percent, new_percent, old_house_percent, new_house_percent, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(createId(), tenant(req), appointment.id, req.user.id,
        appointment.commissionPercent, percentage, appointment.houseSharePercent, house, reason);
  })();
  res.json({ ok: true, earnedCents: commissionCents({
    priceCents: db.prepare("SELECT price_cents FROM appointments WHERE id = ?").get(appointment.id).price_cents,
    commissionPercent: percentage, houseSharePercent: house,
  }) });
});

app.post("/api/commissions/:id/pay", requireAuth, allowRoles("dono"), (req, res) => {
  const row = db.prepare(`SELECT id, professional_id AS professionalId,
    price_cents AS priceCents, commission_percent AS commissionPercent,
    house_share_percent AS houseSharePercent
    FROM appointments WHERE id = ? AND tenant_id = ? AND status = 'concluido'`)
    .get(req.params.id, tenant(req));
  if (!row) return fail(res, 404, "Serviço concluído não encontrado.");
  const amount = commissionCents(row);
  try {
    db.prepare(`INSERT INTO commission_payments (appointment_id, tenant_id, professional_id, amount_cents)
      VALUES (?, ?, ?, ?)`).run(row.id, tenant(req), row.professionalId, amount);
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) return fail(res, 409, "Comissão já registrada como paga.");
    throw error;
  }
  res.json({ ok: true, amountCents: amount });
});

// Each professional can see and complete only their own work, without editing finances.
app.get("/api/professional/my-services", requireAuth, allowRoles("profissional"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const rows = appointmentRows(tenant(req),
    "AND a.professional_id = ? AND substr(a.starts_at, 1, 7) = ?",
    [req.user.id, month]);
  const completed = rows.filter(row => row.status === "concluido");
  res.json({
    month, services: rows.reverse(),
    totals: {
      appointments: rows.length,
      completed: completed.length,
      serviceValueCents: completed.reduce((sum, row) => sum + row.priceCents, 0),
    },
  });
});
app.post("/api/professional/my-services/:id/complete", requireAuth, allowRoles("profissional"), (req, res) => {
  const appointment = db.prepare(`
    SELECT id, status, starts_at AS startsAt FROM appointments
    WHERE id = ? AND tenant_id = ? AND professional_id = ?
  `).get(req.params.id, tenant(req), req.user.id);
  if (!appointment) return fail(res, 404, "Atendimento não encontrado na sua agenda.");
  if (!["agendado", "confirmado"].includes(appointment.status)) {
    return fail(res, 409, "Este atendimento não pode ser concluído novamente.");
  }
  if (appointment.startsAt > localNow(tenant(req))) {
    return fail(res, 400, "O serviço só pode ser concluído após o horário de início.");
  }
  const result = db.prepare(`
    UPDATE appointments SET status = 'concluido'
    WHERE id = ? AND tenant_id = ? AND professional_id = ?
    AND status IN ('agendado', 'confirmado')
  `).run(appointment.id, tenant(req), req.user.id);
  if (!result.changes) return fail(res, 409, "Atendimento já atualizado.");
  res.json({ ok: true });
});

app.post("/api/appointments", requireAuth, allowRoles("dono", "profissional", "recepcao"), (req, res) => {
  const { clientId, professionalId, serviceId } = req.body ?? {};
  const startsAt = String(req.body?.startsAt ?? "");
  if (!validDateTime(startsAt) || !professionalId || !serviceId) {
    return fail(res, 400, "Informe profissional, serviço e horário válidos.");
  }
  if (req.user.role === "profissional" && professionalId !== req.user.id) {
    return fail(res, 403, "Profissionais só podem agendar na própria agenda.");
  }
  const chosen = db.prepare(`
    SELECT s.duration_minutes AS duration, s.price_cents AS price,
      u.commission_percent AS commission, s.house_share_percent AS houseShare
    FROM services s
    JOIN professional_services ps ON ps.service_id = s.id AND ps.tenant_id = s.tenant_id
    JOIN users u ON u.id = ps.professional_id AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? AND s.id = ? AND u.id = ? AND s.active = 1 AND u.active = 1
  `).get(tenant(req), serviceId, professionalId);
  const client = clientId ? db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(clientId, tenant(req)) : null;
  if (!chosen || (clientId && !client)) return fail(res, 400, "Cliente, serviço ou profissional inválido.");
  const normalizedStart = startsAt.length === 16 ? `${startsAt}:00` : startsAt;
  if (normalizedStart <= localNow(tenant(req))) return fail(res, 400, "Escolha um horário futuro.");
  const endsAt = addLocalMinutes(normalizedStart, chosen.duration);
  if (!withinWorkingHours(tenant(req), professionalId, normalizedStart, endsAt)) {
    return fail(res, 400, "O horário está fora do expediente deste profissional.");
  }
  const id = createId();
  const create = db.transaction(() => {
    if (scheduleConflict(res, { tenantId: tenant(req), professionalId, startsAt: normalizedStart, endsAt })) return false;
    // Anonymous internal appointments get their own unregistered-client record.
    // Preserve the existing NOT NULL foreign key without an unsafe table rebuild.
    const resolvedClientId = client?.id ?? createId();
    if (!client) db.prepare("INSERT INTO clients (id, tenant_id, name, notes) VALUES (?, ?, ?, ?)")
      .run(resolvedClientId, tenant(req), "Cliente não informado", "__internal_anonymous__");
    db.prepare(`
      INSERT INTO appointments
        (id, tenant_id, client_id, professional_id, service_id, starts_at, ends_at,
         price_cents, commission_percent, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenant(req), resolvedClientId, professionalId, serviceId, normalizedStart, endsAt,
      chosen.price, chosen.commission, chosen.houseShare, String(req.body?.notes ?? "").trim());
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
  if (req.user.role === "profissional") {
    return fail(res, 403, "Para registrar um serviço, utilize a opção Concluir atendimento em Meus atendimentos.");
  }
  if (db.prepare("SELECT 1 FROM commission_payments WHERE appointment_id = ? AND tenant_id = ?").get(appointment.id, tenant(req))) {
    return fail(res, 409, "Comissão já paga. Não é permitido alterar este serviço sem estorno auditado.");
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
    `).run(startsAt, endsAt, status, method || "",
      priceCents, req.body?.notes === undefined ? appointment.notes : String(req.body.notes),
      appointment.id, tenant(req));
    return true;
  });
  if (!update()) return;
  res.json({ ok: true });
});

app.post("/api/blocked-slots", requireAuth, allowRoles("dono", "recepcao", "profissional"), (req, res) => {
  const startsAt = String(req.body?.startsAt ?? "");
  const endsAt = String(req.body?.endsAt ?? "");
  if (!validDateTime(startsAt) || !validDateTime(endsAt) || startsAt >= endsAt) {
    return fail(res, 400, "Informe um período de bloqueio válido.");
  }
  if (startsAt < localNow(tenant(req))) return fail(res, 400, "Bloqueios só podem começar no presente ou futuro.");
  const professionalId = req.user.role === "profissional" ? req.user.id : (req.body?.professionalId || null);
  if (req.user.role === "profissional" && req.body?.professionalId && req.body.professionalId !== req.user.id) return fail(res, 403, "Você só pode bloquear a própria agenda.");
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
    INSERT INTO blocked_slots (id, tenant_id, professional_id, starts_at, ends_at, reason, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenant(req), professionalId, startsAt, endsAt, String(req.body?.reason ?? "").trim(), req.user.id);
  res.status(201).json({ id });
});

app.delete("/api/blocked-slots/:id", requireAuth, allowRoles("dono", "recepcao", "profissional"), (req, res) => {
  const result = req.user.role === "profissional"
    ? db.prepare("DELETE FROM blocked_slots WHERE id = ? AND tenant_id = ? AND professional_id = ?")
      .run(req.params.id, tenant(req), req.user.id)
    : db.prepare("DELETE FROM blocked_slots WHERE id = ? AND tenant_id = ?")
      .run(req.params.id, tenant(req));
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

app.get("/api/receivables", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const rows = appointmentRows(tenant(req), "AND substr(a.starts_at, 1, 7) = ? AND a.status = 'concluido'", [month]);
  res.json({ month, receivables: rows.map(row => ({
    id: row.id, clientName: row.clientName, serviceName: row.serviceName, professionalName: row.professionalName,
    startsAt: row.startsAt, priceCents: row.priceCents, paymentMethod: row.paymentMethod,
    paid: Boolean(row.paymentMethod),
  })) });
});

app.post("/api/receivables/:id/pay", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const method = String(req.body?.paymentMethod ?? "");
  if (!paymentMethods.includes(method)) return fail(res, 400, "Informe a forma de pagamento.");
  const result = db.prepare(`UPDATE appointments SET payment_method = ?
    WHERE id = ? AND tenant_id = ? AND status = 'concluido' AND payment_method = ''`)
    .run(method, req.params.id, tenant(req));
  if (!result.changes) return fail(res, 409, "Atendimento não encontrado, não concluído ou já pago.");
  res.json({ ok: true });
});

app.get("/api/reports", requireAuth, allowRoles("dono"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const revenue = db.prepare(`
    SELECT coalesce(sum(CASE WHEN payment_method != '' THEN price_cents ELSE 0 END), 0) AS revenue_cents,
      coalesce(sum(CASE WHEN payment_method = '' THEN price_cents ELSE 0 END), 0) AS pending_cents,
      count(*) AS completed_count,
      count(*) FILTER (WHERE payment_method = '') AS pending_count
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
      coalesce(sum(round(a.price_cents * max(0, a.commission_percent - a.house_share_percent) / 100)), 0) AS commissionCents
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
  res.json({ month, revenueCents: revenue.revenue_cents, pendingCents: revenue.pending_cents, pendingCount: revenue.pending_count, completedCount: revenue.completed_count,
    byService, byProfessional, inactiveClients });
});

app.get("/api/export/clients.csv", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  if (isDemoTenant(req.user.tenantId)) return fail(res, 403, "Exportações são exclusivas do ambiente comercial.");
  const clients = db.prepare("SELECT name, phone, email, notes, created_at FROM clients WHERE tenant_id = ? ORDER BY name")
    .all(tenant(req));
  sendCsv(res, "clientes.csv", ["Nome", "Telefone", "E-mail", "Observações", "Cadastro"], clients.map((c) =>
    [c.name, c.phone, c.email, c.notes, c.created_at]));
});

app.get("/api/export/appointments.csv", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  if (isDemoTenant(req.user.tenantId)) return fail(res, 403, "Exportações são exclusivas do ambiente comercial.");
  const rows = appointmentRows(tenant(req));
  sendCsv(res, "atendimentos.csv",
    ["Data e hora", "Cliente", "Telefone", "Serviço", "Profissional", "Status", "Valor (centavos)", "Pagamento"],
    rows.map((a) => [a.startsAt, a.clientName, a.clientPhone, a.serviceName, a.professionalName,
      a.status, a.priceCents, a.paymentMethod]));
});

app.get("/api/export/backup", requireAuth, allowRoles("dono"), async (_req, res, next) => {
  if (isDemoTenant(_req.user.tenantId)) return fail(res, 403, "Backup indisponível na demonstração.");
  if (db.prepare("SELECT count(*) AS total FROM tenants").get().total > 1) {
    return fail(res, 403, "Backup completo indisponível em instalação com vários comércios. Use o procedimento administrativo isolado.");
  }
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
  if (req.params.slug === "studio-bela-vista") {
    const demo = db.prepare("SELECT id FROM tenants WHERE slug = ? AND id = ?").get(req.params.slug, DEMO_TENANT_ID);
    if (demo) return fail(res, 403, "Página demonstrativa: reservas reais estão desativadas.");
  }
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
