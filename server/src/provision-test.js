import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });
if (process.env.NODE_ENV === "production") {
  throw new Error("Contas de teste só podem ser provisionadas fora de produção.");
}
const email = (process.env.TEST_ACCOUNT_EMAIL ?? "").trim().toLowerCase();
const password = process.env.TEST_ACCOUNT_PASSWORD ?? "";
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200) {
  throw new Error("Defina TEST_ACCOUNT_EMAIL válido e TEST_ACCOUNT_PASSWORD de 12 a 200 caracteres.");
}
const { db, allocateStaffCode } = await import("./database.js");
const tenantId = "tenant-comercio-teste";
const slug = "comercio-teste";
const ownerId = "user-comercio-teste-owner";
const professionalId = "user-comercio-teste-pro";
const serviceId = "service-comercio-teste";
const hash = await bcrypt.hash(password, 12);
const staffHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
db.transaction(() => {
  const slugOwner = db.prepare("SELECT id FROM tenants WHERE slug = ?").get(slug);
  if (slugOwner && slugOwner.id !== tenantId) throw new Error("Identificador do comércio já utilizado.");
  db.prepare("INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (?, ?, ?)").run(tenantId, "Comércio Teste", slug);
  db.prepare("INSERT OR IGNORE INTO business_settings (tenant_id, business_name) VALUES (?, ?)")
    .run(tenantId, "Comércio Teste");
  db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?, 'dono')`).run(ownerId, tenantId, "Administrador Comercial", email, hash);
  const owner = db.prepare("SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ?").get(tenantId, email);
  if (!owner || owner.id !== ownerId) throw new Error("E-mail da conta de teste já pertence a outro usuário.");
  db.prepare("UPDATE users SET password_hash = ?, active = 1 WHERE id = ? AND tenant_id = ?")
    .run(hash, ownerId, tenantId);
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?").run(ownerId, tenantId);
  db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, name, email, password_hash, role, commission_percent)
    VALUES (?, ?, ?, ?, ?, 'profissional', 30)`)
    .run(professionalId, tenantId, "Profissional Exemplo", "profissional@comercio-teste.local", staffHash);
  db.prepare("UPDATE users SET staff_code = ? WHERE id = ? AND tenant_id = ? AND staff_code IS NULL")
    .run(allocateStaffCode(tenantId), professionalId, tenantId);
  db.prepare(`INSERT OR IGNORE INTO services (id, tenant_id, name, duration_minutes, price_cents)
    VALUES (?, ?, ?, ?, ?)`).run(serviceId, tenantId, "Atendimento de teste", 60, 5000);
  db.prepare("INSERT OR IGNORE INTO professional_services (tenant_id, professional_id, service_id) VALUES (?, ?, ?)")
    .run(tenantId, professionalId, serviceId);
  for (let day = 0; day < 7; day += 1) {
    const open = day === 0 ? null : "09:00";
    const close = day === 0 ? null : day === 6 ? "13:00" : "18:00";
    db.prepare("INSERT OR IGNORE INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)")
      .run(tenantId, day, open, close);
    db.prepare(`INSERT OR IGNORE INTO professional_hours (tenant_id, professional_id, weekday, opens_at, closes_at)
      VALUES (?, ?, ?, ?, ?)`).run(tenantId, professionalId, day, open, close);
  }
})();
console.log(`Comércio de teste preparado. Identificador: ${slug}. E-mail: ${email}.`);
console.log("A senha não é exibida nem salva no repositório. Use TEST_ACCOUNT_PASSWORD informado no ambiente.");
db.close();
