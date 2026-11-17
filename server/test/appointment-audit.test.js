import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

test("audit trail respects tenant isolation and records status changes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "simplifica-audit-"));
  const old = Object.fromEntries(["DATABASE_PATH", "INSTALL_TOKEN", "NODE_ENV", "DEMO_MODE"].map(key => [key, process.env[key]]));
  process.env.DATABASE_PATH = path.join(tmp, "audit.sqlite");
  process.env.INSTALL_TOKEN = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.DEMO_MODE = "false";
  const { default: app } = await import("../src/app.js");
  const { db } = await import("../src/database.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const request = async (route, method = "GET", body) => {
    const response = await fetch(base + "/api" + route, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request("/installation/setup", "POST", {
      businessName: "Auditoria Teste", slug: "auditoria-teste", ownerName: "Dono",
      ownerEmail: "dono@audit.local", password: "Senha-Forte-Audit123",
      installToken: process.env.INSTALL_TOKEN,
    })).status, 201);
    const login = await request("/auth/login", "POST", {email:"dono@audit.local", password:"Senha-Forte-Audit123"});
    assert.equal(login.status, 200);
    const tenantId = login.body.user.tenantId;
    db.prepare("INSERT INTO users (id,tenant_id,name,email,password_hash,role) VALUES (?, ?, ?, ?, ?, 'profissional')")
      .run("audit-pro", tenantId, "Profissional", "pro@audit.local", "hash");
    db.prepare("INSERT INTO services (id,tenant_id,name,duration_minutes,price_cents) VALUES (?, ?, ?, ?, ?)")
      .run("audit-service",tenantId,"Corte",30,5000);
    db.prepare("INSERT INTO clients (id,tenant_id,name) VALUES (?, ?, ?)").run("audit-client",tenantId,"Cliente");
    db.prepare(`INSERT INTO appointments(id,tenant_id,client_id,professional_id,service_id,starts_at,ends_at,price_cents)
      VALUES(?,?,?,?,?,?,?,?)`).run("audit-appt",tenantId,"audit-client","audit-pro","audit-service",
      "2030-01-08T10:00:00","2030-01-08T10:30:00",5000);
    assert.equal((await request("/appointments/audit-appt", "PATCH", {status:"confirmado"})).status, 200);
    const audit = await request("/reports/appointment-audit?month=2026-11");
    assert.equal(audit.status, 200);
    assert.equal(audit.body.events.length, 1);
    assert.equal(audit.body.events[0].action, "status");
    assert.equal(audit.body.events[0].actorName, "Dono");
    assert.equal(audit.body.events[0].after.status, "confirmado");
    assert.equal((await request("/reports/appointment-audit?month=invalid")).status, 400);
    assert.equal((await request("/reports/appointment-audit?month=2026-11&action=invalid")).status, 400);
    assert.equal(db.prepare("SELECT count(*) AS count FROM appointment_audit WHERE tenant_id = 'foreign'").get().count, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
