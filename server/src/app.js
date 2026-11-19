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
import { completedEarlySql, findScheduleConflict } from "./schedule.js";
import { cashClosingPdf, textPdf } from "./cash-closing-pdf.js";
import {getPlanAccess,planFeatures,professionalLimitReached} from "./saas-plans.js";

const app = express();
const sessionSecret = process.env.SESSION_SECRET ?? "desenvolvimento-local-chave-segura-32";
if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || sessionSecret.length < 32)) {
  throw new Error("Defina SESSION_SECRET com pelo menos 32 caracteres em produção.");
}
const appointmentCompletionMonth = "substr(COALESCE(a.completed_on, a.starts_at), 1, 7)";
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
    ? `Este horário está bloqueado. A duração do serviço coincide com o bloqueio de ${conflict.startsAt.slice(0, 16).replace("T", " ")} até ${conflict.endsAt.slice(0, 16).replace("T", " ")}. Escolha um horário em que o serviço termine antes do bloqueio ou comece após o intervalo.`
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


const auditFields = "id, client_id AS clientId, status, starts_at AS startsAt, ends_at AS endsAt, price_cents AS priceCents, payment_method AS paymentMethod, paid_on AS paidOn, completed_on AS completedOn, commission_percent AS commissionPercent, house_share_percent AS houseSharePercent";
function auditSnapshot(tenantId, appointmentId) {
  return db.prepare(`SELECT ${auditFields} FROM appointments WHERE tenant_id = ? AND id = ?`).get(tenantId, appointmentId) ?? null;
}
function auditSnapshotFromOriginal(row) {
  return {id: row.id, clientId: row.clientId, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, priceCents: row.priceCents, paymentMethod: row.paymentMethod, paidOn: row.paidOn, completedOn: row.completedOn, commissionPercent: row.commissionPercent, houseSharePercent: row.houseSharePercent};
}
function recordAppointmentAudit(tenantId, appointmentId, action, actor, before = null) {
  const after = auditSnapshot(tenantId, appointmentId);
  if (!after) return;
  db.prepare(`INSERT INTO appointment_audit
    (id, tenant_id, appointment_id, actor_id, actor_name, action, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    createId(), tenantId, appointmentId, actor?.id ?? null,
    actor?.name || (actor?.role === "cliente" ? "Cliente (link público)" : "Sistema / agendamento público"),
    action, before ? JSON.stringify(before) : null, JSON.stringify(after));
}

function appointmentRows(tenantId, where = "", params = []) {
  return db.prepare(`
    SELECT a.id, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status,
      a.price_cents AS priceCents, a.payment_method AS paymentMethod, a.paid_on AS paidOn,
      a.commission_percent AS commissionPercent, a.notes, a.completed_on AS completedOn,
      a.booking_source AS bookingSource, a.whatsapp_opt_in AS whatsappOptIn,
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
  // SaaS operations use an independent operator key and never write demo tenant data.
  if (req.path.startsWith("/saas/")) return next();
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
// SaaS operator uses an independent high-entropy key, never a tenant user session.
// Configure SAAS_ADMIN_KEY (>= 32 characters) locally and use HTTPS for network access.
function requireSaasAdmin(req,res,next) {
  res.setHeader("Cache-Control","no-store");
  const token=String(req.get("Authorization")||"").replace(/^Bearer /,"");
  if(token&&/^[a-f0-9]{64}$/.test(token)){
    const operator=db.prepare(`SELECT o.id,o.name,o.email FROM saas_operator_sessions s JOIN saas_operators o ON o.id=s.operator_id
      WHERE s.token_hash=? AND s.expires_at>? AND o.active=1`).get(crypto.createHash("sha256").update(token).digest("hex"),Date.now());
    if(!operator)return fail(res,401,"Sessão administrativa expirada.");
    req.saasActor=operator.name+" ("+operator.email+")";req.saasOperator=operator;return next();
  }
  const configured=process.env.SAAS_ADMIN_KEY || "";
  const provided=String(req.get("X-Saas-Admin-Key")||"");
  if(configured.length<32)return fail(res,503,"Central SaaS não configurada no servidor.");
  const first=Buffer.from(configured),second=Buffer.from(provided);
  if(first.length!==second.length || !crypto.timingSafeEqual(first,second))
    return saasAuthLimit(req,res,()=>fail(res,403,"Credencial da Central SaaS inválida."));
  req.saasActor="Chave administrativa (recuperação)";
  next();
}
const saasAuthLimit=limitAttempts("saas-auth",20,15*60*1000);
function saasAudit(req,action,target,details={}){
  db.prepare("INSERT INTO saas_audit(id,actor_name,action,target_id,details_json) VALUES(?,?,?,?,?)").run(createId(),req.saasActor,action,target||null,JSON.stringify(details));
}
app.post("/api/saas/login",saasAuthLimit,async(req,res)=>{
  const email=String(req.body?.email||"").trim().toLowerCase(),password=String(req.body?.password||"");
  const operator=db.prepare("SELECT * FROM saas_operators WHERE email=? AND active=1").get(email);
  if(!operator||password.length>72||!await bcrypt.compare(password,operator.password_hash))return fail(res,401,"Credenciais administrativas inválidas.");
  const token=crypto.randomBytes(32).toString("hex");
  db.transaction(()=>{
    db.prepare("DELETE FROM saas_operator_sessions WHERE expires_at<=?").run(Date.now());
    db.prepare("INSERT INTO saas_operator_sessions(token_hash,operator_id,expires_at) VALUES(?,?,?)").run(crypto.createHash("sha256").update(token).digest("hex"),operator.id,Date.now()+8*60*60*1000);
    req.saasActor=operator.name+" ("+operator.email+")";saasAudit(req,"login",operator.id);
  })();
  res.setHeader("Cache-Control","no-store");res.json({token,operator:{id:operator.id,name:operator.name,email:operator.email}});
});
app.post("/api/saas/logout",requireSaasAdmin,(req,res)=>{
  if(req.saasOperator)db.prepare("DELETE FROM saas_operator_sessions WHERE token_hash=?").run(crypto.createHash("sha256").update(String(req.get("Authorization")).slice(7)).digest("hex"));
  res.json({ok:true});
});
app.get("/api/saas/operators",requireSaasAdmin,(req,res)=>res.json({operators:db.prepare("SELECT id,name,email,active FROM saas_operators ORDER BY name").all()}));
app.post("/api/saas/operators",requireSaasAdmin,async(req,res)=>{
  const name=String(req.body?.name||"").trim(),email=String(req.body?.email||"").trim().toLowerCase(),password=String(req.body?.password||"");
  if(!name||name.length>120||email.length>200||!/^\S+@\S+\.\S+$/.test(email)||password.length<12||Buffer.byteLength(password)>72)return fail(res,400,"Informe nome, e-mail e senha de 12 a 72 bytes.");
  const hash=await bcrypt.hash(password,12),id=createId();
  if(!req.saasOperator&&db.prepare("SELECT 1 FROM saas_operators WHERE active=1").get())return fail(res,403,"Use uma conta administrativa individual para cadastrar novos operadores.");
  try{db.transaction(()=>{db.prepare("INSERT INTO saas_operators(id,name,email,password_hash) VALUES(?,?,?,?)").run(id,name,email,hash);saasAudit(req,"operador_criado",id,{name,email});})();}catch(e){if(e.code?.startsWith("SQLITE_CONSTRAINT"))return fail(res,409,"E-mail administrativo já cadastrado.");throw e;}
  res.status(201).json({id});
});
app.patch("/api/saas/operators/:id",requireSaasAdmin,(req,res)=>{
  if(!req.saasOperator)return fail(res,403,"Entre com sua conta administrativa individual.");
  if(typeof req.body?.active!=="boolean"||req.params.id===req.saasOperator.id)return fail(res,400,"Não é possível desativar sua própria conta.");
  const result=db.transaction(()=>{
    const changed=db.prepare("UPDATE saas_operators SET active=? WHERE id=?").run(req.body.active?1:0,req.params.id);
    if(!changed.changes)return false;
    if(!req.body.active)db.prepare("DELETE FROM saas_operator_sessions WHERE operator_id=?").run(req.params.id);
    saasAudit(req,"operador_status",req.params.id,{active:req.body.active});return true;
  })();
  if(!result)return fail(res,404,"Operador não encontrado.");res.json({ok:true});
});
function saasPlanRows(){
  return db.prepare("SELECT id,name,monthly_cents AS monthlyCents,professional_limit AS professionalLimit,features_json AS featuresJson,active FROM saas_plans ORDER BY rowid").all().map(({featuresJson,...p})=>({...p,features:JSON.parse(featuresJson)}));
}
function blockedPlanChange(id,features){
  if(!features.expenses&&db.prepare("SELECT 1 FROM operating_expenses WHERE tenant_id=? AND status='pendente' LIMIT 1").get(id))
    return "Existem despesas em aberto. Resolva as pendências antes de retirar o módulo financeiro.";
  if(!features.packages&&db.prepare(`SELECT 1 FROM package_purchases p JOIN package_purchase_items i ON i.purchase_id=p.id
    WHERE p.tenant_id=? AND p.expires_on>=? AND i.sessions>(SELECT count(*) FROM package_redemptions r WHERE r.purchase_id=p.id AND r.service_id=i.service_id) LIMIT 1`).get(id,cashDay(id)))
    return "Existem sessões pré-pagas disponíveis. Preserve o acesso aos pacotes até concluir as obrigações com os clientes.";
  return null;
}
app.get("/api/saas/plans",requireSaasAdmin,(_req,res)=>res.json({plans:saasPlanRows()}));
function saveSaasPlan(req,res){
  const id=req.params.id||String(req.body?.id||"").trim(),name=String(req.body?.name||"").trim(),{monthlyCents,professionalLimit,features,active}=req.body||{};
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||id.length>60||!name||name.length>80||
    !(monthlyCents===null||Number.isSafeInteger(monthlyCents)&&monthlyCents>=0&&monthlyCents<=100000000)||
    !(professionalLimit===null||Number.isSafeInteger(professionalLimit)&&professionalLimit>=1&&professionalLimit<=10000)||
    !features||planFeatures.some(f=>typeof features[f]!=="boolean")||typeof active!=="boolean")return fail(res,400,"Confira nome, mensalidade, limites e recursos.");
  const old=db.prepare("SELECT * FROM saas_plans WHERE id=?").get(id);
  if(req.params.id?!old:old)return fail(res,409,"Plano inexistente ou identificador já utilizado.");
  // Existing contract data and access remain until the operator explicitly applies the plan.
  const sanitized=Object.fromEntries(planFeatures.map(f=>[f,features[f]]));
  if(old)for(const sub of db.prepare("SELECT tenant_id AS id FROM tenant_subscriptions WHERE plan=? AND enforce_plan=1").all(id)){
    const blocked=blockedPlanChange(sub.id,sanitized);if(blocked)return fail(res,409,blocked);
  }
  db.transaction(()=>{
    db.prepare(`INSERT INTO saas_plans(id,name,monthly_cents,professional_limit,features_json,active) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,monthly_cents=excluded.monthly_cents,professional_limit=excluded.professional_limit,features_json=excluded.features_json,active=excluded.active`)
      .run(id,name,monthlyCents,professionalLimit,JSON.stringify(sanitized),active?1:0);
    saasAudit(req,old?"plano_editado":"plano_criado",id,{name,monthlyCents,professionalLimit,features:sanitized,active});
  })();
  res.status(old?200:201).json({ok:true,id});
}
app.post("/api/saas/plans",requireSaasAdmin,saveSaasPlan);
app.patch("/api/saas/plans/:id",requireSaasAdmin,saveSaasPlan);
app.get("/api/saas/businesses", requireSaasAdmin, (req,res)=>{
  const businesses=db.prepare(`SELECT t.id,t.name,t.slug,t.created_at AS createdAt,
    COALESCE(ss.plan,'comercial') AS plan,COALESCE(ss.status,'active') AS status,
    ss.due_date AS dueDate,ss.notes,ss.trial_until AS trialUntil,coalesce(ss.enforce_plan,0) AS enforced,
    p.name AS planName,ss.monthly_cents AS monthlyCents,
    (SELECT count(*) FROM users x WHERE x.tenant_id=t.id AND x.role='profissional' AND x.active=1) AS professionals,
    u.email AS ownerEmail,u.name AS ownerName
    FROM tenants t LEFT JOIN tenant_subscriptions ss ON ss.tenant_id=t.id
    LEFT JOIN saas_plans p ON p.id=coalesce(ss.plan,'comercial')
    LEFT JOIN users u ON u.tenant_id=t.id AND u.role='dono'
    ORDER BY t.created_at DESC`).all();
  res.setHeader("Cache-Control","no-store");
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
  res.json({businesses,today});
});
app.post("/api/saas/businesses", requireSaasAdmin, limitAttempts("saas-create",20,15*60*1000), async(req,res)=>{
  const name=requiredText(req.body?.businessName,"Estabelecimento",120);
  const ownerName=requiredText(req.body?.ownerName,"Proprietário",120);
  const email=requiredText(req.body?.ownerEmail,"E-mail do proprietário",200).toLowerCase();
  if(db.prepare("SELECT 1 FROM users WHERE lower(email)=? LIMIT 1").get(email))
    return fail(res,409,"Este e-mail já está cadastrado em outro estabelecimento.");
  const slug=String(req.body?.slug||"").trim().toLowerCase();
  const plan=String(req.body?.plan||"comercial").trim();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80||
      slug==="studio-bela-vista" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
      !db.prepare("SELECT 1 FROM saas_plans WHERE id=? AND active=1").get(plan))
    return fail(res,400,"Revise identificador, e-mail e plano.");
  const dueDate=req.body?.dueDate||null,trialUntil=req.body?.trialUntil||null;
  const monthlyCents=req.body?.monthlyCents===undefined?db.prepare("SELECT monthly_cents AS amount FROM saas_plans WHERE id=?").get(plan).amount:req.body.monthlyCents;
  if(monthlyCents!==null&&(!Number.isSafeInteger(monthlyCents)||monthlyCents<0||monthlyCents>100000000))return fail(res,400,"Mensalidade inválida.");
  if((dueDate&&!validCashDate(dueDate))||(trialUntil&&!validCashDate(trialUntil)))return fail(res,400,"Datas inválidas.");
  // Initial credential is shown once; operator must deliver it securely to the owner.
  const password=crypto.randomBytes(18).toString("base64url");
  const hash=await bcrypt.hash(password,12),id=createId(),userId=createId();
  const days=[[0,null,null],[1,"09:00","18:00"],[2,"09:00","18:00"],
    [3,"09:00","18:00"],[4,"09:00","18:00"],[5,"09:00","18:00"],[6,"09:00","13:00"]];
  try {
    db.transaction(()=>{
      db.prepare("INSERT INTO tenants (id,name,slug) VALUES (?,?,?)").run(id,name,slug);
      db.prepare("INSERT INTO business_settings (tenant_id,business_name) VALUES (?,?)").run(id,name);
      db.prepare(`INSERT INTO users (id,tenant_id,name,email,password_hash,role)
        VALUES (?,?,?,?,?,'dono')`).run(userId,id,ownerName,email,hash);
      const hours=db.prepare("INSERT INTO business_hours (tenant_id,weekday,opens_at,closes_at) VALUES (?,?,?,?)");
      days.forEach(d=>hours.run(id,...d));
      db.prepare("INSERT INTO tenant_subscriptions (tenant_id,plan,status,enforce_plan,due_date,trial_until,monthly_cents) VALUES (?,?,'active',1,?,?,?)").run(id,plan,dueDate,trialUntil,monthlyCents);
      saasAudit(req,"estabelecimento_criado",id,{name,plan,dueDate,trialUntil,monthlyCents});
    })();
  } catch(err) {
    if(err.code?.startsWith("SQLITE_CONSTRAINT"))return fail(res,409,"Identificador já utilizado.");
    throw err;
  }
  res.setHeader("Cache-Control","no-store");
  res.status(201).json({business:{id,name,slug,ownerEmail:email,plan,status:"active"},temporaryPassword:password,
    warning:"Entregue a senha temporária de maneira privada. Ela não será exibida novamente."});
});
app.patch("/api/saas/businesses/:id",requireSaasAdmin,(req,res)=>{
  const row=db.prepare("SELECT id,slug FROM tenants WHERE id=?").get(req.params.id);
  if(!row || row.slug==="studio-bela-vista")return fail(res,404,"Estabelecimento indisponível.");
  const existing=db.prepare("SELECT * FROM tenant_subscriptions WHERE tenant_id=?").get(row.id);
  const plan=String(req.body?.plan||existing?.plan||"comercial"),status=String(req.body?.status||existing?.status||"active");
  const notes=String(req.body?.notes||"").trim(),dueDate=req.body?.dueDate||null;
  const trialUntil=req.body?.trialUntil===undefined?existing?.trial_until??null:req.body.trialUntil||null;
  if(!db.prepare("SELECT 1 FROM saas_plans WHERE id=? AND (active=1 OR id=?)").get(plan,existing?.plan||"comercial")||!["active","suspended"].includes(status)||
     notes.length>300||(dueDate!==null&&!validCashDate(dueDate))||(trialUntil!==null&&!validCashDate(trialUntil)))
    return fail(res,400,"Plano, status ou data inválidos.");
  const enforced=existing?.enforce_plan||req.body?.applyPlan===true||plan!==(existing?.plan||"comercial")?1:0;
  if(enforced&&(req.body?.applyPlan===true||plan!==(existing?.plan||"comercial"))){
    const features=JSON.parse(db.prepare("SELECT features_json AS json FROM saas_plans WHERE id=?").get(plan).json);
    const blocked=blockedPlanChange(row.id,features);if(blocked)return fail(res,409,blocked);
  }
  const monthlyCents=req.body?.monthlyCents===undefined?(plan!==(existing?.plan||"comercial")?db.prepare("SELECT monthly_cents AS amount FROM saas_plans WHERE id=?").get(plan).amount:existing?.monthly_cents??null):req.body.monthlyCents;
  if(monthlyCents!==null&&(!Number.isSafeInteger(monthlyCents)||monthlyCents<0||monthlyCents>100000000))return fail(res,400,"Mensalidade inválida.");
  db.transaction(()=>{
    db.prepare(`INSERT INTO tenant_subscriptions (tenant_id,plan,status,notes,due_date,enforce_plan,trial_until,monthly_cents)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET plan=excluded.plan,status=excluded.status,notes=excluded.notes,
      due_date=excluded.due_date,enforce_plan=excluded.enforce_plan,trial_until=excluded.trial_until,monthly_cents=excluded.monthly_cents`).run(row.id,plan,status,notes,dueDate,enforced,trialUntil,monthlyCents);
    if(status==="suspended") db.prepare("DELETE FROM sessions WHERE tenant_id=?").run(row.id);
    saasAudit(req,"assinatura_editada",row.id,{plan,status,dueDate,trialUntil,enforced,monthlyCents});
  })();
  res.json({ok:true});
});
app.get("/api/saas/payments",requireSaasAdmin,(_req,res)=>{
  res.json({payments:db.prepare(`SELECT p.id,p.tenant_id AS tenantId,t.name AS businessName,p.period,p.amount_cents AS amountCents,p.paid_on AS paidOn,p.method,p.plan_name AS planName,
    p.next_due_date AS nextDueDate,p.notes,p.actor_name AS actorName FROM saas_subscription_payments p JOIN tenants t ON t.id=p.tenant_id ORDER BY p.paid_on DESC,p.created_at DESC`).all()});
});
app.post("/api/saas/businesses/:id/payments",requireSaasAdmin,(req,res)=>{
  const {period,amountCents,paidOn,method,nextDueDate}=req.body||{},notes=String(req.body?.notes||"").trim();
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
  if(!validMonth(period)||!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>100000000||!validCashDate(paidOn)||paidOn>today||!validCashDate(nextDueDate)||nextDueDate<=paidOn||
    !["pix","boleto","dinheiro","cartao","transferencia"].includes(method)||notes.length>300)return fail(res,400,"Confira competência, valor, data e próximo vencimento.");
  const result=db.transaction(()=>{
    const b=db.prepare(`SELECT t.id,t.slug,s.plan,s.due_date AS dueDate,p.name AS planName FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id=t.id
      LEFT JOIN saas_plans p ON p.id=coalesce(s.plan,'comercial') WHERE t.id=?`).get(req.params.id);
    if(!b||b.slug==="studio-bela-vista")return "Estabelecimento indisponível.";
    if(db.prepare("SELECT 1 FROM saas_subscription_payments WHERE tenant_id=? AND period=?").get(b.id,period))return "Mensalidade desta competência já registrada.";
    if(b.dueDate&&nextDueDate<b.dueDate)return "O próximo vencimento não pode retroceder.";
    const paymentId=createId();
    db.prepare(`INSERT INTO saas_subscription_payments(id,tenant_id,period,amount_cents,paid_on,method,plan_name,previous_due_date,next_due_date,notes,actor_name)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(paymentId,b.id,period,amountCents,paidOn,method,b.planName||"Comercial",b.dueDate??null,nextDueDate,notes,req.saasActor);
    db.prepare("INSERT INTO tenant_subscriptions(tenant_id,plan,due_date) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET due_date=excluded.due_date").run(b.id,b.plan||"comercial",nextDueDate);
    saasAudit(req,"mensalidade_registrada",b.id,{paymentId,period,amountCents,paidOn,nextDueDate});return {id:paymentId};
  })();
  if(typeof result==="string")return fail(res,409,result);res.status(201).json(result);
});
app.get("/api/saas/audit",requireSaasAdmin,(_req,res)=>res.json({events:db.prepare("SELECT id,actor_name AS actorName,action,target_id AS targetId,details_json AS detailsJson,created_at AS createdAt FROM saas_audit ORDER BY created_at DESC LIMIT 300").all()}));



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
  if(user && db.prepare("SELECT status FROM tenant_subscriptions WHERE tenant_id=?").get(user.tenant_id)?.status==="suspended")
    return fail(res,403,"O acesso do estabelecimento está suspenso. Contate o suporte.");
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
        AND booking_source != 'direct' AND status NOT IN ('cancelado', 'faltou') AND NOT (${completedEarlySql})) AS today_count,
      count(DISTINCT client_id) FILTER (WHERE substr(starts_at, 1, 7) = ?
        AND status NOT IN ('cancelado', 'faltou')) AS active_clients,
      coalesce(sum(price_cents) FILTER (
        WHERE substr(paid_on, 1, 7) = ? AND payment_method != '' AND status = 'concluido'), 0) AS month_revenue,
      count(*) FILTER (WHERE substr(starts_at, 1, 7) = ?
        AND status NOT IN ('cancelado', 'faltou')) AS month_count
    FROM appointments a WHERE tenant_id = ?
      AND (? != 'profissional' OR professional_id = ?)
  `).get(localNow(tenant(req)), month, month, month, tenant(req), req.user.role, req.user.id);
  const upcoming = appointmentRows(tenant(req),
    `AND a.starts_at >= ? AND a.status IN ('agendado', 'confirmado')
      ${req.user.role === "profissional" ? "AND a.professional_id = ?" : ""}`,
    req.user.role === "profissional" ? [localNow(tenant(req)), req.user.id] : [localNow(tenant(req))],
  ).slice(0, 6);
  const blockedToday = req.user.role === "profissional"
    ? db.prepare(`SELECT count(*) AS total FROM blocked_slots
      WHERE tenant_id = ? AND (professional_id = ? OR professional_id IS NULL) AND starts_at < ? AND ends_at > ?`)
      .get(tenant(req), req.user.id, `${localNow(tenant(req)).slice(0, 10)}T23:59:59`, `${localNow(tenant(req)).slice(0, 10)}T00:00:00`).total
    : null;
  const earnings = req.user.role === "profissional" ? professionalEarnings(tenant(req), req.user.id) : null;
  const completedToday = req.user.role === "profissional" ? db.prepare(`SELECT count(*) AS total FROM appointments WHERE tenant_id = ? AND professional_id = ? AND status = 'concluido' AND COALESCE(completed_on, substr(starts_at, 1, 10)) = ?`).get(tenant(req), req.user.id, localNow(tenant(req)).slice(0, 10)).total : null;
  res.json({
    completedToday,
    blockedToday,
    earningsDueCents: earnings?.dueCents ?? null,
    todayCount: summary.today_count,
    activeClients: summary.active_clients,
    monthRevenueCents: req.user.role === "dono" ? summary.month_revenue + productSalesSummary(tenant(req),month).revenueCents + packageRevenue(tenant(req),month) : null,
    monthCount: summary.month_count,
    upcoming,
  });
});

app.get("/api/clients", requireAuth, (req, res) => {
  const search = `%${String(req.query.search ?? "").trim()}%`;
  const clients = db.prepare(`
    SELECT c.id, c.name, c.phone, c.email, c.notes, c.created_at AS createdAt,
      c.whatsapp_consent AS whatsappConsent,c.whatsapp_marketing_consent AS whatsappMarketingConsent,
      count(a.id) AS appointmentCount,
      max(COALESCE(a.completed_on, substr(a.starts_at, 1, 10))) FILTER (WHERE a.status = 'concluido') AS lastVisit
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
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) return fail(res, 409, "Já existe um cliente com este nome e telefone. Selecione o cadastro existente.");
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
    db.prepare("INSERT INTO clients (id, tenant_id, name, phone, email, notes,whatsapp_consent,whatsapp_marketing_consent) VALUES (?, ?, ?, ?, ?, ?,?,?)")
      .run(id, tenant(req), name, phone, email, notes,req.body?.whatsappConsent===true?1:0,req.body?.whatsappMarketingConsent===true?1:0);
    res.status(201).json({ client: db.prepare("SELECT id, name, phone, email, notes FROM clients WHERE id = ?").get(id) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return fail(res, 409, "Já existe um cliente com este nome e telefone.");
    throw error;
  }
});

app.patch("/api/clients/:id", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const existing = db.prepare("SELECT id,phone,whatsapp_consent AS consent,whatsapp_marketing_consent AS marketing FROM clients WHERE id = ? AND tenant_id = ?").get(req.params.id, tenant(req));
  if (!existing) return fail(res, 404, "Cliente não encontrado.");
  const name = requiredText(req.body?.name, "Nome");
  try {
    const phone=String(req.body?.phone??"").trim(),changed=phone.replace(/\D/g,"")!==existing.phone.replace(/\D/g,"");
    db.transaction(()=>{
      db.prepare("UPDATE clients SET name = ?, phone = ?, email = ?, notes = ?,whatsapp_consent=?,whatsapp_marketing_consent=? WHERE id = ? AND tenant_id = ?")
        .run(name,phone,String(req.body?.email??"").trim(),String(req.body?.notes??"").trim(),
          changed?0:req.body?.whatsappConsent===undefined?existing.consent:req.body.whatsappConsent===true?1:0,
          changed?0:req.body?.whatsappMarketingConsent===undefined?existing.marketing:req.body.whatsappMarketingConsent===true?1:0,req.params.id,tenant(req));
      if(changed||req.body?.revokeBookingConsent===true)db.prepare("UPDATE appointments SET whatsapp_opt_in=0 WHERE tenant_id=? AND client_id=?").run(tenant(req),req.params.id);
    })();
    res.json({ client: db.prepare("SELECT id, name, phone, email, notes FROM clients WHERE id = ?").get(req.params.id) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return fail(res, 409, "Já existe um cliente com este nome e telefone.");
    throw error;
  }
});

app.get("/api/clients/:id/history", requireAuth, (req, res) => {
  const client = db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(req.params.id, tenant(req));
  if (!client) return fail(res, 404, "Cliente não encontrado.");
  const history = appointmentRows(tenant(req),
    `AND a.client_id = ? ${req.user.role === "profissional" ? "AND a.professional_id = ?" : ""}`,
    req.user.role === "profissional" ? [req.params.id, req.user.id] : [req.params.id]).reverse();
  const benefits=req.user.role==="profissional"?null:{purchases:purchaseRows(tenant(req),client.id),loyalty:loyaltyPoints(tenant(req),client.id)};
  const totalPaidCents=benefits?history.filter(a=>a.paidOn&&a.paymentMethod!=="pacote").reduce((s,a)=>s+a.priceCents,0)+benefits.purchases.reduce((s,p)=>s+p.priceCents,0):null;
  res.json({ history,benefits,totalPaidCents });
});

app.get("/api/services", requireAuth, (_req, res) => {
  const services = db.prepare(`
    SELECT s.id, s.name, s.duration_minutes AS durationMinutes, s.price_cents AS priceCents, s.active,
       s.house_share_percent AS houseSharePercent, s.commission_mode AS commissionMode, s.service_commission_percent AS serviceCommissionPercent, s.public_enabled AS publicEnabled,
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
  const publicEnabled = req.body?.publicEnabled !== false;
  const commissionMode = req.body?.commissionMode ?? "professional";
  const serviceCommissionPercent = Number(req.body?.serviceCommissionPercent ?? 0);
  if (!["professional", "custom"].includes(commissionMode) || !Number.isFinite(serviceCommissionPercent) || serviceCommissionPercent < 0 || serviceCommissionPercent > 100) return fail(res, 400, "Comissão do serviço inválida.");
  if (!Number.isFinite(houseSharePercent) || houseSharePercent < 0 || houseSharePercent > 100)
    return fail(res, 400, "Retenção para materiais deve estar entre 0% e 100%.");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720
    || !Number.isInteger(priceCents) || priceCents < 0) {
    return fail(res, 400, "Informe uma duração e um preço válidos.");
  }
  const id = createId();
  db.prepare("INSERT INTO services (id, tenant_id, name, duration_minutes, price_cents, house_share_percent, commission_mode, service_commission_percent, public_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, tenant(req), name, durationMinutes, priceCents, houseSharePercent, commissionMode, serviceCommissionPercent, publicEnabled ? 1 : 0);
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
  const publicEnabled = req.body?.publicEnabled !== false;
  const commissionMode = req.body?.commissionMode ?? "professional";
  const serviceCommissionPercent = Number(req.body?.serviceCommissionPercent ?? 0);
  if (!["professional", "custom"].includes(commissionMode) || !Number.isFinite(serviceCommissionPercent) || serviceCommissionPercent < 0 || serviceCommissionPercent > 100) return fail(res, 400, "Comissão do serviço inválida.");
  if (!Number.isFinite(houseShare) || houseShare < 0 || houseShare > 100) return fail(res, 400, "Retenção do estabelecimento inválida.");
  if (!Number.isInteger(duration) || duration < 5 || duration > 720 || !Number.isInteger(price) || price < 0) {
    return fail(res, 400, "Informe uma duração e um preço válidos.");
  }
  db.prepare("UPDATE services SET name = ?, duration_minutes = ?, price_cents = ?, active = ?, house_share_percent = ?, commission_mode = ?, service_commission_percent = ?, public_enabled = ? WHERE id = ? AND tenant_id = ?")
    .run(name, duration, price, req.body.active === false ? 0 : 1, houseShare, commissionMode, serviceCommissionPercent, publicEnabled ? 1 : 0, req.params.id, tenant(req));
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
      if(role==="profissional"&&professionalLimitReached(tenant(req)))return false;
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
      return true;
    });
    if(!create())return fail(res,409,"Limite de profissionais ativos do plano atingido.");
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
    SELECT id, role,active FROM users WHERE id = ? AND tenant_id = ? AND role IN ('profissional', 'recepcao')
  `).get(req.params.id, tenant(req));
  if (!member) return fail(res, 404, "Pessoa da equipe não encontrada.");
  if(member.role==="profissional"&&!member.active&&req.body?.active!==false&&professionalLimitReached(tenant(req)))return fail(res,409,"Limite de profissionais ativos do plano atingido.");
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
    SELECT id,active FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional'
  `).get(req.params.id, tenant(req));
  if (!professional) return fail(res, 404, "Profissional não encontrado.");
  if(!professional.active&&req.body?.active!==false&&professionalLimitReached(tenant(req)))return fail(res,409,"Limite de profissionais ativos do plano atingido.");
  const commission = Number(req.body?.commissionPercent ?? 0);
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail(res, 400, "Comissão inválida.");
  db.prepare("UPDATE users SET phone = ?, commission_percent = ?, active = ? WHERE id = ? AND tenant_id = ?")
    .run(String(req.body?.phone ?? "").trim(), commission, req.body.active === false ? 0 : 1, req.params.id, tenant(req));
  res.json({ ok: true });
});

app.get("/api/commission-rules", requireAuth, allowRoles("dono"), (req,res) => {
  const rules=db.prepare(`SELECT psc.professional_id AS professionalId,psc.service_id AS serviceId,
    psc.commission_percent AS commissionPercent,psc.house_share_percent AS houseSharePercent,
    u.name AS professionalName,s.name AS serviceName FROM professional_service_commissions psc
    JOIN users u ON u.id=psc.professional_id AND u.tenant_id=psc.tenant_id
    JOIN services s ON s.id=psc.service_id AND s.tenant_id=psc.tenant_id
    WHERE psc.tenant_id=? ORDER BY u.name,s.name`).all(tenant(req));
  const serviceRules=db.prepare(`SELECT id AS serviceId,name AS serviceName,price_cents AS priceCents,
    service_commission_percent AS commissionPercent,house_share_percent AS houseSharePercent
    FROM services WHERE tenant_id=? AND commission_mode='custom' ORDER BY name`).all(tenant(req));
  res.json({rules,serviceRules});
});
app.put("/api/commission-rules", requireAuth, allowRoles("dono"), (req,res) => {
  const pro=String(req.body?.professionalId||""), svc=String(req.body?.serviceId||"");
  const percent=Number(req.body?.commissionPercent),house=Number(req.body?.houseSharePercent??0);
  if(![percent,house].every(v=>Number.isFinite(v)&&v>=0&&v<=100)||house>percent)
    return fail(res,400,"Repasse e retenção inválidos.");
  if(!pro){
    const changed=db.prepare(`UPDATE services SET commission_mode='custom',service_commission_percent=?,house_share_percent=?
      WHERE tenant_id=? AND id=?`).run(percent,house,tenant(req),svc);
    if(!changed.changes)return fail(res,404,"Serviço não encontrado neste estabelecimento.");
    return res.json({ok:true});
  }
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND role='profissional'").get(pro,tenant(req)) ||
     !db.prepare("SELECT 1 FROM services WHERE id=? AND tenant_id=?").get(svc,tenant(req)))
    return fail(res,404,"Serviço ou profissional não encontrado neste estabelecimento.");
  db.prepare(`INSERT INTO professional_service_commissions
    (tenant_id,professional_id,service_id,commission_percent,house_share_percent) VALUES (?,?,?,?,?)
    ON CONFLICT(tenant_id,professional_id,service_id) DO UPDATE SET
    commission_percent=excluded.commission_percent,house_share_percent=excluded.house_share_percent`)
    .run(tenant(req),pro,svc,percent,house);
  res.json({ok:true});
});
app.delete("/api/commission-rules", requireAuth, allowRoles("dono"), (req,res) => {
  if(!req.body?.professionalId){
    const changed=db.prepare(`UPDATE services SET commission_mode='professional',service_commission_percent=0,house_share_percent=0
      WHERE tenant_id=? AND id=? AND commission_mode='custom'`).run(tenant(req),String(req.body?.serviceId||""));
    if(!changed.changes)return fail(res,404,"Regra não encontrada.");
    return res.json({ok:true});
  }
  const changed=db.prepare(`DELETE FROM professional_service_commissions
    WHERE tenant_id=? AND professional_id=? AND service_id=?`)
    .run(tenant(req),req.body?.professionalId,req.body?.serviceId);
  if(!changed.changes)return fail(res,404,"Regra não encontrada.");
  res.json({ok:true});
});

app.get("/api/schedule", requireAuth, (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!validDateTime(from) || !validDateTime(to) || from >= to) return fail(res, 400, "Período da agenda inválido.");
  const appointmentFilter = req.user.role === "profissional" ? "AND a.professional_id = ?" : "";
  const appointments = appointmentRows(tenant(req),
    `AND a.booking_source != 'direct' AND a.starts_at < ? AND a.ends_at > ? AND NOT (${completedEarlySql}) ${appointmentFilter}`,
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
  const whereMonth = month ? " AND substr(COALESCE(a.completed_on, a.starts_at), 1, 7) = ?" : "";
  const params = month ? [tenantId, professionalId, month] : [tenantId, professionalId];
  const rows = db.prepare(`SELECT a.id, a.starts_at AS startsAt, COALESCE(a.completed_on,substr(a.starts_at,1,10)) AS completedOn, s.name AS serviceName,
    c.name AS clientName, a.price_cents AS priceCents, a.booking_source AS bookingSource, a.payment_method AS paymentMethod,
    a.commission_percent AS commissionPercent, a.house_share_percent AS houseSharePercent,
    CASE WHEN cp.transfer_confirmed = 1 THEN cp.amount_cents ELSE NULL END AS paidCents, cp.paid_at AS paidAt
    FROM appointments a
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
    LEFT JOIN commission_payments cp ON cp.appointment_id = a.id AND cp.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.professional_id = ? AND a.status = 'concluido'${whereMonth}
    ORDER BY completedOn DESC, a.starts_at DESC`).all(...params);
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
    a.starts_at AS startsAt, COALESCE(a.completed_on, substr(a.starts_at, 1, 10)) AS completedOn, a.service_id AS serviceId,
    a.price_cents AS priceCents, a.booking_source AS bookingSource, a.payment_method AS paymentMethod, c.name AS clientName,
    a.commission_percent AS commissionPercent, a.house_share_percent AS houseSharePercent, s.name AS serviceName,
    CASE WHEN cp.transfer_confirmed = 1 THEN cp.amount_cents ELSE NULL END AS paidCents, cp.paid_at AS paidAt
    FROM appointments a JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    LEFT JOIN commission_payments cp ON cp.appointment_id = a.id AND cp.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.status = 'concluido' AND substr(COALESCE(a.completed_on, a.starts_at), 1, 7) = ?
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
  if (reason.length > 250) return fail(res, 400, "A observação deve ter até 250 caracteres.");
  const beforeAudit = auditSnapshot(tenant(req), appointment.id);
  db.transaction(() => {
    db.prepare("UPDATE appointments SET commission_percent = ?, house_share_percent = ? WHERE id = ? AND tenant_id = ?")
      .run(percentage, house, appointment.id, tenant(req));
    db.prepare(`INSERT INTO commission_adjustments (id, tenant_id, appointment_id, changed_by,
      old_percent, new_percent, old_house_percent, new_house_percent, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(createId(), tenant(req), appointment.id, req.user.id,
        appointment.commissionPercent, percentage, appointment.houseSharePercent, house, reason);
  })();
  recordAppointmentAudit(tenant(req), appointment.id, "comissao", req.user, beforeAudit);
  res.json({ ok: true, earnedCents: commissionCents({
    priceCents: db.prepare("SELECT price_cents FROM appointments WHERE id = ?").get(appointment.id).price_cents,
    commissionPercent: percentage, houseSharePercent: house,
  }) });
});

app.post("/api/commissions/:id/pay", requireAuth, allowRoles("dono"), (_req, res) => {
  return fail(res, 409, "Repasses individuais foram desativados. Confirme os pagamentos na apuração quinzenal.");
});

// Each professional can see and complete only their own work, without editing finances.
// Period closing records commission disbursements without triggering actual bank transfers.

function fortnightWindow(period) {
  const match = /^(\d{4})-(\d{2})-(1|2)$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), half = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${match[1]}-${match[2]}-${half === 1 ? "01" : "16"}`,
    end: `${match[1]}-${match[2]}-${half === 1 ? "15" : String(last).padStart(2, "0")}`, half, period };
}
function fortnightServices(tenantId, period) {
  const window = fortnightWindow(period);
  if (!window) return null;
  const items = db.prepare(`SELECT a.id, a.professional_id AS professionalId, u.name AS professionalName,
    a.service_id AS serviceId, s.name AS serviceName, c.name AS clientName, a.booking_source AS bookingSource,
    a.price_cents AS priceCents, a.commission_percent AS commissionPercent,
    a.house_share_percent AS houseSharePercent, a.starts_at AS startsAt, a.payment_method AS paymentMethod,
    COALESCE(a.completed_on, substr(a.starts_at, 1, 10)) AS earnedOn,
    CASE WHEN cp.transfer_confirmed = 1 THEN cp.amount_cents ELSE NULL END AS paidCents,
    CASE WHEN cp.transfer_confirmed = 0 THEN 1 ELSE 0 END AS legacyUnverified
    FROM appointments a
    JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
    LEFT JOIN commission_payments cp ON cp.appointment_id = a.id AND cp.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.status = 'concluido'
      AND COALESCE(a.completed_on, substr(a.starts_at, 1, 10)) BETWEEN ? AND ?
    ORDER BY u.name, earnedOn, a.id`).all(tenantId, window.start, window.end);
  return { window, items };
}
app.get("/api/settlements", requireAuth, allowRoles("dono"), (req, res) => {
  const period = String(req.query.period ?? `${localNow(tenant(req)).slice(0, 7)}-${Number(localNow(tenant(req)).slice(8, 10)) <= 15 ? 1 : 2}`);
  const data = fortnightServices(tenant(req), period);
  if (!data) return fail(res, 400, "Quinzena inválida.");
  const summaries = new Map();
  for (const item of data.items) {
    const current = summaries.get(item.professionalId) || {
      professionalId: item.professionalId, professionalName: item.professionalName,
      completed: 0, pendingServices: 0, grossCents: 0, earnedCents: 0, paidCents: 0,
      dueCents: 0, legacyUnverified: 0, receivedCents: 0, customerPendingCents: 0, services: [],
    };
    const earned = commissionCents(item);
    current.services.push({...item, earnedCents:earned, paid:item.paidCents !== null});
    current.completed++;
    current.grossCents += item.priceCents;
    if (item.paymentMethod) current.receivedCents += item.priceCents;
    else current.customerPendingCents += item.priceCents;
    current.earnedCents += earned;
    current.paidCents += item.paidCents ?? 0;
    current.dueCents += item.paidCents === null ? earned : 0;
    if (item.paidCents === null) current.pendingServices++;
    if (item.legacyUnverified) current.legacyUnverified++;
    summaries.set(item.professionalId, current);
  }
  const batches = db.prepare(`SELECT b.id, b.period, b.total_cents AS totalCents,
    b.paid_at AS paidAt, u.name AS professionalName FROM payout_batches b
    JOIN users u ON u.id = b.professional_id AND u.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? AND b.period = ? ORDER BY b.paid_at DESC`)
    .all(tenant(req), period);
  res.setHeader("Cache-Control", "no-store");
  res.json({ period, start: data.window.start, end: data.window.end,
    professionals: [...summaries.values()], batches });
});
app.get("/api/settlements/export.csv", requireAuth, allowRoles("dono"), (req, res) => {
  const period = String(req.query.period ?? "");
  const data = fortnightServices(tenant(req), period);
  if (!data) return fail(res, 400, "Quinzena inválida.");
  sendCsv(res, `saldos-profissionais-${period}.csv`,
    ["Data do atendimento", "Data do crédito", "Profissional", "Serviço", "Cliente", "Valor bruto (centavos)", "Comissão efetiva (%)", "Comissão líquida (centavos)", "Repasse confirmado", "Lançamento antigo a conferir"],
    data.items.map(row => [row.startsAt, row.earnedOn, row.professionalName, row.serviceName, row.clientName, row.priceCents, Math.max(0,row.commissionPercent-row.houseSharePercent),
      commissionCents(row), row.paidCents === null ? "Não" : "Sim", row.legacyUnverified ? "Sim" : "Não"]));
});
app.post("/api/settlements", requireAuth, allowRoles("dono"), (req, res) => {
  const period = String(req.body?.period ?? "");
  const professionalId = String(req.body?.professionalId ?? "");
  const data = fortnightServices(tenant(req), period);
  if (!data) return fail(res, 400, "Quinzena inválida.");
  if (data.window.end >= cashDay(tenant(req)))
    return fail(res, 409, "A quinzena ainda não terminou. O repasse só pode ser confirmado após o encerramento do período.");
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional'")
    .get(professionalId, tenant(req))) return fail(res, 404, "Profissional não encontrado.");
  const batchId = createId();
  const result = db.transaction(() => {
    const pending = fortnightServices(tenant(req), period).items
      .filter(row => row.professionalId === professionalId && row.paidCents === null);
    if (!pending.length) return null;
    const amount = pending.reduce((sum, row) => sum + commissionCents(row), 0);
    if (req.body?.expectedTotalCents !== undefined && req.body.expectedTotalCents !== amount) return "changed";
    const business = db.prepare("SELECT business_name AS name FROM business_settings WHERE tenant_id=?").get(tenant(req));
    const snapshot = {businessName:business?.name || "Estabelecimento", professionalName:pending[0].professionalName,
      administratorName:req.user.name, start:data.window.start, end:data.window.end, paidOn:cashDay(tenant(req)),
      services:pending.map(row=>({...row,earnedCents:commissionCents(row)}))};
    db.prepare(`INSERT INTO payout_batches (id, tenant_id, professional_id, period, total_cents, created_by, receipt_snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(batchId, tenant(req), professionalId, period, amount, req.user.id, JSON.stringify(snapshot));
    const add = db.prepare(`INSERT INTO commission_payments (appointment_id, tenant_id, professional_id, amount_cents, batch_id, transfer_confirmed)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(appointment_id) DO UPDATE SET amount_cents = excluded.amount_cents,
      batch_id = excluded.batch_id, paid_at = datetime('now'), transfer_confirmed = 1
      WHERE commission_payments.tenant_id = excluded.tenant_id AND commission_payments.transfer_confirmed = 0`);
    for (const row of pending) {
      const updated = add.run(row.id, tenant(req), professionalId, commissionCents(row), batchId);
      if (updated.changes !== 1) throw new Error("Conflito ao registrar o repasse.");
    }
    return { id: batchId, totalCents: amount, count: pending.length };
  })();
  if (result === "changed") return fail(res, 409, "O saldo mudou. Atualize a conferência antes de confirmar o repasse.");
  if (!result) return fail(res, 409, "Sem saldo pendente para esse profissional na quinzena.");
  res.status(201).json({ batch: result, message: "Repasse efetivo confirmado e registrado; nenhuma transferência automática foi realizada." });
});

app.get("/api/settlements/:id/pdf", requireAuth, allowRoles("dono"), (req,res) => {
  const batch = db.prepare(`SELECT b.id, b.period, b.total_cents AS totalCents, b.paid_at AS paidAt,
    b.receipt_snapshot_json AS snapshotJson, b.professional_id AS professionalId,
    u.name AS professionalName, admin.name AS administratorName
    FROM payout_batches b JOIN users u ON u.id=b.professional_id AND u.tenant_id=b.tenant_id
    JOIN users admin ON admin.id=b.created_by AND admin.tenant_id=b.tenant_id
    WHERE b.id=? AND b.tenant_id=?`).get(req.params.id,tenant(req));
  if (!batch) return fail(res,404,"Repasse não encontrado.");
  const window = fortnightWindow(batch.period);
  let snapshot;
  if (batch.snapshotJson) snapshot = JSON.parse(batch.snapshotJson);
  else {
    const business = db.prepare("SELECT business_name AS name FROM business_settings WHERE tenant_id=?").get(tenant(req));
    const services = db.prepare(`SELECT a.price_cents AS priceCents, a.commission_percent AS commissionPercent,
      a.house_share_percent AS houseSharePercent, COALESCE(a.completed_on,substr(a.starts_at,1,10)) AS earnedOn,
      s.name AS serviceName,c.name AS clientName, cp.amount_cents AS earnedCents
      FROM commission_payments cp JOIN appointments a ON a.id=cp.appointment_id AND a.tenant_id=cp.tenant_id
      JOIN services s ON s.id=a.service_id AND s.tenant_id=a.tenant_id
      JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id
      WHERE cp.batch_id=? AND cp.tenant_id=? AND cp.professional_id=? AND cp.transfer_confirmed=1
      ORDER BY earnedOn,a.id`).all(batch.id,tenant(req),batch.professionalId);
    snapshot = {businessName:business?.name || "Estabelecimento",professionalName:batch.professionalName,
      administratorName:batch.administratorName,start:window.start,end:window.end,services};
  }
  const brl = cents => "R$ " + (Number(cents)/100).toFixed(2).replace(".",",");
  const date = value => String(value).slice(0,10).split("-").reverse().join("/");
  const gross = snapshot.services.reduce((sum,row)=>sum+row.priceCents,0);
  const lines = ["SIMPLIFICA AGENDA | DEMONSTRATIVO DE REPASSE QUINZENAL",
    "==========================================================================",
    "Estabelecimento: "+snapshot.businessName,"Profissional: "+snapshot.professionalName,
    "Periodo: "+date(snapshot.start)+" a "+date(snapshot.end),"Protocolo: "+batch.id,
    "Pagamento registrado em: "+date(snapshot.paidOn || batch.paidAt),"Responsavel: "+snapshot.administratorName,
    "--------------------------------------------------------------------------","SERVICOS INCLUIDOS NESTE REPASSE"];
  for (const [i,row] of snapshot.services.entries()) {
    lines.push((i+1)+". "+date(row.earnedOn)+" | "+row.serviceName+" | Cliente: "+row.clientName,
      "   Valor: "+brl(row.priceCents)+" | Comissao: "+Math.max(0,row.commissionPercent-row.houseSharePercent)+"% | Repasse: "+brl(row.earnedCents),
      "   Comissao base: "+row.commissionPercent+"% | Retencao: "+row.houseSharePercent+" pontos percentuais");
  }
  lines.push("--------------------------------------------------------------------------","Quantidade de servicos: "+snapshot.services.length,
    "Valor bruto dos servicos: "+brl(gross),"TOTAL REPASSADO AO PROFISSIONAL: "+brl(batch.totalCents),
    "Repasse confirmado pela administracao. O sistema nao realiza transferencias.",
    ...(batch.snapshotJson?[]:["Registro anterior: nomes e detalhes reconstituidos do cadastro atual."]));
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`${req.query.download==="1"?"attachment":"inline"}; filename="repasse-${batch.period}-${batch.id}.pdf"`);
  res.send(textPdf(lines));
});

app.get("/api/professional/my-services", requireAuth, allowRoles("profissional"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const rows = appointmentRows(tenant(req),
    `AND a.professional_id = ? AND CASE WHEN a.status = 'concluido'
      THEN ${appointmentCompletionMonth} ELSE substr(a.starts_at, 1, 7) END = ?`,
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
  if (!requireOpenCash(req, res)) return;
  const appointment = db.prepare(`
    SELECT id, status, starts_at AS startsAt FROM appointments
    WHERE id = ? AND tenant_id = ? AND professional_id = ?
  `).get(req.params.id, tenant(req), req.user.id);
  if (!appointment) return fail(res, 404, "Atendimento não encontrado na sua agenda.");
  if (!["agendado", "confirmado"].includes(appointment.status)) {
    return fail(res, 409, "Este atendimento não pode ser concluído novamente.");
  }
  // Explicit confirmation in the professional UI permits a service performed ahead of schedule.
  // Completion is always restricted to the assigned professional and recorded as unpaid.
  const beforeAudit = auditSnapshot(tenant(req), appointment.id);
  const result = db.prepare(`
    UPDATE appointments SET status = 'concluido', completed_on = ?
    WHERE id = ? AND tenant_id = ? AND professional_id = ?
    AND status IN ('agendado', 'confirmado')
  `).run(cashDay(tenant(req)), appointment.id, tenant(req), req.user.id);
  if (!result.changes) return fail(res, 409, "Atendimento já atualizado.");
  recordAppointmentAudit(tenant(req), appointment.id, "conclusao", req.user, beforeAudit);
  res.json({ ok: true });
});

function serviceTerms(tenantId, serviceId, professionalId) {
  return db.prepare(`
    SELECT s.duration_minutes AS duration, s.price_cents AS price,
      CASE WHEN s.commission_mode = 'custom' THEN 'servico' WHEN psc.professional_id IS NOT NULL THEN 'personalizada' ELSE 'profissional' END AS ruleSource,
      CASE WHEN s.commission_mode = 'custom' THEN s.service_commission_percent ELSE COALESCE(psc.commission_percent,u.commission_percent) END AS commission,
      CASE WHEN s.commission_mode = 'custom' THEN s.house_share_percent ELSE COALESCE(psc.house_share_percent,s.house_share_percent) END AS houseShare
    FROM services s
    JOIN users u ON u.tenant_id = s.tenant_id AND u.role = 'profissional'
    LEFT JOIN professional_service_commissions psc ON psc.tenant_id=s.tenant_id AND psc.service_id=s.id AND psc.professional_id=u.id
    WHERE s.tenant_id = ? AND s.id = ? AND u.id = ? AND s.active = 1 AND u.active = 1
  `).get(tenantId, serviceId, professionalId);
}

app.get("/api/commission-preview", requireAuth, allowRoles("dono"), (req, res) => {
  const terms = serviceTerms(tenant(req), String(req.query.serviceId ?? ""), String(req.query.professionalId ?? ""));
  if (!terms) return fail(res, 404, "Serviço ou profissional ativo não encontrado.");
  res.json({ priceCents: terms.price, commissionPercent: terms.commission, houseSharePercent: terms.houseShare,
    ruleSource: terms.ruleSource, earnedCents: commissionCents({priceCents:terms.price,commissionPercent:terms.commission,houseSharePercent:terms.houseShare}) });
});

app.post("/api/direct-services", requireAuth, allowRoles("dono", "profissional", "recepcao"), (req, res) => {
  const { clientId, professionalId, serviceId } = req.body ?? {};
  if (!professionalId || !serviceId) return fail(res, 400, "Informe o serviço e o profissional.");
  if (req.user.role === "profissional" && professionalId !== req.user.id)
    return fail(res, 403, "Registre somente seus próprios serviços.");
  const method = req.body?.paymentMethod ?? "";
  if (method !== "" && !paymentMethods.includes(method)) return fail(res, 400, "Forma de pagamento inválida.");
  if (method && req.user.role === "profissional") return fail(res, 403, "O recebimento deve ser registrado pelo caixa.");
  if (!requireOpenCash(req, res)) return;
  const business = tenant(req);
  const chosen = serviceTerms(business, serviceId, professionalId);
  const client = clientId ? db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(clientId, business) : null;
  if (!chosen || (clientId && !client)) return fail(res, 400, "Cliente, serviço ou profissional inválido.");
  const id = createId();
  const finishedAt = localNow(business);
  const day = finishedAt.slice(0, 10);
  db.transaction(() => {
    const resolvedClientId = client?.id ?? createId();
    if (!client) db.prepare("INSERT INTO clients (id, tenant_id, name, notes) VALUES (?, ?, ?, ?)")
      .run(resolvedClientId, business, "Cliente não informado", "__internal_anonymous__");
    db.prepare(`INSERT INTO appointments
      (id, tenant_id, client_id, professional_id, service_id, starts_at, ends_at, status,
       price_cents, commission_percent, house_share_percent, notes, booking_source, completed_on, payment_method, paid_on, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'concluido', ?, ?, ?, ?, 'direct', ?, ?, ?, ?)`)
      .run(id, business, resolvedClientId, professionalId, serviceId,
        addLocalMinutes(finishedAt, -chosen.duration), finishedAt, chosen.price, chosen.commission, chosen.houseShare,
        String(req.body?.notes ?? "").trim(), day, method, method ? day : null, method ? new Date().toISOString() : null);
    recordAppointmentAudit(business, id, "servico_avulso", req.user);
  })();
  res.status(201).json({ id, completedOn: day });
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
  const chosen = serviceTerms(tenant(req), serviceId, professionalId);
  const client = clientId ? db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(clientId, tenant(req)) : null;
  if (!chosen || (clientId && !client)) return fail(res, 400, "Cliente, serviço ou profissional inválido.");
  const normalizedStart = startsAt.length === 16 ? `${startsAt}:00` : startsAt;
  if (normalizedStart <= localNow(tenant(req))) return fail(res, 400, "Escolha um horário futuro.");
  const endsAt = addLocalMinutes(normalizedStart, chosen.duration);
  if (!withinWorkingHours(tenant(req), professionalId, normalizedStart, endsAt)) {
    return fail(res, 400, "O horário está fora do expediente deste profissional.");
  }
  const id = createId();
  const accessToken = crypto.randomBytes(32).toString("hex");
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
         price_cents, commission_percent, house_share_percent, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenant(req), resolvedClientId, professionalId, serviceId, normalizedStart, endsAt,
      chosen.price, chosen.commission, chosen.houseShare, String(req.body?.notes ?? "").trim());
    return true;
  });
  if (!create()) return;
  recordAppointmentAudit(tenant(req), id, "criacao", req.user);
  res.status(201).json({ id });
});

app.patch("/api/appointments/:id", requireAuth, allowRoles("dono", "profissional", "recepcao"), async (req, res) => {
  const appointment = db.prepare(`
    SELECT id, client_id AS clientId, professional_id AS professionalId, service_id AS serviceId,
      starts_at AS startsAt, ends_at AS endsAt, status, price_cents AS priceCents,
      payment_method AS paymentMethod, paid_on AS paidOn, completed_on AS completedOn, commission_percent AS commissionPercent, house_share_percent AS houseSharePercent, notes,
      booking_source AS bookingSource, (${completedEarlySql}) AS completedEarly
    FROM appointments a WHERE id = ? AND tenant_id = ?
  `).get(req.params.id, tenant(req));
  if (!appointment) return fail(res, 404, "Atendimento não encontrado.");
  if (req.user.role === "profissional" && appointment.professionalId !== req.user.id) {
    return fail(res, 403, "Este atendimento não pertence à sua agenda.");
  }
  if (req.user.role === "profissional") {
    return fail(res, 403, "Para registrar um serviço, utilize a opção Concluir atendimento em Meus atendimentos.");
  }
  if (appointment.paymentMethod === "pacote" || db.prepare("SELECT 1 FROM loyalty_redemptions WHERE appointment_id=? AND tenant_id=?").get(appointment.id,tenant(req)))
    return fail(res,409,"Atendimento com benefício já utilizado. Não é possível alterar diretamente.");
  if (db.prepare("SELECT 1 FROM commission_payments WHERE appointment_id = ? AND tenant_id = ?").get(appointment.id, tenant(req))) {
    return fail(res, 409, "Comissão já paga. Não é permitido alterar este serviço sem estorno auditado.");
  }
  const clientId = req.body?.clientId ?? appointment.clientId;
  if (typeof clientId !== "string" || !clientId) return fail(res, 400, "Cliente inválido.");
  const clientChanged = clientId !== appointment.clientId;
  if (clientChanged && !["agendado", "confirmado"].includes(appointment.status))
    return fail(res, 409, "A troca de cliente está disponível para atendimentos agendados ou confirmados.");
  const replacementClient = clientChanged
    ? db.prepare("SELECT id, phone FROM clients WHERE id = ? AND tenant_id = ? AND notes != '__internal_anonymous__'").get(clientId, tenant(req))
    : null;
  if (clientChanged && !replacementClient) return fail(res, 400, "Cliente inválido.");
  const resetConsent = clientChanged && appointment.bookingSource === "public";
  const status = req.body?.status ?? appointment.status;
  if (appointment.bookingSource === "direct" && (status !== "concluido" || (req.body?.startsAt !== undefined && req.body.startsAt !== appointment.startsAt)))
    return fail(res, 409, "Serviço registrado diretamente não pode ser convertido em agendamento.");
  const method = req.body?.paymentMethod === undefined ? appointment.paymentMethod : req.body.paymentMethod;
  const priceCents = req.body?.priceCents === undefined ? appointment.priceCents : Number(req.body.priceCents);
  if (!statuses.includes(status)) return fail(res, 400, "Status inválido.");
  if (method && !paymentMethods.includes(method)) return fail(res, 400, "Forma de pagamento inválida.");
  if (!Number.isInteger(priceCents) || priceCents < 0) return fail(res, 400, "Valor inválido.");
  if (((status === "concluido" && appointment.status !== "concluido") || (!appointment.paymentMethod && Boolean(method))) && !requireOpenCash(req, res)) return;
  if (appointment.paidOn && cashClosing(tenant(req), appointment.paidOn)
      && (method !== appointment.paymentMethod || priceCents !== appointment.priceCents || status !== appointment.status))
    return fail(res, 409, "Pagamento de caixa já fechado não pode ser alterado.");
  if (appointment.paymentMethod && status !== "concluido")
    return fail(res, 409, "Não é possível retirar a conclusão de um serviço já recebido.");
  if (appointment.paymentMethod && method !== appointment.paymentMethod)
    return fail(res, 409, "O pagamento registrado não pode ser alterado diretamente.");
  if (!appointment.paymentMethod && method && status !== "concluido")
    return fail(res, 409, "Apenas atendimentos concluídos podem receber pagamento.");
  if (!appointment.paymentMethod && method && cashClosing(tenant(req), cashDay(tenant(req))))
    return fail(res, 409, "O caixa de hoje está fechado.");

  let startsAt = appointment.startsAt;
  let endsAt = appointment.endsAt;
  if (req.body?.startsAt !== undefined) {
    if (!validDateTime(req.body.startsAt)) return fail(res, 400, "Novo horário inválido.");
    const service = db.prepare("SELECT duration_minutes FROM services WHERE id = ? AND tenant_id = ?")
      .get(appointment.serviceId, tenant(req));
    const requestedStart = req.body.startsAt.length === 16 ? `${req.body.startsAt}:00` : req.body.startsAt;
    // Saving a completed service or its payment must never trigger a new scheduling
    // validation just because the form sent back the original date/time.
    if (requestedStart !== appointment.startsAt) {
      startsAt = requestedStart;
      endsAt = addLocalMinutes(startsAt, service.duration_minutes);
      if (startsAt <= localNow(tenant(req))) return fail(res, 400, "Escolha um horário futuro.");
      if (!withinWorkingHours(tenant(req), appointment.professionalId, startsAt, endsAt)) {
        return fail(res, 400, "O horário está fora do expediente deste profissional.");
      }
    }
  }
  const wasAvailable = appointment.completedEarly || ["cancelado", "faltou"].includes(appointment.status);
  const restoresSlot = wasAvailable && ["agendado", "confirmado"].includes(status);
  const update = db.transaction(() => {
    if (!appointment.paymentMethod && method && cashClosing(tenant(req), cashDay(tenant(req)))) return "closed";
    if ((startsAt !== appointment.startsAt || restoresSlot) && scheduleConflict(res, {
      tenantId: tenant(req),
      professionalId: appointment.professionalId,
      startsAt,
      endsAt,
      excludeAppointmentId: appointment.id,
    })) return false;
    db.prepare(`
      UPDATE appointments SET starts_at = ?, ends_at = ?, status = ?,
        client_id = ?, whatsapp_opt_in = CASE WHEN ? THEN 0 ELSE whatsapp_opt_in END,
        completed_on = CASE WHEN ? != 'concluido' THEN NULL
           WHEN status != 'concluido' THEN ? ELSE completed_on END,
        payment_method = ?, paid_on = CASE WHEN payment_method = '' AND ? != '' THEN ? ELSE paid_on END,
        paid_at = CASE WHEN payment_method = '' AND ? != '' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE paid_at END,
        price_cents = ?, notes = ?
      WHERE id = ? AND tenant_id = ?
    `).run(startsAt, endsAt, status, clientId, resetConsent ? 1 : 0, status, cashDay(tenant(req)), method || "", method || "", cashDay(tenant(req)), method || "",
      priceCents, req.body?.notes === undefined ? appointment.notes : String(req.body.notes),
      appointment.id, tenant(req));
    const updated = auditSnapshot(tenant(req), appointment.id);
    if (JSON.stringify(updated) !== JSON.stringify(auditSnapshotFromOriginal(appointment)) || (req.body?.notes !== undefined && String(req.body.notes) !== appointment.notes)) {
      recordAppointmentAudit(tenant(req), appointment.id, appointment.startsAt !== updated.startsAt ? "remarcacao" : appointment.status !== updated.status ? "status" : appointment.paymentMethod !== updated.paymentMethod ? "pagamento" : "edicao", req.user, appointment);
    }
    const shouldNotify = appointment.bookingSource === "public" && status !== appointment.status
      && ["confirmado", "cancelado"].includes(status);
    return { noticeId: shouldNotify ? recordWhatsAppStatusChange(tenant(req), appointment.id, status) : null };
  });
  const result = update();
  if (result === "closed") return fail(res, 409, "O caixa de hoje já está fechado.");
  if (!result) return;
  const whatsappState = result.noticeId
    ? await dispatchWhatsAppStatusChange(result.noticeId, tenant(req), appointment.id, status)
    : null;
  res.json({ ok: true, whatsappState, ...(clientChanged ? {
    appointment: appointmentRows(tenant(req), "AND a.id = ?", [appointment.id])[0],
  } : {}) });
});

app.post("/api/blocked-slots", requireAuth, allowRoles("dono", "recepcao", "profissional"), (req, res) => {
  const requestedStart = String(req.body?.startsAt ?? "");
  const requestedEnd = String(req.body?.endsAt ?? "");
  if (!validDateTime(requestedStart) || !validDateTime(requestedEnd)) {
    return fail(res, 400, "Informe um período de bloqueio válido.");
  }
  const startsAt = requestedStart.length === 16 ? requestedStart + ":00" : requestedStart;
  const endsAt = requestedEnd.length === 16 ? requestedEnd + ":00" : requestedEnd;
  if (startsAt >= endsAt) return fail(res, 400, "O horário final do bloqueio deve ser posterior ao inicial.");
  if (startsAt < localNow(tenant(req))) return fail(res, 400, "Bloqueios só podem começar no presente ou futuro.");
  const professionalId = req.user.role === "profissional" ? req.user.id : (req.body?.professionalId || null);
  if (req.user.role === "profissional" && req.body?.professionalId && req.body.professionalId !== req.user.id) return fail(res, 403, "Você só pode bloquear a própria agenda.");
  if (professionalId && !db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'profissional'")
    .get(professionalId, tenant(req))) return fail(res, 400, "Profissional inválido.");
  const conflict = db.prepare(`
    SELECT id FROM appointments a WHERE tenant_id = ?
      AND booking_source != 'direct'
      AND status NOT IN ('cancelado', 'faltou')
      AND NOT (${completedEarlySql})
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

// Validated raster logos are backed up with the SQLite database.
const logoTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
function validLogo(bytes, type) {
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (type === "image/webp") return bytes.length >= 12 && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  return false;
}
app.post("/api/settings/logo", requireAuth, allowRoles("dono"), (req, res) => {
  const raw = String(req.body?.image ?? "");
  const match = raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !logoTypes.has(match[1]) || match[2].length > 700000) {
    return fail(res, 400, "Escolha uma imagem PNG, JPG ou WebP de até 500 KB.");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 500 * 1024 || !validLogo(bytes, match[1]))
    return fail(res, 400, "Imagem inválida ou maior que 500 KB.");
  const company = db.prepare("SELECT slug FROM tenants WHERE id = ?").get(tenant(req));
  if (!company) return fail(res, 404, "Estabelecimento não encontrado.");
  const updated = Date.now();
  const url = "/api/public/" + encodeURIComponent(company.slug) + "/logo?v=" + updated;
  db.transaction(() => {
    db.prepare("INSERT INTO business_logos (tenant_id, image_type, image_blob, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET image_type=excluded.image_type, image_blob=excluded.image_blob, updated_at=excluded.updated_at")
      .run(tenant(req), match[1], bytes, updated);
    db.prepare("UPDATE business_settings SET logo_url = ? WHERE tenant_id = ?").run(url, tenant(req));
  })();
  res.setHeader("Cache-Control", "no-store");
  res.json({ logoUrl: url });
});
app.delete("/api/settings/logo", requireAuth, allowRoles("dono"), (req, res) => {
  db.transaction(() => {
    db.prepare("DELETE FROM business_logos WHERE tenant_id = ?").run(tenant(req));
    db.prepare("UPDATE business_settings SET logo_url = '' WHERE tenant_id = ?").run(tenant(req));
  })();
  res.json({ logoUrl: "" });
});
app.get("/api/public/:slug/logo", (req, res) => {
  const logo = db.prepare("SELECT l.image_type AS imageType, l.image_blob AS imageBlob FROM tenants t JOIN business_logos l ON l.tenant_id = t.id WHERE t.slug = ?").get(req.params.slug);
  if (!logo) return res.sendStatus(404);
  res.setHeader("Content-Type", logo.imageType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(logo.imageBlob);
});

app.get("/api/settings", requireAuth, (req, res) => {
  const settings = db.prepare(`SELECT business_name AS businessName, logo_url AS logoUrl, address, phone, whatsapp, timezone, theme,
    booking_min_notice_minutes AS bookingMinNoticeMinutes, booking_max_days AS bookingMaxDays,
    booking_slot_interval_minutes AS bookingSlotIntervalMinutes, booking_cancellation_hours AS bookingCancellationHours,
    booking_allow_cancellation AS bookingAllowCancellation FROM business_settings WHERE tenant_id = ?`)
    .get(tenant(req));
  const hours = db.prepare("SELECT weekday, opens_at AS opensAt, closes_at AS closesAt FROM business_hours WHERE tenant_id = ? ORDER BY weekday")
    .all(tenant(req));
  res.json({ settings, hours });
});

app.patch("/api/settings/booking", requireAuth, allowRoles("dono"), (req, res) => {
  const min = Number(req.body?.bookingMinNoticeMinutes);
  const max = Number(req.body?.bookingMaxDays);
  const interval = Number(req.body?.bookingSlotIntervalMinutes);
  const cancel = Number(req.body?.bookingCancellationHours);
  if (!Number.isInteger(min) || min < 0 || min > 10080 ||
      !Number.isInteger(max) || max < 1 || max > 365 ||
      ![15,30,60].includes(interval) || !Number.isInteger(cancel) || cancel < 0 || cancel > 168)
    return fail(res, 400, "Revise as regras de agendamento.");
  db.prepare(`UPDATE business_settings SET booking_min_notice_minutes = ?, booking_max_days = ?,
    booking_slot_interval_minutes = ?, booking_cancellation_hours = ?, booking_allow_cancellation = ?
    WHERE tenant_id = ?`).run(min,max,interval,cancel,req.body?.bookingAllowCancellation === false ? 0 : 1,tenant(req));
  res.json({ ok: true });
});

app.put("/api/settings", requireAuth, allowRoles("dono"), (req, res) => {
  const businessName = requiredText(req.body?.businessName, "Nome do negócio");
  const theme = req.body?.theme === "escuro" ? "escuro" : "claro";
  const rawWhatsApp = String(req.body?.whatsapp ?? "").trim();
  const whatsapp = rawWhatsApp.replace(/[^\d]/g, "");
  if (rawWhatsApp && !/^(?:55)?\d{10,11}$/.test(whatsapp))
    return fail(res, 400, "WhatsApp inválido. Informe DDD e número brasileiro.");
  const phone = String(req.body?.phone ?? "").trim();
  if (phone.length > 40) return fail(res, 400, "Telefone inválido.");
  const address = String(req.body?.address ?? "").trim();
  if (address.length > 300) return fail(res, 400, "Endereço muito longo.");

  const update = db.transaction(() => {
    db.prepare(`
      UPDATE business_settings SET business_name = ?, address = ?,
        phone = ?, whatsapp = ?, theme = ? WHERE tenant_id = ?
    `).run(businessName, address, phone, whatsapp, theme, tenant(req));
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


function cashDay(tenantId) { return localNow(tenantId).slice(0, 10); }
function validCashDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}


function cashState(tenantId) {
  const date = cashDay(tenantId);
  if (cashClosing(tenantId, date)) return {date,state:"closed"};
  if (cashOpening(tenantId, date)) return {date,state:"open"};
  return {date,state:"unopened"};
}
function requireOpenCash(req, res) {
  const state = cashState(tenant(req));
  if (state.state === "open") return true;
  fail(res, 409, state.state === "closed"
    ? "O caixa de hoje já está fechado."
    : "Abra o caixa em Caixa e recebimentos antes de concluir serviços ou registrar pagamentos.");
  return false;
}
function cashMovements(tenantId, date) {
  const rows = db.prepare(`SELECT id, movement_type AS type, amount_cents AS amountCents,
    reason, created_by_name AS createdByName, created_at AS createdAt
    FROM daily_cash_movements WHERE tenant_id=? AND cash_date=? ORDER BY created_at,id`).all(tenantId,date);
  return {rows,
    supplyCents: rows.filter(r=>r.type==="suprimento").reduce((s,r)=>s+r.amountCents,0),
    withdrawalCents: rows.filter(r=>r.type==="sangria").reduce((s,r)=>s+r.amountCents,0)};
}
function cashOpening(tenantId, date) {
  return db.prepare(`SELECT id, cash_date AS cashDate, opening_cash_cents AS openingCashCents,
    opened_by_name AS openedByName, opened_at AS openedAt, notes
    FROM daily_cash_openings WHERE tenant_id = ? AND cash_date = ?`).get(tenantId, date) ?? null;
}
function cashClosing(tenantId, date) {
  return db.prepare("SELECT id FROM daily_cash_closings WHERE tenant_id = ? AND cash_date = ?").get(tenantId, date);
}
function cashDaySummary(tenantId, date) {
  const methods = Object.fromEntries(paymentMethods.map(method => [method, 0]));
  const rows = db.prepare(`SELECT a.id, a.price_cents AS priceCents, a.payment_method AS paymentMethod,
    a.paid_at AS paidAt, a.paid_on AS paidOn, a.starts_at AS startsAt, a.completed_on AS completedOn, a.booking_source AS bookingSource,
    c.name AS clientName, s.name AS serviceName, u.name AS professionalName
    FROM appointments a
    JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.paid_on = ? AND a.status = 'concluido' AND a.payment_method != ''
    ORDER BY a.paid_at DESC, a.id DESC`).all(tenantId, date);
  rows.push(...db.prepare(`SELECT s.id, s.total_cents AS priceCents,s.payment_method AS paymentMethod,s.paid_at AS paidAt,
    s.paid_on AS paidOn,s.paid_at AS startsAt,'product_sale' AS bookingSource,s.client_name AS clientName,
    'Venda de produtos: ' || (SELECT group_concat(i.quantity || ' × ' || i.product_name, ', ') FROM product_sale_items i WHERE i.sale_id=s.id) AS serviceName,
    s.seller_name AS professionalName FROM product_sales s WHERE s.tenant_id=? AND s.paid_on=?`).all(tenantId,date));
  rows.push(...db.prepare(`SELECT id,price_cents AS priceCents,payment_method AS paymentMethod,paid_at AS paidAt,
    paid_on AS paidOn,paid_at AS startsAt,'package_sale' AS bookingSource,client_name AS clientName,
    'Pacote: '||package_name AS serviceName,seller_name AS professionalName FROM package_purchases WHERE tenant_id=? AND paid_on=?`).all(tenantId,date));
  rows.sort((a,b)=>String(b.paidAt||"").localeCompare(String(a.paidAt||""))||a.id.localeCompare(b.id));
  for (const row of rows) methods[row.paymentMethod] = (methods[row.paymentMethod] || 0) + row.priceCents;
  return { date, receiptCount: rows.length, methods, expectedCashCents: methods.dinheiro,
    expectedTotalCents: rows.reduce((sum, row) => sum + row.priceCents, 0), receipts: rows };
}
const expenseCategories = ["aluguel","energia","agua","internet","materiais","fornecedores","manutencao","marketing","impostos","outros"];
const expenseMethods = ["cash_drawer", ...paymentMethods, "boleto"];
function expenseCashFlow(tenantId, month) {
  const receivedCents = db.prepare("SELECT coalesce(sum(price_cents),0) AS total FROM appointments WHERE tenant_id=? AND status='concluido' AND payment_method!='' AND substr(paid_on,1,7)=?").get(tenantId,month).total + productSalesSummary(tenantId,month).revenueCents + packageRevenue(tenantId,month);
  const expensesCents = db.prepare("SELECT coalesce(sum(amount_cents),0) AS total FROM operating_expenses WHERE tenant_id=? AND status='pago' AND substr(paid_on,1,7)=?").get(tenantId,month).total;
  const timezone = db.prepare("SELECT timezone FROM business_settings WHERE tenant_id=?").get(tenantId)?.timezone || "America/Sao_Paulo";
  const payoutsCents = db.prepare(`SELECT cp.amount_cents AS amount, cp.paid_at AS paidAt, b.receipt_snapshot_json AS snapshot
    FROM commission_payments cp LEFT JOIN payout_batches b ON b.id=cp.batch_id AND b.tenant_id=cp.tenant_id
    WHERE cp.tenant_id=? AND cp.transfer_confirmed=1`).all(tenantId).reduce((sum,row)=>{
      let day;
      try { day=JSON.parse(row.snapshot)?.paidOn; } catch {}
      if (!day && row.paidAt) {
        const timestamp = new Date(row.paidAt.endsWith("Z") ? row.paidAt : row.paidAt.replace(" ","T")+"Z");
        if (!Number.isNaN(timestamp.getTime())) {
          const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(timestamp).map(p=>[p.type,p.value]));
          day=parts.year+"-"+parts.month+"-"+parts.day;
        }
      }
      return sum+(typeof day==="string"&&day.slice(0,7)===month?row.amount:0);
    },0);
  return {receivedCents,expensesCents,payoutsCents,balanceCents:receivedCents-expensesCents-payoutsCents};
}
function expenseFields(body) {
  const description=String(body?.description??"").trim(), category=String(body?.category??"");
  const expenseType=String(body?.expenseType??""), vendor=String(body?.vendor??"").trim(), notes=String(body?.notes??"").trim();
  const amountCents=body?.amountCents, dueOn=String(body?.dueOn??"");
  if (!description || description.length>200 || !expenseCategories.includes(category) || !["fixa","variavel"].includes(expenseType)
      || vendor.length>200 || notes.length>1000 || !Number.isSafeInteger(amountCents) || amountCents<=0 || amountCents>100000000000 || !validCashDate(dueOn)) return null;
  return {description,category,expenseType,vendor,notes,amountCents,dueOn};
}
app.get("/api/expenses", requireAuth, allowRoles("dono"), (req,res)=>{
  const id=tenant(req), today=cashDay(id), month=String(req.query.month??today.slice(0,7));
  if (!validMonth(month)) return fail(res,400,"Mês inválido.");
  const expenses=db.prepare(`SELECT id,description,category,expense_type AS expenseType,vendor,notes,amount_cents AS amountCents,
    due_on AS dueOn,status,paid_on AS paidOn,payment_method AS paymentMethod,cash_movement_id AS cashMovementId
    FROM operating_expenses WHERE tenant_id=? AND (status='pendente' OR substr(due_on,1,7)=? OR substr(paid_on,1,7)=?)
    ORDER BY CASE status WHEN 'pendente' THEN 0 WHEN 'pago' THEN 1 ELSE 2 END,due_on,id`).all(id,month,month);
  const pending=expenses.filter(row=>row.status==="pendente");
  res.setHeader("Cache-Control","no-store");
  res.json({month,today,expenses,cashFlow:expenseCashFlow(id,month),
    pendingCents:pending.reduce((s,r)=>s+r.amountCents,0),
    overdueCents:pending.filter(r=>r.dueOn<today).reduce((s,r)=>s+r.amountCents,0)});
});
app.post("/api/expenses", requireAuth, allowRoles("dono"), (req,res)=>{
  const fields=expenseFields(req.body);
  if (!fields) return fail(res,400,"Confira descrição, categoria, tipo, valor e vencimento.");
  const id=createId();
  db.prepare(`INSERT INTO operating_expenses (id,tenant_id,description,category,expense_type,vendor,notes,amount_cents,due_on,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id,tenant(req),fields.description,fields.category,fields.expenseType,fields.vendor,fields.notes,fields.amountCents,fields.dueOn,req.user.id);
  res.status(201).json({id});
});
app.patch("/api/expenses/:id", requireAuth, allowRoles("dono"), (req,res)=>{
  const fields=expenseFields(req.body);
  if (!fields) return fail(res,400,"Confira os dados da despesa.");
  const result=db.prepare(`UPDATE operating_expenses SET description=?,category=?,expense_type=?,vendor=?,notes=?,amount_cents=?,due_on=?
    WHERE id=? AND tenant_id=? AND status='pendente'`).run(fields.description,fields.category,fields.expenseType,fields.vendor,fields.notes,fields.amountCents,fields.dueOn,req.params.id,tenant(req));
  if (!result.changes) return fail(res,409,"Conta não disponível para edição.");
  res.json({ok:true});
});
app.post("/api/expenses/:id/cancel", requireAuth, allowRoles("dono"), (req,res)=>{
  const result=db.prepare("UPDATE operating_expenses SET status='cancelado',canceled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),canceled_by=? WHERE id=? AND tenant_id=? AND status='pendente'").run(req.user.id,req.params.id,tenant(req));
  if (!result.changes) return fail(res,409,"Conta não disponível para cancelamento.");
  res.json({ok:true});
});
app.post("/api/expenses/:id/pay", requireAuth, allowRoles("dono"), (req,res)=>{
  const id=tenant(req),today=cashDay(id),paidOn=String(req.body?.paidOn??""),method=String(req.body?.paymentMethod??"");
  if (!expenseMethods.includes(method)||!validCashDate(paidOn)||paidOn>today) return fail(res,400,"Informe a forma e a data real do pagamento.");
  if (method==="cash_drawer"&&paidOn!==today) return fail(res,400,"Dinheiro da gaveta só pode ser registrado no caixa do dia.");
  const outcome=db.transaction(()=>{
    const expense=db.prepare("SELECT * FROM operating_expenses WHERE id=? AND tenant_id=? AND status='pendente'").get(req.params.id,id);
    if (!expense) return "Conta não disponível para pagamento.";
    let movementId=null;
    if (method==="cash_drawer") {
      const opening=cashOpening(id,today);
      if (!opening||cashClosing(id,today)) return "Abra o caixa de hoje antes de pagar com dinheiro da gaveta.";
      const movements=cashMovements(id,today);
      if (expense.amount_cents>opening.openingCashCents+cashDaySummary(id,today).expectedCashCents+movements.supplyCents-movements.withdrawalCents) return "Dinheiro insuficiente na gaveta.";
      movementId=createId();
      db.prepare(`INSERT INTO daily_cash_movements (id,tenant_id,cash_date,movement_type,amount_cents,reason,created_by,created_by_name)
        VALUES (?,?,?,'sangria',?,?,?,?)`).run(movementId,id,today,expense.amount_cents,"Despesa: "+expense.description,req.user.id,req.user.name||"Usuário");
    }
    db.prepare("UPDATE operating_expenses SET status='pago',paid_on=?,payment_method=?,paid_by=?,cash_movement_id=? WHERE id=? AND tenant_id=?")
      .run(paidOn,method,req.user.id,movementId,expense.id,id);
    return null;
  })();
  if (outcome) return fail(res,409,outcome);
  res.json({ok:true});
});
function productSalesSummary(id,month) {
  const row=db.prepare("SELECT coalesce(sum(total_cents),0) AS revenueCents,coalesce(sum(cost_cents),0) AS costCents,count(*) AS count FROM product_sales WHERE tenant_id=? AND substr(paid_on,1,7)=?").get(id,month);
  return {...row,marginCents:row.revenueCents-row.costCents};
}
function packageRevenue(id,month){
  return db.prepare("SELECT coalesce(sum(price_cents),0) AS total FROM package_purchases WHERE tenant_id=? AND substr(paid_on,1,7)=?").get(id,month).total;
}
function packageItems(id){
  return db.prepare(`SELECT i.service_id AS serviceId,s.name AS serviceName,i.sessions,s.price_cents AS referenceCents,s.active AS serviceActive
    FROM service_package_items i JOIN services s ON s.id=i.service_id WHERE i.package_id=? ORDER BY i.service_id`).all(id);
}
function purchasedItems(id){
  return db.prepare(`SELECT i.service_id AS serviceId,i.service_name AS serviceName,i.sessions,i.allocation_cents AS allocationCents,
    (SELECT count(*) FROM package_redemptions r WHERE r.purchase_id=i.purchase_id AND r.service_id=i.service_id) AS used
    FROM package_purchase_items i WHERE i.purchase_id=? ORDER BY i.service_id`).all(id);
}
function purchaseRows(id,clientId=null){
  return db.prepare(`SELECT id,package_id AS packageId,package_name AS packageName,client_id AS clientId,client_name AS clientName,price_cents AS priceCents,
    expires_on AS expiresOn,paid_on AS paidOn,payment_method AS paymentMethod FROM package_purchases
    WHERE tenant_id=? AND (? IS NULL OR client_id=?) ORDER BY paid_on DESC,id`).all(id,clientId,clientId).map(p=>({...p,items:purchasedItems(p.id)}));
}
function loyaltySettings(id){
  return db.prepare("SELECT enabled,threshold,discount_cents AS discountCents FROM loyalty_settings WHERE tenant_id=?").get(id)||{enabled:0,threshold:10,discountCents:1000};
}
function loyaltyPoints(id,clientId){
  const earned=db.prepare(`SELECT count(*) AS n FROM appointments WHERE tenant_id=? AND client_id=? AND status='concluido'
    AND (payment_method='pacote' OR (payment_method!='' AND paid_on IS NOT NULL))`).get(id,clientId).n;
  const spent=db.prepare("SELECT coalesce(sum(points),0) AS n FROM loyalty_redemptions WHERE tenant_id=? AND client_id=?").get(id,clientId).n;
  return {earned,spent,balance:Math.max(0,earned-spent)};
}
app.get("/api/packages",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const id=tenant(req);
  const packages=db.prepare("SELECT id,name,price_cents AS priceCents,validity_days AS validityDays,active FROM service_packages WHERE tenant_id=? ORDER BY name").all(id).map(p=>({...p,items:packageItems(p.id)}));
  const purchases=purchaseRows(id), loyalty=loyaltySettings(id);
  const redemptions=db.prepare(`SELECT r.appointment_id AS appointmentId,r.redeemed_on AS redeemedOn,r.amount_cents AS amountCents,p.package_name AS packageName,p.client_name AS clientName,
    s.name AS serviceName,u.name AS professionalName FROM package_redemptions r JOIN package_purchases p ON p.id=r.purchase_id
    JOIN appointments a ON a.id=r.appointment_id JOIN services s ON s.id=a.service_id JOIN users u ON u.id=a.professional_id WHERE r.tenant_id=? ORDER BY r.redeemed_on DESC`).all(id);
  const clients=db.prepare("SELECT id,name FROM clients WHERE tenant_id=? AND notes!='__internal_anonymous__' ORDER BY name").all(id).map(c=>({...c,...loyaltyPoints(id,c.id)}));
  const rewards=db.prepare(`SELECT l.appointment_id AS appointmentId,l.points,l.discount_cents AS discountCents,l.redeemed_on AS redeemedOn,c.name AS clientName
    FROM loyalty_redemptions l JOIN clients c ON c.id=l.client_id WHERE l.tenant_id=? ORDER BY l.redeemed_on DESC`).all(id);
  res.setHeader("Cache-Control","no-store");res.json({packages,purchases,redemptions,loyalty,clients,rewards,today:cashDay(id)});
});
app.get("/api/packages/eligible",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  if(!getPlanAccess(tenant(req)).features.packages)return res.json({purchases:[],loyalty:null});
  const id=tenant(req),clientId=String(req.query.clientId??""),serviceId=String(req.query.serviceId??"");
  const client=db.prepare("SELECT id FROM clients WHERE id=? AND tenant_id=? AND notes!='__internal_anonymous__'").get(clientId,id);
  if(!client)return res.json({purchases:[],loyalty:null});
  const purchases=purchaseRows(id,clientId).filter(p=>p.expiresOn>=cashDay(id)&&p.items.some(i=>i.serviceId===serviceId&&i.used<i.sessions));
  res.json({purchases,loyalty:{...loyaltySettings(id),...loyaltyPoints(id,clientId)}});
});
function savePackage(req,res){
  const id=tenant(req),name=String(req.body?.name??"").trim(),{priceCents,validityDays,items}=req.body||{},active=req.body?.active===false?0:1;
  if(!name||name.length>120||!Number.isSafeInteger(priceCents)||priceCents<=0||priceCents>100000000||!Number.isSafeInteger(validityDays)||validityDays<1||validityDays>3650||
    !Array.isArray(items)||!items.length||items.length>30||items.some(i=>!i||typeof i.serviceId!=="string"||!Number.isSafeInteger(i.sessions)||i.sessions<1||i.sessions>100)||new Set(items.map(i=>i.serviceId)).size!==items.length)
    return fail(res,400,"Confira nome, valor, validade e sessões.");
  if(items.some(i=>!db.prepare("SELECT 1 FROM services WHERE id=? AND tenant_id=? AND active=1").get(i.serviceId,id)))return fail(res,400,"Selecione serviços ativos do estabelecimento.");
  const packageId=req.params.id||createId();
  if(req.params.id&&!db.prepare("SELECT 1 FROM service_packages WHERE id=? AND tenant_id=?").get(packageId,id))return fail(res,404,"Pacote não encontrado.");
  db.transaction(()=>{
    db.prepare(`INSERT INTO service_packages(id,tenant_id,name,price_cents,validity_days,active) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_cents=excluded.price_cents,validity_days=excluded.validity_days,active=excluded.active`).run(packageId,id,name,priceCents,validityDays,active);
    db.prepare("DELETE FROM service_package_items WHERE package_id=?").run(packageId);
    const add=db.prepare("INSERT INTO service_package_items(package_id,service_id,sessions) VALUES(?,?,?)");
    for(const i of items)add.run(packageId,i.serviceId,i.sessions);
  })();
  res.status(req.params.id?200:201).json({id:packageId});
}
app.post("/api/packages",requireAuth,allowRoles("dono"),savePackage);
app.patch("/api/packages/:id",requireAuth,allowRoles("dono"),savePackage);
app.post("/api/packages/:id/status",requireAuth,allowRoles("dono"),(req,res)=>{
  if(typeof req.body?.active!=="boolean")return fail(res,400,"Status inválido.");
  if(!db.prepare("UPDATE service_packages SET active=? WHERE id=? AND tenant_id=?").run(req.body.active?1:0,req.params.id,tenant(req)).changes)return fail(res,404,"Pacote não encontrado.");
  res.json({ok:true});
});
app.post("/api/packages/:id/sell",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const id=tenant(req),requestId=String(req.body?.requestId??""),clientId=String(req.body?.clientId??""),method=String(req.body?.paymentMethod??""),expectedPrice=req.body?.priceCents;
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)||!paymentMethods.includes(method)||!Number.isSafeInteger(expectedPrice))return fail(res,400,"Confira o cliente, preço e pagamento.");
  const outcome=db.transaction(()=>{
    const prior=db.prepare("SELECT id,package_id AS packageId,client_id AS clientId,payment_method AS method,price_cents AS price FROM package_purchases WHERE tenant_id=? AND request_id=?").get(id,requestId);
    if(prior)return prior.packageId===req.params.id&&prior.clientId===clientId&&prior.method===method&&prior.price===expectedPrice?{id:prior.id,replayed:true}:"Identificador de venda já utilizado.";
    const today=cashDay(id);
    if(!cashOpening(id,today)||cashClosing(id,today))return "Abra o caixa de hoje antes de vender o pacote.";
    const p=db.prepare("SELECT * FROM service_packages WHERE id=? AND tenant_id=? AND active=1").get(req.params.id,id);
    const c=db.prepare("SELECT id,name FROM clients WHERE id=? AND tenant_id=? AND notes!='__internal_anonymous__'").get(clientId,id);
    if(!p||!c||p.price_cents!==expectedPrice)return "Pacote ou cliente indisponível, ou preço alterado. Atualize a lista.";
    const items=packageItems(p.id);
    if(!items.length||items.some(i=>!i.serviceActive))return "O pacote contém serviços inativos.";
    const expiry=new Date(today+"T12:00:00Z");expiry.setUTCDate(expiry.getUTCDate()+p.validity_days-1);
    const purchaseId=createId();
    db.prepare(`INSERT INTO package_purchases(id,tenant_id,package_id,client_id,package_name,client_name,price_cents,expires_on,paid_on,payment_method,seller_name,created_by,request_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(purchaseId,id,p.id,c.id,p.name,c.name,p.price_cents,expiry.toISOString().slice(0,10),today,method,req.user.name||"Usuário",req.user.id,requestId);
    const weight=items.reduce((sum,i)=>sum+i.referenceCents*i.sessions,0);
    const sessions=items.reduce((sum,i)=>sum+i.sessions,0);
    let cumulative=0,allocated=0;
    const insert=db.prepare("INSERT INTO package_purchase_items(purchase_id,service_id,service_name,sessions,allocation_cents) VALUES(?,?,?,?,?)");
    for(const i of items){
      cumulative+=weight?i.referenceCents*i.sessions:i.sessions;
      const target=Math.round(p.price_cents*(cumulative/(weight||sessions)));
      insert.run(purchaseId,i.serviceId,i.serviceName,i.sessions,target-allocated);allocated=target;
    }
    return {id:purchaseId};
  })();
  if(typeof outcome==="string")return fail(res,409,outcome);
  res.status(outcome.replayed?200:201).json(outcome);
});
app.post("/api/packages/redeem/appointment/:id",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const id=tenant(req),purchaseId=String(req.body?.purchaseId??"");
  const result=db.transaction(()=>{
    const today=cashDay(id);
    if(!cashOpening(id,today)||cashClosing(id,today))return "Abra o caixa de hoje antes de concluir a sessão.";
    const a=db.prepare("SELECT * FROM appointments WHERE id=? AND tenant_id=?").get(req.params.id,id);
    if(!a||!["agendado","confirmado","concluido"].includes(a.status)||a.payment_method)return "Atendimento indisponível ou já recebido.";
    if(db.prepare("SELECT 1 FROM commission_payments WHERE appointment_id=? AND tenant_id=?").get(a.id,id))return "Comissão já repassada; não é possível alterar este serviço.";
    const p=db.prepare("SELECT id FROM package_purchases WHERE id=? AND tenant_id=? AND client_id=? AND expires_on>=?").get(purchaseId,id,a.client_id,today);
    const item=p&&purchasedItems(p.id).find(i=>i.serviceId===a.service_id&&i.used<i.sessions);
    if(!item)return "Pacote vencido, sem saldo ou incompatível com o cliente e serviço.";
    const amount=Math.round(item.allocationCents*(item.used+1)/item.sessions)-Math.round(item.allocationCents*item.used/item.sessions);
    const before=auditSnapshot(id,a.id);
    db.prepare("UPDATE appointments SET status='concluido',completed_on=coalesce(completed_on,?),price_cents=?,payment_method='pacote',paid_on=NULL,paid_at=NULL WHERE id=? AND tenant_id=?").run(today,amount,a.id,id);
    db.prepare("INSERT INTO package_redemptions(appointment_id,tenant_id,purchase_id,service_id,amount_cents,redeemed_on,created_by) VALUES(?,?,?,?,?,?,?)").run(a.id,id,p.id,a.service_id,amount,today,req.user.id);
    recordAppointmentAudit(id,a.id,"pagamento",req.user,before);
    return {ok:true,amountCents:amount};
  })();
  if(typeof result==="string")return fail(res,409,result);res.json(result);
});
app.put("/api/loyalty/settings",requireAuth,allowRoles("dono"),(req,res)=>{
  const {enabled,threshold,discountCents}=req.body||{};
  if(typeof enabled!=="boolean"||!Number.isSafeInteger(threshold)||threshold<1||threshold>1000||!Number.isSafeInteger(discountCents)||discountCents<1||discountCents>100000000)return fail(res,400,"Confira a configuração de fidelidade.");
  db.prepare(`INSERT INTO loyalty_settings(tenant_id,enabled,threshold,discount_cents) VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,threshold=excluded.threshold,discount_cents=excluded.discount_cents`).run(tenant(req),enabled?1:0,threshold,discountCents);
  res.json({ok:true});
});
app.post("/api/loyalty/redeem/:id",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const id=tenant(req),method=String(req.body?.paymentMethod??"");
  if(!paymentMethods.includes(method))return fail(res,400,"Informe a forma de pagamento da diferença.");
  const result=db.transaction(()=>{
    const today=cashDay(id),settings=loyaltySettings(id);
    if(!cashOpening(id,today)||cashClosing(id,today))return "Abra o caixa de hoje antes de registrar o pagamento.";
    const a=db.prepare("SELECT * FROM appointments WHERE id=? AND tenant_id=? AND status='concluido' AND payment_method=''").get(req.params.id,id);
    if(!a||!settings.enabled||!db.prepare("SELECT 1 FROM clients WHERE id=? AND tenant_id=? AND notes!='__internal_anonymous__'").get(a.client_id,id)||loyaltyPoints(id,a.client_id).balance<settings.threshold)return "Atendimento ou recompensa indisponível.";
    if(db.prepare("SELECT 1 FROM commission_payments WHERE appointment_id=? AND tenant_id=?").get(a.id,id))return "Comissão já repassada.";
    if(settings.discountCents>=a.price_cents)return "O desconto precisa ser menor que o valor do serviço.";
    const before=auditSnapshot(id,a.id);
    db.prepare("UPDATE appointments SET price_cents=price_cents-?,payment_method=?,paid_on=?,paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND tenant_id=?").run(settings.discountCents,method,today,a.id,id);
    db.prepare("INSERT INTO loyalty_redemptions(appointment_id,tenant_id,client_id,points,discount_cents,redeemed_on,created_by) VALUES(?,?,?,?,?,?,?)").run(a.id,id,a.client_id,settings.threshold,settings.discountCents,today,req.user.id);
    recordAppointmentAudit(id,a.id,"pagamento",req.user,before);return {ok:true};
  })();
  if(typeof result==="string")return fail(res,409,result);res.json(result);
});
const inventoryProductsSql="SELECT id,name,category,vendor,purpose,unit,cost_cents AS costCents,price_cents AS priceCents,quantity,minimum FROM inventory_products";
function productFields(body) {
  const name=String(body?.name??"").trim(),category=String(body?.category??"").trim(),vendor=String(body?.vendor??"").trim(),purpose=String(body?.purpose??""),unit=String(body?.unit??"un");
  const {costCents,priceCents,minimum}=body||{};
  if(!name||name.length>120||category.length>100||vendor.length>120||!["venda","consumo","ambos"].includes(purpose)||!["un","ml","g"].includes(unit)
    ||![costCents,priceCents,minimum].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000)
    ||(purpose!=="consumo"&&priceCents<=0))return null;
  return {name,category,vendor,purpose,unit,costCents,priceCents,minimum};
}
function inventoryMovement(req,product,delta,type,reason,saleId=null) {
  const balance=product.quantity+delta;
  db.prepare("UPDATE inventory_products SET quantity=? WHERE id=? AND tenant_id=?").run(balance,product.id,tenant(req));
  db.prepare(`INSERT INTO inventory_movements(id,tenant_id,product_id,type,delta,balance,reason,sale_id,created_by,actor_name,moved_on)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(createId(),tenant(req),product.id,type,delta,balance,reason,saleId,req.user.id,req.user.name||"Usuário",cashDay(tenant(req)));
}
app.get("/api/inventory",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const id=tenant(req),month=String(req.query.month??cashDay(id).slice(0,7));
  if(!validMonth(month))return fail(res,400,"Mês inválido.");
  const owner=req.user.role==="dono";
  const products=db.prepare(inventoryProductsSql+" WHERE tenant_id=? ORDER BY name COLLATE NOCASE").all(id).map(p=>owner?p:(({costCents,vendor,...rest})=>rest)(p));
  const movements=db.prepare(`SELECT m.id,p.name AS productName,p.unit,m.type,m.delta,m.balance,m.reason,m.actor_name AS actorName,m.moved_on AS movedOn
    FROM inventory_movements m JOIN inventory_products p ON p.id=m.product_id AND p.tenant_id=m.tenant_id
    WHERE m.tenant_id=? AND substr(m.moved_on,1,7)=? ORDER BY m.created_at DESC,m.id DESC`).all(id,month);
  const sales=db.prepare(`SELECT s.id,s.client_name AS clientName,s.seller_name AS sellerName,s.total_cents AS totalCents,s.cost_cents AS costCents,
    s.paid_on AS paidOn,s.payment_method AS paymentMethod FROM product_sales s WHERE s.tenant_id=? AND substr(s.paid_on,1,7)=? ORDER BY paid_at DESC`).all(id,month);
  const items=db.prepare("SELECT product_name AS name,quantity,price_cents AS priceCents FROM product_sale_items WHERE sale_id=?");
  res.setHeader("Cache-Control","no-store");
  res.json({month,products,movements,sales:sales.map(s=>({...s,costCents:owner?s.costCents:undefined,items:items.all(s.id)})),
    summary:owner?productSalesSummary(id,month):null});
});
app.post("/api/inventory/products",requireAuth,allowRoles("dono"),(req,res)=>{
  const p=productFields(req.body);if(!p)return fail(res,400,"Confira os dados do produto.");
  const id=createId();
  db.prepare("INSERT INTO inventory_products(id,tenant_id,name,category,vendor,purpose,unit,cost_cents,price_cents,minimum) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(id,tenant(req),p.name,p.category,p.vendor,p.purpose,p.unit,p.costCents,p.priceCents,p.minimum);
  res.status(201).json({id});
});
app.patch("/api/inventory/products/:id",requireAuth,allowRoles("dono"),(req,res)=>{
  const p=productFields(req.body);if(!p)return fail(res,400,"Confira os dados do produto.");
  const old=db.prepare(inventoryProductsSql+" WHERE id=? AND tenant_id=?").get(req.params.id,tenant(req));
  if(!old)return fail(res,404,"Produto não encontrado.");
  if(old.unit!==p.unit&&db.prepare("SELECT 1 FROM inventory_movements WHERE product_id=? AND tenant_id=? LIMIT 1").get(old.id,tenant(req)))return fail(res,409,"Não altere a unidade após movimentar o produto.");
  db.prepare("UPDATE inventory_products SET name=?,category=?,vendor=?,purpose=?,unit=?,cost_cents=?,price_cents=?,minimum=? WHERE id=? AND tenant_id=?")
    .run(p.name,p.category,p.vendor,p.purpose,p.unit,p.costCents,p.priceCents,p.minimum,old.id,tenant(req));
  res.json({ok:true});
});
app.post("/api/inventory/products/:id/movements",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const type=String(req.body?.type??""),quantity=req.body?.quantity,reason=String(req.body?.reason??"").trim();
  if(!["entrada","saida","ajuste","consumo"].includes(type)||!Number.isSafeInteger(quantity)||quantity<0||quantity>100000000||(!quantity&&type!=="ajuste")||!reason||reason.length>250)return fail(res,400,"Confira quantidade, tipo e motivo.");
  if(req.user.role!=="dono"&&type!=="consumo")return fail(res,403,"Somente o administrador pode ajustar o estoque.");
  const result=db.transaction(()=>{
    const p=db.prepare(inventoryProductsSql+" WHERE id=? AND tenant_id=?").get(req.params.id,tenant(req));
    if(!p)return "Produto não encontrado.";
    if(type==="consumo"&&p.purpose==="venda")return "Produto não destinado ao consumo interno.";
    const delta=type==="ajuste"?quantity-p.quantity:type==="entrada"?quantity:-quantity;
    if(!delta||p.quantity+delta<0||p.quantity+delta>100000000)return "Saldo inválido ou insuficiente.";
    inventoryMovement(req,p,delta,type,reason);return null;
  })();
  if(result)return fail(res,409,result);
  res.status(201).json({ok:true});
});
app.post("/api/inventory/sales",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const requestId=String(req.body?.requestId??""),method=String(req.body?.paymentMethod??""),clientName=String(req.body?.clientName??"").trim()||"Consumidor";
  const items=req.body?.items;
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)||!paymentMethods.includes(method)||clientName.length>120||!Array.isArray(items)||!items.length||items.length>50||
    items.some(i=>!i||typeof i.productId!=="string"||!Number.isSafeInteger(i.quantity)||i.quantity<=0||i.quantity>100000||!Number.isSafeInteger(i.priceCents)||i.priceCents<=0)||
    new Set(items.map(i=>i.productId)).size!==items.length)return fail(res,400,"Confira os itens da venda e a forma de pagamento.");
  const requestJson=JSON.stringify({method,clientName,items:items.map(i=>({productId:i.productId,quantity:i.quantity,priceCents:i.priceCents})).sort((a,b)=>a.productId.localeCompare(b.productId))});
  const result=db.transaction(()=>{
    const id=tenant(req),today=cashDay(id);
    const prior=db.prepare("SELECT id,request_json AS requestJson,total_cents AS totalCents FROM product_sales WHERE tenant_id=? AND request_id=?").get(id,requestId);
    if(prior)return prior.requestJson===requestJson?{id:prior.id,totalCents:prior.totalCents,replayed:true}:"Identificador de venda já utilizado.";
    if(!cashOpening(id,today)||cashClosing(id,today))return "Abra o caixa de hoje antes de registrar a venda.";
    const rows=[];
    for(const i of items){
      const p=db.prepare(inventoryProductsSql+" WHERE id=? AND tenant_id=?").get(i.productId,id);
      if(!p||p.purpose==="consumo"||p.quantity<i.quantity||p.priceCents!==i.priceCents)return "Produto indisponível, preço alterado ou estoque insuficiente. Atualize a lista.";
      rows.push({...p,sold:i.quantity});
    }
    const totalCents=rows.reduce((s,p)=>s+p.priceCents*p.sold,0),costCents=rows.reduce((s,p)=>s+p.costCents*p.sold,0);
    if(!Number.isSafeInteger(totalCents)||totalCents>100000000000||!Number.isSafeInteger(costCents))return "Valor da venda inválido.";
    const saleId=createId();
    db.prepare(`INSERT INTO product_sales(id,tenant_id,request_id,request_json,client_name,seller_name,total_cents,cost_cents,payment_method,paid_on,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(saleId,id,requestId,requestJson,clientName,req.user.name||"Usuário",totalCents,costCents,method,today,req.user.id);
    const add=db.prepare("INSERT INTO product_sale_items(sale_id,product_id,product_name,quantity,price_cents,cost_cents) VALUES(?,?,?,?,?,?)");
    for(const p of rows){add.run(saleId,p.id,p.name,p.sold,p.priceCents,p.costCents);inventoryMovement(req,p,-p.sold,"venda","Venda de produtos",saleId);}
    return {id:saleId,totalCents};
  })();
  if(typeof result==="string")return fail(res,409,result);
  res.status(result.replayed?200:201).json(result);
});
app.get("/api/receivables/pending", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const rows = appointmentRows(tenant(req), "AND a.status = 'concluido' AND a.payment_method = ''");
  res.setHeader("Cache-Control", "no-store");
  res.json({ receivables: rows.map(row => ({
    id: row.id, clientId:row.clientId, serviceId:row.serviceId, clientName: row.clientName, serviceName: row.serviceName,
    professionalName: row.professionalName, startsAt: row.startsAt,
    completedOn: row.completedOn, priceCents: row.priceCents, bookingSource: row.bookingSource,
  })) });
});
app.get("/api/receivables", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const completedCount = db.prepare(`SELECT COUNT(*) AS total FROM appointments a
    WHERE a.tenant_id = ? AND a.status = 'concluido' AND ${appointmentCompletionMonth} = ?`).get(tenant(req), month).total;
  const rows = appointmentRows(tenant(req), `AND a.status = 'concluido' AND (
    (a.payment_method = '' AND ${appointmentCompletionMonth} = ?)
    OR (a.payment_method != '' AND substr(a.paid_on, 1, 7) = ?)
  )`, [month, month]);
  res.json({ month, completedCount, receivables: rows.map(row => ({
    id: row.id, clientName: row.clientName, serviceName: row.serviceName, professionalName: row.professionalName,
    startsAt: row.startsAt, completedOn: row.completedOn, priceCents: row.priceCents, paymentMethod: row.paymentMethod,
    paidOn: row.paidOn, paid: Boolean(row.paymentMethod),
  })) });
});


app.post("/api/receivables/:id/pay", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  if (!requireOpenCash(req, res)) return;
  const method = String(req.body?.paymentMethod ?? "");
  if (!paymentMethods.includes(method)) return fail(res, 400, "Informe a forma de pagamento.");
  const before = auditSnapshot(tenant(req), req.params.id);
  const day = cashDay(tenant(req));
  const result = db.transaction(() => {
    if (cashClosing(tenant(req), day)) return "closed";
    const updated = db.prepare(`UPDATE appointments
      SET payment_method = ?, paid_on = ?, paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND tenant_id = ? AND status = 'concluido' AND payment_method = ''`)
      .run(method, day, req.params.id, tenant(req));
    if (!updated.changes) return "conflict";
    recordAppointmentAudit(tenant(req), req.params.id, "pagamento", req.user, before);
    return "ok";
  })();
  if (result === "closed") return fail(res, 409, "O caixa de hoje já foi fechado. Novos recebimentos só podem ser lançados no próximo dia.");
  if (result !== "ok") return fail(res, 409, "Atendimento não encontrado, não concluído ou já pago.");
  res.json({ ok: true });
});




app.get("/api/cash/unreconciled", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const rows = db.prepare(`SELECT a.id, a.starts_at AS startsAt, a.price_cents AS priceCents,
    a.payment_method AS paymentMethod, c.name AS clientName, u.name AS professionalName
    FROM appointments a
    JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
    JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.status = 'concluido' AND a.payment_method NOT IN ('','pacote') AND a.paid_on IS NULL
    ORDER BY a.starts_at DESC LIMIT 300`).all(tenant(req));
  res.setHeader("Cache-Control", "no-store");
  res.json({ receipts: rows });
});
app.post("/api/cash/reconcile/:id", requireAuth, allowRoles("dono"), (req, res) => {
  const date = String(req.body?.date ?? "");
  if (!validCashDate(date) || date > cashDay(tenant(req)))
    return fail(res, 400, "Selecione a data verdadeira do recebimento.");
  const before = auditSnapshot(tenant(req), req.params.id);
  const changed = db.transaction(() => {
    if (cashClosing(tenant(req), date)) return "closed";
    const result = db.prepare(`UPDATE appointments SET paid_on = ?, payment_reconciled_by = ?
      WHERE id = ? AND tenant_id = ? AND status = 'concluido'
        AND payment_method NOT IN ('','pacote') AND paid_on IS NULL`).run(date, req.user.id, req.params.id, tenant(req));
    if (!result.changes) return "missing";
    recordAppointmentAudit(tenant(req), req.params.id, "conciliacao", req.user, before);
    return "ok";
  })();
  if (changed === "closed") return fail(res, 409, "A data selecionada possui caixa fechado.");
  if (changed !== "ok") return fail(res, 409, "Recebimento já conciliado ou não encontrado.");
  res.json({ ok: true, paidOn: date });
});


app.post("/api/cash/openings", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const date = String(req.body?.date ?? "");
  const cash = req.body?.openingCashCents;
  const notes = String(req.body?.notes ?? "").trim();
  if (!validCashDate(date) || date !== cashDay(tenant(req)))
    return fail(res, 400, "A abertura deve ser registrada na data atual do estabelecimento.");
  if (!Number.isSafeInteger(cash) || cash < 0 || cash > 100000000000)
    return fail(res, 400, "Informe um valor inicial em centavos válido.");
  if (notes.length > 500) return fail(res, 400, "Observação deve ter até 500 caracteres.");
  const outcome = db.transaction(() => {
    if (cashClosing(tenant(req), date) || cashOpening(tenant(req), date)) return null;
    const id = createId();
    db.prepare(`INSERT INTO daily_cash_openings
      (id, tenant_id, cash_date, opening_cash_cents, opened_by, opened_by_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id, tenant(req), date, cash, req.user.id, req.user.name || "Usuário", notes);
    return cashOpening(tenant(req), date);
  })();
  if (!outcome) return fail(res, 409, "O caixa desta data já foi aberto ou fechado.");
  res.status(201).json({ opening: outcome });
});

app.get("/api/cash/closings/:id/pdf", requireAuth, allowRoles("dono"), (req, res) => {
  const closing = db.prepare(`SELECT id, cash_date AS cashDate, closed_by_name AS closedByName,
    closed_at AS closedAt, opening_cash_cents AS openingCashCents,
    expected_total_cents AS expectedTotalCents, expected_cash_cents AS expectedCashCents,
    counted_cash_cents AS countedCashCents, difference_cents AS differenceCents,
    receipt_count AS receiptCount, notes, method_totals_json AS methodsJson,
    receipts_snapshot_json AS receiptsSnapshotJson, supply_cents AS supplyCents,
    withdrawal_cents AS withdrawalCents, movements_snapshot_json AS movementsSnapshotJson
    FROM daily_cash_closings WHERE tenant_id = ? AND id = ?`).get(tenant(req), req.params.id);
  if (!closing) return fail(res, 404, "Fechamento não encontrado.");
  const opening = cashOpening(tenant(req), closing.cashDate);
  const receipts = closing.receiptsSnapshotJson
    ? JSON.parse(closing.receiptsSnapshotJson)
    : cashDaySummary(tenant(req), closing.cashDate).receipts;
  closing.methods = JSON.parse(closing.methodsJson);
  const business = db.prepare("SELECT business_name AS name FROM business_settings WHERE tenant_id = ?").get(tenant(req));
  const pdf = cashClosingPdf({ businessName: business?.name || "Estabelecimento",
    closing, opening, receipts, movements: closing.movementsSnapshotJson ? JSON.parse(closing.movementsSnapshotJson) : [] });
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="fechamento-caixa-${closing.cashDate}.pdf"`);
  res.send(pdf);
});


app.post("/api/cash/movements", requireAuth, allowRoles("dono", "recepcao"), (req,res) => {
  const type=String(req.body?.type??"");
  const amount=req.body?.amountCents;
  const reason=String(req.body?.reason??"").trim();
  if (!["sangria","suprimento"].includes(type)) return fail(res,400,"Movimentação inválida.");
  if (!Number.isSafeInteger(amount)||amount<=0||amount>100000000000)
    return fail(res,400,"Informe um valor positivo em centavos.");
  if (reason.length<5||reason.length>250) return fail(res,400,"Informe motivo de 5 a 250 caracteres.");
  const date=cashDay(tenant(req));
  const outcome=db.transaction(()=>{
    if(cashClosing(tenant(req),date))return "closed";
    const opening=cashOpening(tenant(req),date);
    if(!opening)return "unopened";
    const summary=cashDaySummary(tenant(req),date);
    const movements=cashMovements(tenant(req),date);
    const available=opening.openingCashCents+summary.expectedCashCents
      +movements.supplyCents-movements.withdrawalCents;
    if(type==="sangria"&&amount>available)return "insufficient";
    db.prepare(`INSERT INTO daily_cash_movements
      (id,tenant_id,cash_date,movement_type,amount_cents,reason,created_by,created_by_name)
      VALUES (?,?,?,?,?,?,?,?)`).run(createId(),tenant(req),date,type,amount,reason,
      req.user.id,req.user.name||"Usuário");
    return "ok";
  })();
  if(outcome==="closed")return fail(res,409,"O caixa está fechado.");
  if(outcome==="unopened")return fail(res,409,"Abra o caixa antes de movimentar dinheiro.");
  if(outcome==="insufficient")return fail(res,409,"A sangria excede o dinheiro disponível.");
  res.status(201).json({ok:true});
});

app.get("/api/cash/daily", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const date = String(req.query.date ?? cashDay(tenant(req)));
  if (!validCashDate(date)) return fail(res, 400, "Data inválida.");
  if (req.user.role === "recepcao" && date !== cashDay(tenant(req))) return fail(res, 403, "Somente o administrador consulta caixas de outros dias.");
  const summary = cashDaySummary(tenant(req), date);
  const closing = db.prepare(`SELECT id, cash_date AS cashDate, closed_by_name AS closedByName,
    closed_at AS closedAt, expected_total_cents AS expectedTotalCents,
    expected_cash_cents AS expectedCashCents, counted_cash_cents AS countedCashCents,
    difference_cents AS differenceCents, receipt_count AS receiptCount, notes,
    method_totals_json AS methodsJson, opening_cash_cents AS openingCashCents,
    supply_cents AS supplyCents, withdrawal_cents AS withdrawalCents
    FROM daily_cash_closings WHERE tenant_id = ? AND cash_date = ?`).get(tenant(req), date);
  res.setHeader("Cache-Control", "no-store");
  const opening = cashOpening(tenant(req), date);
  const movements = cashMovements(tenant(req), date);
  const { timezone } = db.prepare("SELECT timezone FROM business_settings WHERE tenant_id = ?").get(tenant(req)) ?? {};
  res.json({ ...summary, opening, timezone, movements: movements.rows,
    supplyCents: movements.supplyCents, withdrawalCents: movements.withdrawalCents,
    openingCashCents: opening?.openingCashCents ?? 0,
    expectedDrawerCashCents: (opening?.openingCashCents ?? 0) + summary.expectedCashCents + movements.supplyCents - movements.withdrawalCents,
    today: cashDay(tenant(req)), cashState: closing ? "closed" : opening ? "open" : "unopened", closing: closing && req.user.role === "dono" ?
    { ...closing, methods: JSON.parse(closing.methodsJson), methodsJson: undefined } : null });
});

app.get("/api/cash/closings", requireAuth, allowRoles("dono"), (req, res) => {
  const rows = db.prepare(`SELECT id, cash_date AS cashDate, closed_by_name AS closedByName,
    closed_at AS closedAt, expected_total_cents AS expectedTotalCents,
    expected_cash_cents AS expectedCashCents, counted_cash_cents AS countedCashCents,
    difference_cents AS differenceCents, receipt_count AS receiptCount, notes,
    opening_cash_cents AS openingCashCents, supply_cents AS supplyCents, withdrawal_cents AS withdrawalCents
    FROM daily_cash_closings WHERE tenant_id = ? ORDER BY cash_date DESC LIMIT 60`).all(tenant(req));
  res.setHeader("Cache-Control", "no-store");
  res.json({ closings: rows });
});

app.post("/api/cash/closings", requireAuth, allowRoles("dono", "recepcao"), (req, res) => {
  const date = String(req.body?.date ?? "");
  const counted = req.body?.countedCashCents;
  const notes = String(req.body?.notes ?? "").trim();
  const today = cashDay(tenant(req));
  if (!validCashDate(date) || date > today)
    return fail(res, 400, "Selecione uma data válida que não seja futura.");
  if (req.user.role === "recepcao" && date !== today)
    return fail(res, 403, "Somente o administrador pode fechar caixas de outros dias.");
  if (!Number.isSafeInteger(counted) || counted < 0 || counted > 100000000000)
    return fail(res, 400, "Informe o valor em dinheiro contado, em centavos.");
  if (notes.length > 500) return fail(res, 400, "Observação deve ter até 500 caracteres.");
  const result = db.transaction(() => {
    if (cashClosing(tenant(req), date)) return null;
    if (date === today && !cashOpening(tenant(req), date)) return "unopened";
    const summary = cashDaySummary(tenant(req), date);
    const openingCashCents = cashOpening(tenant(req), date)?.openingCashCents ?? 0;
    const movements=cashMovements(tenant(req),date);
    const difference = counted - openingCashCents - summary.expectedCashCents
      - movements.supplyCents + movements.withdrawalCents;
    const id = createId();
    db.prepare(`INSERT INTO daily_cash_closings
      (id, tenant_id, cash_date, closed_by, closed_by_name, expected_total_cents, expected_cash_cents,
       counted_cash_cents, difference_cents, method_totals_json, receipt_count, notes,
       opening_cash_cents, receipts_snapshot_json, supply_cents, withdrawal_cents, movements_snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, tenant(req), date, req.user.id, req.user.name || "Usuário",
      summary.expectedTotalCents, summary.expectedCashCents, counted, difference,
      JSON.stringify(summary.methods), summary.receiptCount, notes, openingCashCents,
      JSON.stringify([...summary.receipts].reverse()),
      movements.supplyCents,movements.withdrawalCents,JSON.stringify(movements.rows));
    return { id, date, differenceCents: difference };
  })();
  if (result === "unopened") return fail(res, 409, "Abra o caixa antes de fechá-lo.");
  if (!result) return fail(res, 409, "Esse dia já possui um fechamento de caixa.");
  res.status(201).json({ closing: result });
});

app.get("/api/reports/appointment-audit", requireAuth, allowRoles("dono"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const action = String(req.query.action ?? "").trim();
  const permitted = ["criacao", "servico_avulso", "confirmacao", "cancelamento", "remarcacao", "conclusao", "pagamento", "conciliacao", "status", "edicao", "comissao"];
  if (action && !permitted.includes(action)) return fail(res, 400, "Ação inválida.");
  const rows = db.prepare(`
    SELECT audit.id, audit.appointment_id AS appointmentId, audit.actor_name AS actorName,
      audit.action, audit.before_json AS beforeJson, audit.after_json AS afterJson,
      audit.created_at AS createdAt, c.name AS clientName, s.name AS serviceName
    FROM appointment_audit audit
    JOIN appointments ap ON ap.id = audit.appointment_id AND ap.tenant_id = audit.tenant_id
    JOIN clients c ON c.id = ap.client_id AND c.tenant_id = audit.tenant_id
    JOIN services s ON s.id = ap.service_id AND s.tenant_id = audit.tenant_id
    WHERE audit.tenant_id = ? AND substr(audit.created_at, 1, 7) = ?
      AND (? = '' OR audit.action = ?)
    ORDER BY audit.created_at DESC, audit.rowid DESC LIMIT 300
  `).all(tenant(req), month, action, action);
  res.setHeader("Cache-Control", "no-store");
  res.json({ events: rows.map(({ beforeJson, afterJson, ...event }) => ({
    ...event, before: beforeJson ? JSON.parse(beforeJson) : null, after: afterJson ? JSON.parse(afterJson) : null,
  })) });
});

app.get("/api/reports", requireAuth, allowRoles("dono"), (req, res) => {
  const month = String(req.query.month ?? localNow(tenant(req)).slice(0, 7));
  if (!validMonth(month)) return fail(res, 400, "Mês inválido.");
  const revenue = db.prepare(`
    SELECT coalesce(sum(price_cents) FILTER (WHERE payment_method != '' AND substr(paid_on, 1, 7) = @month), 0) AS revenue_cents,
      coalesce(sum(price_cents) FILTER (WHERE payment_method = '' AND ${appointmentCompletionMonth} = @month), 0) AS pending_cents,
      count(*) FILTER (WHERE ${appointmentCompletionMonth} = @month) AS completed_count,
      count(*) FILTER (WHERE payment_method = '' AND ${appointmentCompletionMonth} = @month) AS pending_count
    FROM appointments a WHERE tenant_id = @tenantId AND status = 'concluido'
  `).get({ tenantId: tenant(req), month });
  const byService = db.prepare(`
    SELECT s.id, s.name, count(a.id) AS count, coalesce(sum(a.price_cents), 0) AS revenueCents
    FROM appointments a JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND ${appointmentCompletionMonth} = ? AND a.status = 'concluido'
    GROUP BY s.id ORDER BY count DESC
  `).all(tenant(req), month);
  const byProfessional = db.prepare(`
    SELECT u.id, u.name, count(a.id) AS count,
      coalesce(sum(a.price_cents), 0) AS revenueCents,
      coalesce(sum(round(a.price_cents * max(0, a.commission_percent - a.house_share_percent) / 100)), 0) AS commissionCents
    FROM appointments a JOIN users u ON u.id = a.professional_id AND u.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND ${appointmentCompletionMonth} = ? AND a.status = 'concluido'
    GROUP BY u.id ORDER BY revenueCents DESC
  `).all(tenant(req), month);
  const inactiveClients = db.prepare(`
    SELECT c.id, c.name, c.phone,c.whatsapp_marketing_consent AS whatsappMarketingConsent, max(COALESCE(a.completed_on, substr(a.starts_at, 1, 10))) AS lastVisit
    FROM clients c JOIN appointments a ON a.client_id = c.id AND a.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.notes != '__internal_anonymous__' AND a.status = 'concluido'
    GROUP BY c.id
    HAVING date(max(COALESCE(a.completed_on, substr(a.starts_at, 1, 10)))) <= date(?, '-30 days')
    ORDER BY lastVisit
  `).all(tenant(req), localNow(tenant(req)).slice(0, 10));
  const productionCents = byService.reduce((sum, item) => sum + item.revenueCents, 0);
  const commissionTotalCents = byProfessional.reduce((sum, item) => sum + item.commissionCents, 0);
  const receivedDays = db.prepare(`SELECT paid_on AS date, sum(price_cents) AS cents
    FROM appointments WHERE tenant_id=? AND status='concluido' AND payment_method!='' AND substr(paid_on,1,7)=?
    GROUP BY paid_on`).all(tenant(req),month);
  const productionDays = db.prepare(`SELECT substr(COALESCE(a.completed_on,a.starts_at),1,10) AS date,
    sum(a.price_cents) AS cents, count(*) AS count FROM appointments a WHERE a.tenant_id=? AND a.status='concluido'
    AND ${appointmentCompletionMonth}=? GROUP BY date`).all(tenant(req),month);
  const receivedMap=new Map(receivedDays.map(row=>[row.date,row.cents]));
  for(const row of db.prepare("SELECT paid_on AS date,sum(total_cents) AS cents FROM product_sales WHERE tenant_id=? AND substr(paid_on,1,7)=? GROUP BY paid_on").all(tenant(req),month))receivedMap.set(row.date,(receivedMap.get(row.date)||0)+row.cents);
  for(const row of db.prepare("SELECT paid_on AS date,sum(price_cents) AS cents FROM package_purchases WHERE tenant_id=? AND substr(paid_on,1,7)=? GROUP BY paid_on").all(tenant(req),month))receivedMap.set(row.date,(receivedMap.get(row.date)||0)+row.cents);
  const productionMap=new Map(productionDays.map(row=>[row.date,row]));
  const [year,monthNumber]=month.split("-").map(Number);
  const daily=Array.from({length:new Date(Date.UTC(year,monthNumber,0)).getUTCDate()},(_,i)=>{
    const date=month+"-"+String(i+1).padStart(2,"0");
    return {date,receivedCents:receivedMap.get(date)||0,productionCents:productionMap.get(date)?.cents||0,completedCount:productionMap.get(date)?.count||0};
  });
  const paymentBreakdown = db.prepare(`SELECT payment_method AS method,sum(price_cents) AS cents,count(*) AS count
    FROM appointments WHERE tenant_id=? AND status='concluido' AND payment_method!='' AND substr(paid_on,1,7)=?
    GROUP BY payment_method ORDER BY cents DESC`).all(tenant(req),month);
  for(const row of db.prepare("SELECT payment_method AS method,sum(total_cents) AS cents,count(*) AS count FROM product_sales WHERE tenant_id=? AND substr(paid_on,1,7)=? GROUP BY payment_method").all(tenant(req),month)){
    const existing=paymentBreakdown.find(p=>p.method===row.method);
    if(existing){existing.cents+=row.cents;existing.count+=row.count;}else paymentBreakdown.push(row);
  }
  paymentBreakdown.sort((a,b)=>b.cents-a.cents);
  for(const row of db.prepare("SELECT payment_method AS method,sum(price_cents) AS cents,count(*) AS count FROM package_purchases WHERE tenant_id=? AND substr(paid_on,1,7)=? GROUP BY payment_method").all(tenant(req),month)){
    const existing=paymentBreakdown.find(p=>p.method===row.method);
    if(existing){existing.cents+=row.cents;existing.count+=row.count;}else paymentBreakdown.push(row);
  }
  paymentBreakdown.sort((a,b)=>b.cents-a.cents);
  const productSales=productSalesSummary(tenant(req),month);
  const packageRevenueCents=packageRevenue(tenant(req),month);
  res.json({ month, revenueCents: revenue.revenue_cents+productSales.revenueCents+packageRevenueCents, packageRevenueCents, productSales, pendingCents: revenue.pending_cents, pendingCount: revenue.pending_count, completedCount: revenue.completed_count,
    productionCents, commissionTotalCents, establishmentShareCents: productionCents - commissionTotalCents,
    byService, byProfessional, inactiveClients, daily, paymentBreakdown, cashFlow:expenseCashFlow(tenant(req),month) });
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

function bookingPolicy(tenantId) {
  return db.prepare(`SELECT booking_min_notice_minutes AS minNotice, booking_max_days AS maxDays,
    booking_slot_interval_minutes AS interval, booking_cancellation_hours AS cancelHours,
    booking_allow_cancellation AS allowCancellation FROM business_settings WHERE tenant_id = ?`).get(tenantId);
}
function publicStartAllowed(tenantId, startsAt) {
  const policy = bookingPolicy(tenantId);
  const now = localNow(tenantId);
  return startsAt >= addLocalMinutes(now, policy.minNotice)
    && startsAt <= addLocalMinutes(now, policy.maxDays * 1440);
}
function publicIntervalAllowed(tenantId, professionalId, startsAt) {
  const weekday = new Date(startsAt.slice(0,10)+"T12:00:00Z").getUTCDay();
  const hours = db.prepare(`SELECT bh.opens_at AS businessOpens, ph.opens_at AS professionalOpens,
    ph.professional_id AS hasProfessionalHours
    FROM business_hours bh
    LEFT JOIN professional_hours ph ON ph.tenant_id=bh.tenant_id
      AND ph.professional_id=? AND ph.weekday=bh.weekday
    WHERE bh.tenant_id=? AND bh.weekday=?`).get(professionalId, tenantId, weekday);
  if (!hours?.businessOpens) return false;
  const opens = hours.hasProfessionalHours && hours.professionalOpens > hours.businessOpens
    ? hours.professionalOpens : hours.businessOpens;
  const minute = Number(startsAt.slice(11,13))*60+Number(startsAt.slice(14,16));
  const first = Number(opens.slice(0,2))*60+Number(opens.slice(3,5));
  return minute >= first && (minute-first) % bookingPolicy(tenantId).interval === 0;
}
function managementHash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function managedPublicAppointment(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`SELECT a.id, a.tenant_id AS tenantId, a.starts_at AS startsAt,
    a.ends_at AS endsAt, a.status, a.professional_id AS professionalId,
    a.service_id AS serviceId, a.price_cents AS priceCents, t.slug AS slug, c.name AS clientName,
    s.name AS serviceName, u.name AS professionalName, b.business_name AS businessName,
    b.whatsapp, b.booking_allow_cancellation AS allowCancellation,
    b.booking_cancellation_hours AS cancelHours
    FROM appointments a JOIN tenants t ON t.id=a.tenant_id
    JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id
    JOIN services s ON s.id=a.service_id AND s.tenant_id=a.tenant_id
    JOIN users u ON u.id=a.professional_id AND u.tenant_id=a.tenant_id
    JOIN business_settings b ON b.tenant_id=a.tenant_id
    WHERE a.management_token_hash=? AND a.booking_source='public'`).get(managementHash(token));
}

app.get("/api/public/:slug", (req, res) => {
  const business = db.prepare(`
    SELECT t.id AS tenantId, t.slug, b.business_name AS businessName, b.logo_url AS logoUrl,
      b.phone, b.whatsapp, b.address
    FROM tenants t JOIN business_settings b ON b.tenant_id = t.id WHERE t.slug = ?
  `).get(req.params.slug);
  if (!business) return fail(res, 404, "Negócio não encontrado.");
  if(db.prepare("SELECT status FROM tenant_subscriptions WHERE tenant_id=?").get(business.tenantId)?.status==="suspended")
    return fail(res,403,"Este estabelecimento está temporariamente indisponível.");
  const services = db.prepare(`
    SELECT id, name, duration_minutes AS durationMinutes, price_cents AS priceCents
    FROM services WHERE tenant_id = ? AND active = 1 AND public_enabled = 1 ORDER BY name
  `).all(business.tenantId);
  // The public directory includes only active professionals from this specific business.
  // Service assignments remain useful internally, but never hide a qualified team member.
  const professionals = db.prepare(`
    SELECT u.id, u.name
    FROM users u
    WHERE u.tenant_id = ? AND u.role = 'profissional' AND u.active = 1
    ORDER BY u.name COLLATE NOCASE
  `).all(business.tenantId);
  res.setHeader("Cache-Control", "no-store");
  res.json({ business, services, professionals });
});

app.get("/api/public/:slug/slots", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
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
    JOIN users u ON u.tenant_id = s.tenant_id AND u.role = 'profissional'
    LEFT JOIN professional_hours ph ON ph.professional_id = u.id AND ph.weekday = ?
    LEFT JOIN business_hours bh ON bh.tenant_id = s.tenant_id AND bh.weekday = ?
    WHERE s.tenant_id = ? AND s.id = ? AND u.id = ? AND s.active = 1 AND s.public_enabled = 1 AND u.active = 1
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
  const policy = bookingPolicy(business.tenantId);
  const startMinute = Number(opens.slice(0, 2)) * 60 + Number(opens.slice(3, 5));
  const closeMinute = Number(closes.slice(0, 2)) * 60 + Number(closes.slice(3, 5));
  const nowLocal = localNow(business.tenantId).slice(0, 16);
  for (let minute = startMinute; minute + selected.duration <= closeMinute; minute += policy.interval) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const startsAt = `${date}T${time}:00`;
    const endsAt = addLocalMinutes(startsAt, selected.duration);
    if (`${date}T${time}` <= nowLocal || !publicStartAllowed(business.tenantId, startsAt)) continue;
    if (!findScheduleConflict(db, { tenantId: business.tenantId, professionalId, startsAt, endsAt })) slots.push(time);
  }
  res.json({ slots });
});

app.post("/api/public/:slug/appointments", limitAttempts("public-appointment", 12, 15 * 60 * 1000), (req, res) => {
  if (req.params.slug === "studio-bela-vista") {
    const demo = db.prepare("SELECT id FROM tenants WHERE slug = ? AND id = ?").get(req.params.slug, DEMO_TENANT_ID);
    if (demo) return fail(res, 403, "Página demonstrativa: reservas reais estão desativadas.");
  }
  const business = db.prepare("SELECT id, timezone FROM tenants JOIN business_settings ON business_settings.tenant_id = tenants.id WHERE slug = ?").get(req.params.slug);
  if (!business) return fail(res, 404, "Negócio não encontrado.");
  if(db.prepare("SELECT status FROM tenant_subscriptions WHERE tenant_id=?").get(business.id)?.status==="suspended")
    return fail(res,403,"Este estabelecimento está temporariamente indisponível.");
  const name = requiredText(req.body?.name, "Nome", 120);
  const phone = requiredText(req.body?.phone, "Telefone", 20);
  const digits = phone.replace(/\D/g, "");
  if (!/^(?:55)?\d{10,11}$/.test(digits)) return fail(res, 400, "Informe WhatsApp com DDD válido.");
  const { serviceId, professionalId } = req.body ?? {};
  const startsAt = String(req.body?.startsAt ?? "");
  if (!validDateTime(startsAt) || !serviceId || !professionalId) return fail(res, 400, "Escolha serviço, profissional e horário.");
  const selected = db.prepare(`
    SELECT s.duration_minutes AS duration, s.price_cents AS price,
      CASE WHEN s.commission_mode = 'custom' THEN s.service_commission_percent ELSE COALESCE(psc.commission_percent,u.commission_percent) END AS commission,
      CASE WHEN s.commission_mode = 'custom' THEN s.house_share_percent ELSE COALESCE(psc.house_share_percent,s.house_share_percent) END AS houseShare
    FROM services s JOIN users u ON u.tenant_id = s.tenant_id AND u.role = 'profissional'
    LEFT JOIN professional_service_commissions psc ON psc.tenant_id=s.tenant_id AND psc.service_id=s.id AND psc.professional_id=u.id
    WHERE s.tenant_id = ? AND s.id = ? AND u.id = ? AND s.active = 1 AND s.public_enabled = 1 AND u.active = 1
  `).get(business.id, serviceId, professionalId);
  if (!selected) return fail(res, 400, "Serviço ou profissional inválido.");
  const normalizedStart = startsAt.length === 16 ? `${startsAt}:00` : startsAt;
  if (!publicStartAllowed(business.id, normalizedStart)) return fail(res, 400, "Horário fora da antecedência ou janela de reservas permitida.");
  const endsAt = addLocalMinutes(normalizedStart, selected.duration);
  if (!withinWorkingHours(business.id, professionalId, normalizedStart, endsAt) ||
      !publicIntervalAllowed(business.id, professionalId, normalizedStart)) {
    return fail(res, 400, "Horário fora da agenda disponível do profissional.");
  }
  const id = createId();
  const accessToken = crypto.randomBytes(32).toString("hex");
  const create = db.transaction(() => {
    if (scheduleConflict(res, {
      tenantId: business.id, professionalId, startsAt: normalizedStart, endsAt,
    })) return false;
    let client = db.prepare("SELECT id FROM clients WHERE tenant_id = ? AND phone = ? AND name = ? COLLATE NOCASE")
      .get(business.id, phone, name);
    if (!client) {
      const clientId = createId();
      db.prepare("INSERT INTO clients (id, tenant_id, name, phone) VALUES (?, ?, ?, ?)")
        .run(clientId, business.id, name, phone);
      client = { id: clientId };
    }
    db.prepare(`
      INSERT INTO appointments
        (id, tenant_id, client_id, professional_id, service_id, starts_at, ends_at, price_cents, commission_percent, house_share_percent, booking_source, management_token_hash, whatsapp_opt_in)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?)
    `).run(id, business.id, client.id, professionalId, serviceId, normalizedStart, endsAt,
      selected.price, selected.commission, selected.houseShare, managementHash(accessToken), req.body?.whatsappOptIn === true ? 1 : 0);
    return true;
  });
  if (!create()) return;
  recordAppointmentAudit(business.id, id, "criacao", null);
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json({ id, protocol: id.slice(0, 8).toUpperCase(), managementToken: accessToken, status: "agendado", message: "Solicitação recebida. O estabelecimento ainda precisa confirmar." });
});

// Public customer management URL is a bearer capability: send only over HTTPS.
app.get("/api/public/manage/:token", (req, res) => {
  const record = managedPublicAppointment(req.params.token);
  if (!record) return fail(res, 404, "Solicitação não encontrada ou link inválido.");
  const cutoff = addLocalMinutes(record.startsAt, -record.cancelHours * 60);
  const canManage = !!record.allowCancellation &&
    ["agendado", "confirmado"].includes(record.status) &&
    localNow(record.tenantId) < cutoff;
  res.setHeader("Cache-Control", "no-store");
  res.json({ appointment: {
    protocol: record.id.slice(0, 8).toUpperCase(), businessName: record.businessName,
    slug:record.slug, serviceId:record.serviceId, professionalId:record.professionalId,
    clientName: record.clientName, serviceName: record.serviceName, professionalName: record.professionalName,
    startsAt: record.startsAt, status: record.status, priceCents: record.priceCents,
    whatsapp: record.whatsapp, canManage,
  } });
});
app.post("/api/public/manage/:token/cancel", limitAttempts("manage-cancel", 15, 15 * 60 * 1000), async(req, res) => {
  const row = managedPublicAppointment(req.params.token);
  if (!row) return fail(res, 404, "Solicitação não encontrada.");
  if (!row.allowCancellation || !["agendado", "confirmado"].includes(row.status) ||
    localNow(row.tenantId) >= addLocalMinutes(row.startsAt, -row.cancelHours * 60))
    return fail(res, 409, "Cancelamento não permitido. Contate o estabelecimento.");
  const noticeId = db.transaction(() => {
    const beforeAudit = auditSnapshot(row.tenantId, row.id);
    const changed = db.prepare("UPDATE appointments SET status='cancelado' WHERE id=? AND tenant_id=? AND status IN ('agendado','confirmado')")
      .run(row.id, row.tenantId);
    if (!changed.changes) return null;
    recordAppointmentAudit(row.tenantId, row.id, "cancelamento", { role: "cliente" }, beforeAudit);
    return recordWhatsAppStatusChange(row.tenantId, row.id, "cancelado");
  })();
  if (!noticeId) return fail(res, 409, "O atendimento foi atualizado. Recarregue a página.");
  const whatsappState = await dispatchWhatsAppStatusChange(noticeId, row.tenantId, row.id, "cancelado");
  res.json({ ok:true, status:"cancelado", whatsappState });
});
app.post("/api/public/manage/:token/reschedule", limitAttempts("manage-reschedule", 15, 15 * 60 * 1000), (req, res) => {
  const row = managedPublicAppointment(req.params.token);
  if (!row) return fail(res, 404, "Solicitação não encontrada.");
  if (!row.allowCancellation || !["agendado", "confirmado"].includes(row.status) ||
    localNow(row.tenantId) >= addLocalMinutes(row.startsAt, -row.cancelHours * 60))
    return fail(res, 409, "Remarcação não permitida. Contate o estabelecimento.");
  const startsAt = String(req.body?.startsAt ?? "");
  if (!validDateTime(startsAt)) return fail(res, 400, "Informe data e horário válidos.");
  const normalized = startsAt.length === 16 ? startsAt + ":00" : startsAt;
  if (normalized === row.startsAt) return fail(res, 409, "Escolha um horário diferente do atual.");
  if (!publicStartAllowed(row.tenantId, normalized)) return fail(res, 400, "Data fora das regras de agendamento.");
  const selected = db.prepare(`SELECT s.duration_minutes AS duration, s.public_enabled AS publicEnabled,
    s.active, u.active AS professionalActive
    FROM services s JOIN users u ON u.id=? AND u.tenant_id=s.tenant_id
    WHERE s.id=? AND s.tenant_id=?`).get(row.professionalId, row.serviceId, row.tenantId);
  if (!selected || !selected.publicEnabled || !selected.active || !selected.professionalActive)
    return fail(res, 409, "Serviço ou profissional indisponível.");
  const endsAt = addLocalMinutes(normalized, selected.duration);
  if (!withinWorkingHours(row.tenantId, row.professionalId, normalized, endsAt))
    return fail(res, 400, "Fora do expediente.");
  if (!publicIntervalAllowed(row.tenantId, row.professionalId, normalized))
    return fail(res, 400, "Escolha um horário da agenda disponível.");
  const beforeAudit = auditSnapshot(row.tenantId, row.id);
  const changed = db.transaction(() => {
    if (findScheduleConflict(db, { tenantId:row.tenantId, professionalId:row.professionalId,
      startsAt:normalized, endsAt, excludeAppointmentId:row.id })) return false;
    return db.prepare(`UPDATE appointments SET starts_at=?, ends_at=?, status='agendado'
      WHERE id=? AND tenant_id=? AND status IN ('agendado','confirmado')`)
      .run(normalized, endsAt, row.id, row.tenantId).changes > 0;
  })();
  if (!changed) return fail(res, 409, "Horário ocupado ou solicitação alterada. Escolha outro horário.");
  recordAppointmentAudit(row.tenantId, row.id, "remarcacao", {role:"cliente"}, beforeAudit);
  res.json({ ok:true, status:"agendado", startsAt:normalized, message:"Remarcação solicitada. Aguarde nova confirmação." });
});

// Meta WhatsApp Cloud API is opt-in and requires an approved utility template per status.
// Configured server-side only: WHATSAPP_CLOUD_CONFIG_JSON maps business slug to credentials.
const whatsappDefaults={
  agendado:{enabled:true,label:"Solicitação recebida",template:"Olá, {cliente}! Recebemos sua solicitação de {servico}, com {profissional}, para {data} às {hora}. Aguarde a confirmação. — {empresa}"},
  confirmado:{enabled:true,label:"Agendamento confirmado",template:"Olá, {cliente}! Seu horário de {servico} com {profissional} está confirmado para {data} às {hora}. — {empresa}"},
  cancelado:{enabled:true,label:"Cancelamento",template:"Olá, {cliente}! Seu horário de {servico} previsto para {data} às {hora} foi cancelado. — {empresa}"},
  remarcacao:{enabled:true,label:"Reagendamento",template:"Olá, {cliente}! Seu horário de {servico} com {profissional} foi alterado para {data} às {hora}. — {empresa}"},
  lembrete:{enabled:true,label:"Lembrete de atendimento",template:"Olá, {cliente}! Lembramos seu atendimento de {servico}, com {profissional}, em {data} às {hora}. Esperamos você! — {empresa}"},
  pacote:{enabled:true,label:"Vencimento de pacote",template:"Olá, {cliente}! Seu pacote {pacote} vence em {validade} e ainda tem {sessoes} sessão(ões). Entre em contato para agendar. — {empresa}"},
  fidelidade:{enabled:false,label:"Recompensa de fidelidade",template:"Olá, {cliente}! Você tem {pontos} pontos e pode resgatar um desconto de {desconto}. — {empresa}"}
};
function whatsappPreferences(id){
  const row=db.prepare("SELECT mode,rules_json AS json FROM whatsapp_preferences WHERE tenant_id=?").get(id);
  let stored={};try{stored=JSON.parse(row?.json||"{}");}catch{}
  const rules=Object.fromEntries(Object.entries(whatsappDefaults).map(([kind,defaults])=>[kind,{...defaults,...stored.rules?.[kind]}]));
  return {mode:row?.mode||"manual",rules,reminderHours:stored.reminderHours||[24,2],expiryDays:stored.expiryDays||7};
}
function whatsappPhone(phone){
  const raw=String(phone||"").replace(/\D/g,"");
  if(/^\d{10,11}$/.test(raw))return "55"+raw;
  return /^55\d{10,11}$/.test(raw)?raw:"";
}
function whatsappDate(day){return day?day.slice(0,10).split("-").reverse().join("/"):"";}
function refreshWhatsAppQueue(id){
  const settings=whatsappPreferences(id),now=localNow(id),today=now.slice(0,10);
  const business=db.prepare("SELECT business_name AS name FROM business_settings WHERE tenant_id=?").get(id)?.name||"Estabelecimento";
  const candidates=[];
  const add=(kind,key,row,vars,appointmentId=null)=>{
    const rule=settings.rules[kind],phone=whatsappPhone(row.phone);
    if(!rule?.enabled||!phone)return;
    const message=rule.template.replace(/\{([a-z]+)\}/g,(_m,k)=>String(({cliente:row.clientName,empresa:business,...vars})[k]??""));
    candidates.push({kind,key:key+":"+row.clientId+":"+phone,clientId:row.clientId,clientName:row.clientName,phone,message,appointmentId});
  };
  const cutoff=addLocalMinutes(now,-7*1440);
  const appointments=db.prepare(`SELECT a.id,a.status,a.starts_at AS startsAt,a.booking_source AS source,
    c.id AS clientId,c.name AS clientName,c.phone,s.name AS serviceName,u.name AS professionalName,
    w.id AS legacyId,w.delivery_state AS legacyState,w.opened_at AS legacyOpened,w.opened_by AS legacyOpenedBy,
    (SELECT x.id FROM appointment_audit x WHERE x.tenant_id=a.tenant_id AND x.appointment_id=a.id AND x.action IN ('criacao','confirmacao','cancelamento','status','remarcacao') ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1) AS eventId,
    (SELECT x.action FROM appointment_audit x WHERE x.tenant_id=a.tenant_id AND x.appointment_id=a.id AND x.action IN ('criacao','confirmacao','cancelamento','status','remarcacao') ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1) AS eventAction
    FROM appointments a JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id
    JOIN services s ON s.id=a.service_id AND s.tenant_id=a.tenant_id JOIN users u ON u.id=a.professional_id AND u.tenant_id=a.tenant_id
    LEFT JOIN whatsapp_notifications w ON w.tenant_id=a.tenant_id AND w.appointment_id=a.id AND w.status=a.status
    WHERE a.tenant_id=? AND a.status IN ('agendado','confirmado','cancelado') AND a.starts_at>=? AND a.booking_source!='direct'
    AND (CASE WHEN a.booking_source='public' THEN a.whatsapp_opt_in ELSE c.whatsapp_consent END)=1`).all(id,cutoff);
  for(const a of appointments){
    const vars={servico:a.serviceName,profissional:a.professionalName,data:whatsappDate(a.startsAt),hora:a.startsAt.slice(11,16)};
    const version=a.eventId||a.startsAt;
    const kind=a.eventAction==="remarcacao"&&a.status!=="cancelado"?"remarcacao":a.status;
    if((a.status==="cancelado"||a.startsAt>=now)&&!(kind===a.status&&a.legacyState==="submitted"))
      add(kind,"appointment:"+a.id+":"+kind+":"+version+":"+a.startsAt,a,vars,a.id);
    if(a.status==="confirmado"&&a.startsAt>now){
      const hours=[...settings.reminderHours].sort((a,b)=>a-b).find(h=>a.startsAt<=addLocalMinutes(now,h*60));
      if(hours)add("lembrete","reminder:"+a.id+":"+version+":"+a.startsAt+":"+hours,a,vars,a.id);
    }
  }
  const expiry=new Date(today+"T12:00:00Z");expiry.setUTCDate(expiry.getUTCDate()+settings.expiryDays);
  const packages=db.prepare(`SELECT p.id,p.package_name AS packageName,p.expires_on AS expiresOn,c.id AS clientId,c.name AS clientName,c.phone
    FROM package_purchases p JOIN clients c ON c.id=p.client_id AND c.tenant_id=p.tenant_id WHERE p.tenant_id=? AND c.whatsapp_consent=1 AND p.expires_on BETWEEN ? AND ?`).all(id,today,expiry.toISOString().slice(0,10));
  for(const p of packages){
    const left=purchasedItems(p.id).reduce((s,i)=>s+i.sessions-i.used,0);
    if(left)add("pacote","package:"+p.id+":"+p.expiresOn,p,{pacote:p.packageName,validade:whatsappDate(p.expiresOn),sessoes:left});
  }
  const loyalty=loyaltySettings(id);
  if(loyalty.enabled&&settings.rules.fidelidade.enabled){
    const clients=db.prepare("SELECT id AS clientId,name AS clientName,phone FROM clients WHERE tenant_id=? AND whatsapp_marketing_consent=1 AND notes!='__internal_anonymous__'").all(id);
    for(const c of clients){
      const points=loyaltyPoints(id,c.clientId);
      if(points.balance>=loyalty.threshold)add("fidelidade","loyalty:"+c.clientId+":"+points.spent,c,{pontos:points.balance,desconto:"R$ "+(loyalty.discountCents/100).toFixed(2).replace(".",",")});
    }
  }
  db.transaction(()=>{
    db.prepare("UPDATE whatsapp_manual_queue SET active=0 WHERE tenant_id=? AND sent_at IS NULL").run(id);
    const insert=db.prepare(`INSERT INTO whatsapp_manual_queue(id,tenant_id,event_key,kind,client_id,appointment_id,phone,message,client_name)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,event_key) DO UPDATE SET active=1,phone=excluded.phone,message=excluded.message,client_name=excluded.client_name,
      opened_at=CASE WHEN whatsapp_manual_queue.phone!=excluded.phone OR whatsapp_manual_queue.message!=excluded.message THEN NULL ELSE whatsapp_manual_queue.opened_at END,
      opened_by=CASE WHEN whatsapp_manual_queue.phone!=excluded.phone OR whatsapp_manual_queue.message!=excluded.message THEN NULL ELSE whatsapp_manual_queue.opened_by END
      WHERE whatsapp_manual_queue.sent_at IS NULL`);
    for(const c of candidates)insert.run(createId(),id,c.key,c.kind,c.clientId,c.appointmentId,c.phone,c.message,c.clientName);
  })();
}
app.get("/api/whatsapp/preferences",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const slug=db.prepare("SELECT slug FROM tenants WHERE id=?").get(tenant(req))?.slug;
  const preferences=whatsappPreferences(tenant(req));
  if(!getPlanAccess(tenant(req)).features.automaticWhatsapp)preferences.mode="manual";
  res.json({...preferences,automaticConfigured:Boolean(whatsAppCloudConfig(slug))});
});
app.put("/api/whatsapp/preferences",requireAuth,allowRoles("dono"),(req,res)=>{
  const {mode,rules,reminderHours,expiryDays}=req.body||{};
  if(mode==="automatic"&&!getPlanAccess(tenant(req)).features.automaticWhatsapp)return fail(res,403,"WhatsApp automático não incluído no plano contratado.");
  if(!["manual","automatic"].includes(mode)||!rules||!Array.isArray(reminderHours)||reminderHours.length>2||new Set(reminderHours).size!==reminderHours.length||reminderHours.some(h=>!Number.isSafeInteger(h)||h<1||h>168)||!Number.isSafeInteger(expiryDays)||expiryDays<1||expiryDays>60)
    return fail(res,400,"Confira as preferências de WhatsApp.");
  const sanitized={};
  const tokens=new Set(["cliente","empresa","servico","profissional","data","hora","pacote","validade","sessoes","pontos","desconto"]);
  for(const kind of Object.keys(whatsappDefaults)){
    const r=rules[kind];
    if(typeof r?.enabled!=="boolean"||typeof r.template!=="string"||!r.template.trim()||r.template.length>1000||[...r.template.matchAll(/\{([^{}]+)\}/g)].some(m=>!tokens.has(m[1])))return fail(res,400,"Modelo inválido: "+whatsappDefaults[kind].label);
    sanitized[kind]={enabled:r.enabled,template:r.template.trim()};
  }
  db.prepare("INSERT INTO whatsapp_preferences(tenant_id,mode,rules_json) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode,rules_json=excluded.rules_json").run(tenant(req),mode,JSON.stringify({rules:sanitized,reminderHours,expiryDays}));
  refreshWhatsAppQueue(tenant(req));res.json({ok:true});
});
app.post("/api/whatsapp/sync",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const id=tenant(req);refreshWhatsAppQueue(id);
  const rows=db.prepare(`SELECT id,kind,appointment_id AS appointmentId,client_name AS clientName,
    CASE WHEN sent_at IS NULL THEN phone ELSE '' END AS phone,message,created_at AS createdAt,opened_at AS openedAt,sent_at AS sentAt,sent_by_name AS sentByName
    FROM whatsapp_manual_queue WHERE tenant_id=? AND (active=1 OR sent_at IS NOT NULL)
    ORDER BY sent_at IS NOT NULL,created_at DESC LIMIT 1000`).all(id);
  res.setHeader("Cache-Control","no-store");res.json({messages:rows});
});
app.post("/api/whatsapp/messages/:id/:action",requireAuth,allowRoles("dono","recepcao"),(req,res)=>{
  const id=tenant(req),action=req.params.action;
  if(!["open","sent"].includes(action))return fail(res,400,"Ação inválida.");
  refreshWhatsAppQueue(id);
  const row=db.prepare("SELECT * FROM whatsapp_manual_queue WHERE id=? AND tenant_id=? AND active=1").get(req.params.id,id);
  if(!row||row.sent_at)return fail(res,409,"Aviso indisponível ou já confirmado.");
  if(action==="sent"&&!row.opened_at)return fail(res,409,"Abra primeiro a conversa e confirme o envio no WhatsApp.");
  if(action==="open")db.prepare("UPDATE whatsapp_manual_queue SET opened_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),opened_by=? WHERE id=? AND tenant_id=?").run(req.user.id,row.id,id);
  else db.prepare("UPDATE whatsapp_manual_queue SET sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),sent_by=?,sent_by_name=? WHERE id=? AND tenant_id=?").run(req.user.id,req.user.name||"Usuário",row.id,id);
  res.json(action==="open"?{phone:row.phone,message:row.message}:{ok:true});
});
function whatsAppCloudConfig(slug) {
  if (!process.env.WHATSAPP_CLOUD_CONFIG_JSON) return null;
  try {
    const entries=JSON.parse(process.env.WHATSAPP_CLOUD_CONFIG_JSON);
    const c=entries?.[slug];
    if(!c?.accessToken || !c?.phoneNumberId || !c?.confirmedTemplate)return null;
    return c;
  } catch (e) { console.error("WhatsApp Cloud API: configuração JSON inválida"); return null; }
}
async function notifyStatusWhatsApp(tenantId,appointmentId,targetStatus) {
  const row=db.prepare(`SELECT a.id,a.status,a.whatsapp_opt_in AS whatsappOptIn,
    a.starts_at AS startsAt,t.slug,c.name AS clientName,c.phone,s.name AS serviceName,
    u.name AS professionalName,b.business_name AS businessName
    FROM appointments a JOIN tenants t ON t.id=a.tenant_id
    JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id
    JOIN services s ON s.id=a.service_id AND s.tenant_id=a.tenant_id
    JOIN users u ON u.id=a.professional_id AND u.tenant_id=a.tenant_id
    JOIN business_settings b ON b.tenant_id=a.tenant_id
    WHERE a.id=? AND a.tenant_id=?`).get(appointmentId,tenantId);
  if(!row || row.status!==targetStatus || !["confirmado","cancelado"].includes(targetStatus))return "not-applicable";
  const prefs=whatsappPreferences(tenantId);
  const config=whatsAppCloudConfig(row.slug);
  if(!row.whatsappOptIn)return "no-consent";
  if(!prefs.rules[targetStatus]?.enabled)return "disabled";
  if(!config)return "not-configured";
  if(!getPlanAccess(tenantId).features.automaticWhatsapp)return "manual";
  if(prefs.mode!=="automatic")return "manual";
  const raw=row.phone.replace(/\D/g,"");
  const number=raw.startsWith("55")?raw:"55"+raw;
  if(!/^55\d{10,11}$/.test(number))return "invalid-phone";
  const template=String(targetStatus==="confirmado"?config.confirmedTemplate:config.cancelledTemplate || "");
  if(!/^[a-z0-9_]+$/.test(template))return "invalid-template";
  const graphVersion=/^v\d+\.\d+$/.test(config.graphVersion||"")?config.graphVersion:"v23.0";
  const fields=[row.clientName,row.serviceName,row.startsAt.slice(0,16).replace("T"," às "),row.businessName];
  const payload={messaging_product:"whatsapp",to:number,type:"template",template:{
    name:template,language:{code:config.language||"pt_BR"},components:[{
      type:"body",parameters:fields.map(text=>({type:"text",text}))
    }]
  }};
  try{
    const result=await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`,{
      method:"POST",headers:{"Authorization":`Bearer ${config.accessToken}`,"Content-Type":"application/json"},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(8000),
    });
    if(!result.ok){console.error("WhatsApp Cloud API falhou com HTTP",result.status);return "failed";}
    return "submitted"; // Submission is not proof of delivery; webhook integration is separate.
  }catch(e){console.error("WhatsApp Cloud API indisponível:",e.message);return "failed";}
}

// Assisted WhatsApp: opening a conversation never proves that a message was sent.
function queueWhatsAppNotification(tenantId,appointmentId,status) {
  db.prepare(`INSERT OR IGNORE INTO whatsapp_notifications
    (id,tenant_id,appointment_id,status) VALUES (?,?,?,?)`)
    .run(createId(),tenantId,appointmentId,status);
}
// A new transition replaces the current notice for that status, including after rescheduling.
function recordWhatsAppStatusChange(tenantId, appointmentId, status) {
  const id = createId();
  db.prepare(`INSERT INTO whatsapp_notifications (id, tenant_id, appointment_id, status)
    VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, appointment_id, status) DO UPDATE SET
    id = excluded.id, created_at = excluded.created_at, delivery_state = excluded.delivery_state,
    opened_at = NULL, opened_by = NULL`).run(id, tenantId, appointmentId, status);
  return id;
}
async function dispatchWhatsAppStatusChange(id, tenantId, appointmentId, status) {
  const state = await notifyStatusWhatsApp(tenantId, appointmentId, status);
  db.prepare("UPDATE whatsapp_notifications SET delivery_state = ? WHERE id = ?").run(state, id);
  return state;
}
app.post("/api/requests/:id/whatsapp-opened", requireAuth, allowRoles("dono","recepcao"), (req,res)=>{
  const status=String(req.body?.status||"");
  if(!["confirmado","cancelado","agendado"].includes(status))
    return fail(res,400,"Notificação inválida.");
  const record=db.prepare(`SELECT id, whatsapp_opt_in AS whatsappOptIn FROM appointments
    WHERE id=? AND tenant_id=? AND booking_source='public' AND status=?`)
    .get(req.params.id,tenant(req),status);
  if(!record)return fail(res,409,"Solicitação ou status não encontrado.");
  if (!record.whatsappOptIn) return fail(res, 403, "O cliente não autorizou avisos por WhatsApp.");
  if(!whatsappPreferences(tenant(req)).rules[status]?.enabled)return fail(res,409,"Este aviso está desativado.");
  queueWhatsAppNotification(tenant(req),record.id,status);
  db.prepare(`UPDATE whatsapp_notifications SET opened_at=datetime('now'),opened_by=?
    WHERE tenant_id=? AND appointment_id=? AND status=?`)
    .run(req.user.id,tenant(req),record.id,status);
  res.json({ok:true,message:"Conversa aberta. O envio depende da confirmação no WhatsApp."});
});

// Reception and owner handle only public requests for their own business.
app.get("/api/requests", requireAuth, allowRoles("dono","recepcao"), (req, res) => {
  const rows=db.prepare(`SELECT a.id, a.starts_at AS startsAt, a.status,
    c.name AS clientName, c.phone AS clientPhone, s.name AS serviceName,
    b.business_name AS businessName, a.whatsapp_opt_in AS whatsappOptIn,
    wn.opened_at AS whatsappOpenedAt, wn.delivery_state AS whatsappDeliveryState,
    u.name AS professionalName
    FROM appointments a JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id
    JOIN services s ON s.id=a.service_id AND s.tenant_id=a.tenant_id
    JOIN users u ON u.id=a.professional_id AND u.tenant_id=a.tenant_id
    JOIN business_settings b ON b.tenant_id=a.tenant_id
    LEFT JOIN whatsapp_notifications wn ON wn.tenant_id=a.tenant_id AND wn.appointment_id=a.id AND wn.status=a.status
    WHERE a.tenant_id=? AND a.booking_source='public'
    ORDER BY CASE WHEN a.status='agendado' THEN 0 ELSE 1 END, a.starts_at DESC LIMIT 250`).all(tenant(req));
  res.setHeader("Cache-Control","no-store");
  res.json({ requests:rows });
});
app.patch("/api/requests/:id", requireAuth, allowRoles("dono","recepcao"), async(req,res) => {
  const action=String(req.body?.action ?? "");
  if (!["confirm","reject"].includes(action)) return fail(res,400,"Ação inválida.");
  const next=action==="confirm"?"confirmado":"cancelado";
  const noticeId = db.transaction(() => {
    const beforeAudit = auditSnapshot(tenant(req), req.params.id);
    const changed = db.prepare(`UPDATE appointments SET status=?
      WHERE id=? AND tenant_id=? AND booking_source='public' AND status='agendado'`)
      .run(next, req.params.id, tenant(req));
    if (!changed.changes) return null;
    recordAppointmentAudit(tenant(req), req.params.id, action === "confirm" ? "confirmacao" : "cancelamento", req.user, beforeAudit);
    return recordWhatsAppStatusChange(tenant(req), req.params.id, next);
  })();
  if (!noticeId) return fail(res, 409, "Solicitação não encontrada ou já analisada.");
  const whatsappState = await dispatchWhatsAppStatusChange(noticeId, tenant(req), req.params.id, next);
  res.json({ ok: true, status: next, whatsappState, message: whatsappState === "submitted"
    ? "Aviso encaminhado à Meta; entrega ainda não verificada."
    : whatsappState === "no-consent"
      ? "Status registrado. O cliente não autorizou avisos por WhatsApp."
      : "Status registrado. Use o botão WhatsApp para enviar o aviso manualmente." });
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
