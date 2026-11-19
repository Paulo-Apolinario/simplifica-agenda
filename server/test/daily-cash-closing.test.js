import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

test("fechamento diário por data de recebimento, permissões e bloqueio de lançamentos", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "simplifica-cash-"));
  const keys = ["DATABASE_PATH", "INSTALL_TOKEN", "NODE_ENV", "DEMO_MODE"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATABASE_PATH = path.join(tmp, "cash.sqlite");
  process.env.INSTALL_TOKEN = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.DEMO_MODE = "false";
  const { default: app } = await import("../src/app.js");
  const { db } = await import("../src/database.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  const request = async (route, method = "GET", body) => {
    const response = await fetch(base + "/api" + route, {
      method, headers: { ...(body ? {"Content-Type":"application/json"} : {}), ...(cookie ? {Cookie:cookie} : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return {status:response.status, body: await response.json()};
  };
  try {
    assert.equal((await request("/installation/setup", "POST", {
      businessName:"Caixa Teste", slug:"caixa-teste", ownerName:"Administrador",
      ownerEmail:"admin@cash.local", password:"Senha-Forte-Cash123",
      installToken:process.env.INSTALL_TOKEN,
    })).status, 201);
    const login = await request("/auth/login", "POST", {email:"admin@cash.local",password:"Senha-Forte-Cash123"});
    assert.equal(login.status, 200);
    const tenant = login.body.user.tenantId;
    db.prepare("INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?, ?, ?, ?, ?, 'profissional')")
      .run("cash-pro",tenant,"Profissional","pro@cash.local","hash");
    db.prepare("INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?, ?, ?, ?, ?, 'recepcao')")
      .run("cash-reception",tenant,"Recepção","reception@cash.local",await bcrypt.hash("Senha-Recepcao-123",12));
    db.prepare("INSERT INTO services (id,tenant_id,name,duration_minutes,price_cents) VALUES (?, ?, ?, ?, ?)")
      .run("cash-service",tenant,"Corte",30,8500);
    db.prepare("INSERT INTO clients (id,tenant_id,name) VALUES (?, ?, ?)").run("cash-client",tenant,"Cliente");
    const add = db.prepare(`INSERT INTO appointments (id,tenant_id,client_id,professional_id,service_id,
      starts_at,ends_at,status,price_cents) VALUES (?,?,?,?,?,?,?,'concluido',?)`);
    add.run("cash-a",tenant,"cash-client","cash-pro","cash-service","2026-11-01T09:00:00","2026-11-01T09:30:00",8500);
    add.run("cash-b",tenant,"cash-client","cash-pro","cash-service","2026-11-01T10:00:00","2026-11-01T10:30:00",1500);
    add.run("cash-c",tenant,"cash-client","cash-pro","cash-service","2026-11-01T11:00:00","2026-11-01T11:30:00",2000);
    const initial = await request("/cash/daily");
    assert.equal(initial.status, 200);
    const today = initial.body.today;
    const priorDate = new Date(today + "T12:00:00Z");
    priorDate.setUTCDate(1);
    priorDate.setUTCMonth(priorDate.getUTCMonth() - 1);
    const priorDay = priorDate.toISOString().slice(0, 10);
    db.prepare("UPDATE appointments SET completed_on = ? WHERE id = 'cash-b'").run(priorDay);
    const priorMonth = priorDay.slice(0, 7);
    assert.equal((await request("/receivables?month=" + priorMonth)).body.receivables.find(row => row.id === "cash-b")?.paid, false);
    const pendingBefore = await request("/receivables/pending");
    assert.equal(pendingBefore.status, 200);
    assert.deepEqual(pendingBefore.body.receivables.map(row => row.id).sort(), ["cash-a", "cash-b", "cash-c"]);
    assert.equal(pendingBefore.body.receivables.find(row => row.id === "cash-b").professionalName, "Profissional");
    // A previous cash closing must succeed even with an outstanding service.
    const previousClosing = await request("/cash/closings", "POST", {date:priorDay,countedCashCents:0});
    assert.equal(previousClosing.status, 201);
    assert.equal((await request("/cash/daily?date=" + priorDay)).body.closing.expectedTotalCents, 0);

    assert.equal((await request("/cash/openings","POST",{date:today,openingCashCents:0})).status,201);
    assert.equal((await request("/receivables/cash-a/pay", "POST", {paymentMethod:"dinheiro"})).status, 200);
    assert.equal((await request("/receivables/cash-b/pay", "POST", {paymentMethod:"pix"})).status, 200);
    const currentReceipts = await request("/receivables?month=" + today.slice(0, 7));
    assert.equal(currentReceipts.body.receivables.find(row => row.id === "cash-b")?.paidOn, today);
    assert.equal((await request("/cash/daily?date=" + priorDay)).body.expectedTotalCents, 0);
    assert.equal((await request("/cash/daily?date=" + priorDay)).body.closing.expectedTotalCents, 0);
    const priorReceipts = await request("/receivables?month=" + priorMonth);
    assert.equal(priorReceipts.body.completedCount >= 1, true);
    assert.equal(priorReceipts.body.receivables.some(row => row.id === "cash-b"), false);
    const monthReport = await request("/reports?month=" + today.slice(0, 7));
    assert.equal(monthReport.body.revenueCents, 10000);
    assert.equal((await request("/reports?month=" + priorMonth)).body.revenueCents, 0);


    const report = await request("/cash/daily?date=" + today);
    assert.equal(report.body.expectedTotalCents, 10000);
    assert.equal(report.body.expectedCashCents, 8500);
    assert.equal(report.body.methods.pix, 1500);
    assert.equal(report.body.receiptCount, 2);
    assert.deepEqual(report.body.receipts.map(row => row.id).sort(), ["cash-a", "cash-b"]);
    assert.ok(report.body.receipts.every(row => row.paidOn === today && row.clientName === "Cliente" && row.serviceName === "Corte" && row.professionalName === "Profissional"));
    assert.deepEqual((await request("/receivables/pending")).body.receivables.map(row => row.id), ["cash-c"]);
    const earlierDate = new Date(priorDay + "T12:00:00Z");
    earlierDate.setUTCDate(earlierDate.getUTCDate() + 1);
    const earlierDay = earlierDate.toISOString().slice(0, 10);
    add.run("cash-previous",tenant,"cash-client","cash-pro","cash-service",earlierDay+"T09:00:00",earlierDay+"T09:30:00",5000);
    db.prepare("UPDATE appointments SET payment_method = 'pix', paid_on = ? WHERE id = 'cash-previous'").run(earlierDay);
    assert.deepEqual((await request("/cash/daily?date=" + earlierDay)).body.receipts.map(row => row.id), ["cash-previous"]);
    assert.deepEqual((await request("/cash/daily?date=" + today)).body.receipts.map(row => row.id).sort(), ["cash-a", "cash-b"]);
    assert.equal((await request("/cash/closings", "POST", {date:today,countedCashCents:8300,notes:"Diferença conferida"})).status, 201);
    assert.equal((await request("/cash/closings", "POST", {date:today,countedCashCents:8500})).status, 409);
    assert.equal((await request("/receivables/cash-c/pay", "POST", {paymentMethod:"pix"})).status, 409);
    assert.equal((await request("/appointments/cash-a", "PATCH", {priceCents:500})).status, 409);
    const closed = await request("/cash/daily?date=" + today);
    assert.equal(closed.body.closing.differenceCents, -200);
    assert.equal(closed.body.closing.expectedTotalCents, 10000);
    assert.equal((await request("/cash/closings")).body.closings.length, 2);
    assert.equal((await request("/cash/daily?date=2030-02-30")).status, 400);
    const recep = await request("/auth/login", "POST", {email:"reception@cash.local",password:"Senha-Recepcao-123"});
    assert.equal(recep.status, 200);
    assert.equal((await request("/cash/daily?date=" + today)).status, 200);
    assert.equal((await request("/cash/closings")).status, 403);
    assert.equal((await request("/cash/closings", "POST", {date:priorDay,countedCashCents:0})).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(tmp, {recursive:true,force:true});
  }
});
