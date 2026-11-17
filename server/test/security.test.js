import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

test("commercial setup, authenticated account and staff password rotation", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "simplifica-security-"));
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    INSTALL_TOKEN: process.env.INSTALL_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    DEMO_MODE: process.env.DEMO_MODE,
  };
  process.env.DATABASE_PATH = path.join(tmp, "test.sqlite");
  process.env.INSTALL_TOKEN = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.DEMO_MODE = "false";

  const { default: app } = await import("../src/app.js");
  const { db } = await import("../src/database.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  async function request(route, method = "GET", body, headers = {}) {
    const response = await fetch(`${base}/api${route}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  try {
    assert.equal((await request("/installation/status")).body.needsSetup, true);
    const setup = await request("/installation/setup", "POST", {
      businessName: "Comércio Teste", slug: "comercio-teste", ownerName: "Administrador",
      ownerEmail: "dono@teste.local", password: "Password-Forte-1234",
      installToken: process.env.INSTALL_TOKEN,
    });
    assert.equal(setup.status, 201);
    assert.equal((await request("/installation/status")).body.needsSetup, false);
    assert.equal((await request("/installation/setup", "POST", { installToken: process.env.INSTALL_TOKEN })).status, 409);

    const denied = await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "senha-incorreta",
    });
    assert.equal(denied.status, 401);

    const login = await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "Password-Forte-1234",
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.slug, "comercio-teste");
    assert.equal((await request("/account")).body.account.name, "Administrador");

    const blockedOrigin = await request("/account", "PATCH", {
      currentPassword: "Password-Forte-1234", name: "Invasor",
    }, { Origin: "https://example.invalid" });
    assert.equal(blockedOrigin.status, 403);
    const wrongPassword = await request("/account", "PATCH", {
      currentPassword: "errada", name: "Novo Nome",
    });
    assert.equal(wrongPassword.status, 403);
    const changed = await request("/account", "PATCH", {
      currentPassword: "Password-Forte-1234", newPassword: "Nova-Senha-Forte-1234", name: "Novo Nome",
    });
    assert.equal(changed.status, 200);
    assert.equal((await request("/account")).body.account.name, "Novo Nome");

    // A completed service is not a received payment until payment is explicitly registered.
    const staffId = "p-test";
    const serviceId = "s-test";
    const clientId = "c-test";
    const apptId = "a-test";
    db.prepare(`INSERT INTO users (id, tenant_id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?, 'profissional')`)
      .run(staffId, login.body.user.tenantId, "Profissional", "pro@teste.local", "hash-irrelevante");
    db.prepare("INSERT INTO services (id, tenant_id, name, duration_minutes, price_cents) VALUES (?, ?, ?, ?, ?)")
      .run(serviceId, login.body.user.tenantId, "Serviço", 30, 7500);
    db.prepare("INSERT INTO clients (id, tenant_id, name) VALUES (?, ?, ?)")
      .run(clientId, login.body.user.tenantId, "Cliente");
    db.prepare(`INSERT INTO appointments (id, tenant_id, client_id, professional_id, service_id,
      starts_at, ends_at, status, price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, 'concluido', ?)`)
      .run(apptId, login.body.user.tenantId, clientId, staffId, serviceId,
        "2026-11-10T10:00:00", "2026-11-10T10:30:00", 7500);
    const pendingReport = await request("/reports?month=2026-11");
    assert.equal(pendingReport.body.revenueCents, 0);
    assert.equal(pendingReport.body.pendingCents, 7500);
    const receivables = await request("/receivables?month=2026-11");
    assert.equal(receivables.body.receivables[0].paid, false);
    assert.equal((await request(`/receivables/${apptId}/pay`, "POST", { paymentMethod: "pix" })).status, 200);
    assert.equal((await request(`/receivables/${apptId}/pay`, "POST", { paymentMethod: "pix" })).status, 409);
    const paidReport = await request("/reports?month=2026-11");
    assert.equal(paidReport.body.revenueCents, 7500);
    assert.equal(paidReport.body.pendingCents, 0);

    // Professional must be scoped to assigned work, without financial edit rights.
    const profPassword = "Abcd123";
    db.prepare("UPDATE users SET password_hash = ?, staff_code = ? WHERE id = ?")
      .run(await bcrypt.hash(profPassword, 12), "001", staffId);
    db.prepare(`INSERT INTO appointments (id, tenant_id, client_id, professional_id, service_id,
      starts_at, ends_at, status, price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmado', ?)`)
      .run("a-prof-test", login.body.user.tenantId, clientId, staffId, serviceId,
        "2026-11-10T11:00:00", "2026-11-10T11:30:00", 7500);
    const professionalLogin = await request("/auth/staff-login", "POST", {
      slug: "comercio-teste", staffCode: "001", password: profPassword,
    });
    assert.equal(professionalLogin.status, 200);
    assert.equal(professionalLogin.body.user.role, "profissional");
    assert.equal((await request("/professional/my-services?month=2026-11")).status, 200);
    assert.equal((await request("/appointments/a-prof-test", "PATCH", {
      status: "concluido", paymentMethod: "pix", priceCents: 1,
    })).status, 403);
    assert.equal((await request("/professional/my-services/a-prof-test/complete", "POST")).status, 200);
    assert.equal((await request("/professional/my-services/a-prof-test/complete", "POST")).status, 409);
    const staffWork = await request("/professional/my-services?month=2026-11");
    assert.equal(staffWork.body.totals.completed, 2);
    assert.equal((await request("/team-members")).status, 403);
    assert.equal((await request("/receivables?month=2026-11")).status, 403);
    const commercialReturn = await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "Nova-Senha-Forte-1234",
    });
    assert.equal(commercialReturn.status, 200);

    // Demo can browse but cannot change appointments, settings, or export real data.
    const demoHash = await bcrypt.hash("Demo-Senha-Forte-1234", 12);
    db.prepare("INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)")
      .run("tenant-salao-demo", "Salão Demo", "studio-bela-vista");
    db.prepare("INSERT INTO business_settings (tenant_id, business_name) VALUES (?, ?)")
      .run("tenant-salao-demo", "Salão Demo");
    db.prepare(`INSERT INTO users (id, tenant_id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?, 'dono')`)
      .run("owner-demo", "tenant-salao-demo", "Demo", "demo@teste.local", demoHash);
    const demoLogin = await request("/auth/login", "POST", {
      email: "demo@teste.local", password: "Demo-Senha-Forte-1234",
    });
    assert.equal(demoLogin.status, 200);
    assert.equal((await request("/account")).status, 200);
    assert.equal((await request("/clients", "POST", { name: "Não salvar" })).status, 403);
    assert.equal((await request("/export/backup")).status, 403);
    assert.equal((await request("/public/studio-bela-vista/appointments", "POST", {})).status, 403);
    assert.equal((await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "Nova-Senha-Forte-1234",
    })).status, 200);
    assert.equal((await request("/export/backup")).status, 403);

    const createdStaff = await request("/team-members", "POST", {
      name: "Profissional Sem Email", role: "profissional", commissionPercent: 30, serviceIds: [serviceId],
    });
    assert.equal(createdStaff.status, 201);
    assert.equal(createdStaff.body.staffCode, "002");
    assert.ok(createdStaff.body.activationToken);
    const wrongActivation = await request("/auth/activate-professional", "POST", {
      slug: "comercio-teste", staffCode: "002", activationToken: "errado", password: "Abcd123",
    });
    assert.equal(wrongActivation.status, 403);
    const activation = await request("/auth/activate-professional", "POST", {
      slug: "comercio-teste", staffCode: "002", activationToken: createdStaff.body.activationToken, password: "Abcd123",
    });
    assert.equal(activation.status, 200);
    assert.equal((await request("/auth/activate-professional", "POST", {
      slug: "comercio-teste", staffCode: "002", activationToken: createdStaff.body.activationToken, password: "Abcd123",
    })).status, 403);
    const staffCodeLogin = await request("/auth/staff-login", "POST", {
      slug: "comercio-teste", staffCode: "002", password: "Abcd123",
    });
    assert.equal(staffCodeLogin.status, 200);
    assert.equal(staffCodeLogin.body.user.staffCode, "002");
    assert.equal(staffCodeLogin.body.user.email, "");
    assert.equal((await request("/auth/login", "POST", {
      email: `${createdStaff.body.id}@staff.invalid`, password: "Abcd123",
    })).status, 401);
    assert.equal((await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "Nova-Senha-Forte-1234",
    })).status, 200);
    const newActivation = await request(`/team-members/${createdStaff.body.id}/activation`, "POST");
    assert.equal(newActivation.status, 200);
    assert.equal(newActivation.body.staffCode, "002");
    const member = await request("/team-members", "POST", {
      name: "Recepcionista", email: "recepcao@teste.local", password: "Senha-Inicial-1234",
      role: "recepcao",
    });
    assert.equal(member.status, 201);
    const reset = await request(`/team-members/${member.body.id}/reset-password`, "POST", {
      password: "Senha-Renovada-1234",
    });
    assert.equal(reset.status, 200);
    const badMemberLogin = await request("/auth/login", "POST", {
      email: "recepcao@teste.local", password: "Senha-Inicial-1234",
    });
    assert.equal(badMemberLogin.status, 401);
    const goodMemberLogin = await request("/auth/login", "POST", {
      email: "recepcao@teste.local", password: "Senha-Renovada-1234",
    });
    assert.equal(goodMemberLogin.status, 200);
    assert.equal(goodMemberLogin.body.user.role, "recepcao");
    const deniedReset = await request(`/team-members/${member.body.id}/reset-password`, "POST", {
      password: "Outra-Senha-Forte-1234",
    });
    assert.equal(deniedReset.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
