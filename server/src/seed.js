import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const { db, allocateStaffCode } = await import("./database.js");

const tenantId = "tenant-salao-demo";
const password = process.env.DEMO_PASSWORD ?? "Agenda123!";
const hash = await bcrypt.hash(password, 12);

function dateOffset(days) {
  const date = new Date(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()));
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const seed = db.transaction(() => {
  db.prepare("INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (?, ?, ?)")
    .run(tenantId, "Studio Bela Vista", "studio-bela-vista");
  db.prepare(`
    INSERT OR IGNORE INTO business_settings (tenant_id, business_name, phone, address)
    VALUES (?, ?, ?, ?)
  `).run(tenantId, "Studio Bela Vista", "(11) 99999-0000", "Rua das Flores, 120 · São Paulo");

  const users = [
    { id: "user-owner-demo", name: "Mariana Souza", email: process.env.DEMO_EMAIL ?? "admin@simplifica.local", role: "dono", phone: "(11) 99999-0000", commission: 0 },
    { id: "user-pro-ana-demo", name: "Ana Oliveira", email: "ana@simplifica.local", role: "profissional", phone: "(11) 98888-1111", commission: 40 },
    { id: "user-pro-luiza-demo", name: "Luiza Costa", email: "luiza@simplifica.local", role: "profissional", phone: "(11) 97777-2222", commission: 45 },
    { id: "user-reception-demo", name: "Camila Rocha", email: "recepcao@simplifica.local", role: "recepcao", phone: "(11) 96666-3333", commission: 0 },
  ];
  const addUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, tenant_id, name, email, password_hash, role, phone, commission_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  users.forEach((user) => addUser.run(user.id, tenantId, user.name, user.email, hash,
    user.role, user.phone, user.commission));
  const assignCode = db.prepare("UPDATE users SET staff_code = ? WHERE id = ? AND tenant_id = ? AND staff_code IS NULL");
  for (const user of users.filter(user => user.role === "profissional")) {
    assignCode.run(allocateStaffCode(tenantId), user.id, tenantId);
  }

  const services = [
    { id: "service-corte-demo", name: "Corte feminino", duration: 60, price: 12000 },
    { id: "service-escova-demo", name: "Escova", duration: 45, price: 8000 },
    { id: "service-coloracao-demo", name: "Coloração", duration: 120, price: 26000 },
    { id: "service-manicure-demo", name: "Manicure", duration: 45, price: 6500 },
    { id: "service-hidratacao-demo", name: "Hidratação", duration: 60, price: 15000 },
  ];
  const addService = db.prepare(`
    INSERT OR IGNORE INTO services (id, tenant_id, name, duration_minutes, price_cents)
    VALUES (?, ?, ?, ?, ?)
  `);
  services.forEach((service) => addService.run(service.id, tenantId, service.name, service.duration, service.price));

  const assign = db.prepare(`
    INSERT OR IGNORE INTO professional_services (tenant_id, professional_id, service_id)
    VALUES (?, ?, ?)
  `);
  const anaServices = [services[0], services[1], services[2], services[4]];
  const luizaServices = [services[1], services[3], services[4]];
  anaServices.forEach((service) => assign.run(tenantId, "user-pro-ana-demo", service.id));
  luizaServices.forEach((service) => assign.run(tenantId, "user-pro-luiza-demo", service.id));

  const addBusinessHour = db.prepare(`
    INSERT OR IGNORE INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)
  `);
  const addProHour = db.prepare(`
    INSERT OR IGNORE INTO professional_hours (tenant_id, professional_id, weekday, opens_at, closes_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const weekdayOpen = weekday >= 1 && weekday <= 5 ? "09:00" : weekday === 6 ? "09:00" : null;
    const weekdayClose = weekday >= 1 && weekday <= 5 ? "19:00" : weekday === 6 ? "15:00" : null;
    addBusinessHour.run(tenantId, weekday, weekdayOpen, weekdayClose);
    for (const professionalId of ["user-pro-ana-demo", "user-pro-luiza-demo"]) {
      addProHour.run(tenantId, professionalId, weekday, weekdayOpen, weekdayClose);
    }
  }

  const addClient = db.prepare(`
    INSERT OR IGNORE INTO clients (id, tenant_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const clients = [
    ["client-demo-1", "Beatriz Almeida", "(11) 91111-0001", "bia@email.com", "Prefere horários pela manhã"],
    ["client-demo-2", "Fernanda Lima", "(11) 91111-0002", "fernanda@email.com", ""],
    ["client-demo-3", "Juliana Santos", "(11) 91111-0003", "", "Alergia a amônia"],
    ["client-demo-4", "Patrícia Mendes", "(11) 91111-0004", "", ""],
    ["client-demo-5", "Camila Ferreira", "(11) 91111-0005", "camila@email.com", ""],
    ["client-demo-6", "Isabela Nunes", "(11) 91111-0006", "", ""],
    ["client-demo-7", "Rafaela Martins", "(11) 91111-0007", "", "Cliente desde 2023"],
    ["client-demo-8", "Larissa Gomes", "(11) 91111-0008", "", ""],
    ["client-demo-9", "Débora Araújo", "(11) 91111-0009", "", "Última visita há mais de 30 dias"],
  ];
  clients.forEach((client) => addClient.run(client[0], tenantId, ...client.slice(1)));

  const addAppointment = db.prepare(`
    INSERT OR IGNORE INTO appointments
      (id, tenant_id, client_id, professional_id, service_id, starts_at, ends_at,
       status, price_cents, payment_method, commission_percent, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const samples = [
    [-20, "10:00", 0, "user-pro-ana-demo", 0, "concluido", "pix"],
    [-12, "13:00", 1, "user-pro-luiza-demo", 1, "concluido", "cartao_credito"],
    [-8, "15:00", 2, "user-pro-ana-demo", 2, "concluido", "dinheiro"],
    [-5, "11:00", 3, "user-pro-luiza-demo", 3, "concluido", "pix"],
    [-2, "14:00", 4, "user-pro-ana-demo", 4, "concluido", "cartao_debito"],
    [1, "10:00", 5, "user-pro-luiza-demo", 1, "confirmado", ""],
    [2, "11:00", 6, "user-pro-ana-demo", 0, "agendado", ""],
    [3, "14:00", 7, "user-pro-luiza-demo", 3, "agendado", ""],
    [-45, "10:00", 8, "user-pro-ana-demo", 4, "concluido", "pix"],
  ];
  samples.forEach(([offset, time, clientIndex, professionalId, serviceIndex, status, method], index) => {
    const service = services[serviceIndex];
    const startsAt = `${dateOffset(offset)}T${time}:00`;
    const [hour, minute] = time.split(":").map(Number);
    const total = hour * 60 + minute + service.duration;
    const endsAt = `${dateOffset(offset)}T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
    const commission = users.find((user) => user.id === professionalId).commission;
    addAppointment.run(`appointment-demo-${index + 1}`, tenantId, clients[clientIndex][0],
      professionalId, service.id, startsAt, endsAt, status, service.price, method, commission, "");
  });

  const blockDate = dateOffset(4);
  db.prepare(`
    INSERT OR IGNORE INTO blocked_slots (id, tenant_id, professional_id, starts_at, ends_at, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("block-demo-lunch", tenantId, null, `${blockDate}T12:00:00`, `${blockDate}T13:00:00`, "Horário de almoço");
});

seed();
console.log(`Dados de demonstração disponíveis em /agendar/studio-bela-vista. Login: ${process.env.DEMO_EMAIL ?? "admin@simplifica.local"}`);
