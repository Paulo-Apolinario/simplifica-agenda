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
    db.prepare("UPDATE users SET password_hash = ?, staff_code = ?, login_code = ? WHERE id = ?")
      .run(await bcrypt.hash(profPassword, 12), "001", "001", staffId);
    db.prepare(`INSERT INTO appointments (id, tenant_id, client_id, professional_id, service_id,
      starts_at, ends_at, status, price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmado', ?)`)
      .run("a-prof-test", login.body.user.tenantId, clientId, staffId, serviceId,
        "2026-11-10T11:00:00", "2026-11-10T11:30:00", 7500);
    db.prepare("UPDATE appointments SET commission_percent = 40 WHERE id = ?").run("a-prof-test");
    db.prepare("INSERT INTO professional_services (tenant_id, professional_id, service_id) VALUES (?, ?, ?)")
      .run(login.body.user.tenantId, staffId, serviceId);
    db.prepare("INSERT INTO professional_hours (tenant_id, professional_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?, ?)")
      .run(login.body.user.tenantId, staffId, 2, "09:00", "18:00");
    // The booking directory shows business clients with minimum information
    // even before this professional has served them.
    db.prepare("INSERT INTO clients (id, tenant_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run("shared-client", login.body.user.tenantId, "Cliente compartilhada", "85999990000",
        "private@example.com", "Anotação confidencial");
    const professionalLogin = await request("/auth/staff-login", "POST", {
      slug: "comercio-teste", staffCode: "001", password: profPassword,
    });
    assert.equal(professionalLogin.status, 200);
    assert.equal(professionalLogin.body.user.role, "profissional");
    assert.equal(professionalLogin.body.user.staffCode, "001");
    assert.equal((await request("/auth/staff-login", "POST", {
      staffCode: "001", password: profPassword,
    })).status, 200);
    const sharedDirectory = await request("/booking/clients");
    assert.equal(sharedDirectory.status, 200);
    const visibleShared = sharedDirectory.body.clients.find(row => row.id === "shared-client");
    assert.equal(visibleShared.name, "Cliente compartilhada");
    assert.equal(visibleShared.phone, "85999990000");
    assert.equal(Object.hasOwn(visibleShared, "notes"), false);
    assert.equal(Object.hasOwn(visibleShared, "email"), false);
    const privateList = await request("/clients");
    assert.equal(privateList.body.clients.some(row => row.id === "shared-client"), false);
    const quickClient = await request("/booking/clients", "POST", {
      name: "Cliente via profissional", phone: "85988887777",
    });
    assert.equal(quickClient.status, 201);
    assert.equal((await request("/booking/clients", "POST", {
      name: "Duplicada", phone: "85988887777",
    })).status, 409);
    const otherTenant = db.prepare("SELECT tenant_id AS tenantId FROM clients WHERE id = ?")
      .get(quickClient.body.client.id);
    assert.equal(otherTenant.tenantId, login.body.user.tenantId);

    assert.equal((await request("/professional/my-services?month=2026-11")).status, 200);
    assert.equal((await request("/appointments/a-prof-test", "PATCH", {
      status: "concluido", paymentMethod: "pix", priceCents: 1,
    })).status, 403);
    assert.equal((await request("/professional/my-services/a-prof-test/complete", "POST")).status, 200);
    assert.equal((await request("/professional/my-services/a-prof-test/complete", "POST")).status, 409);
    const staffWork = await request("/professional/my-services?month=2026-11");
    assert.equal(staffWork.body.totals.completed, 2);
    // Only personal blocks are permitted for staff. Blocking with a reason does not need a client.
    const deniedBlock = await request("/blocked-slots", "POST", {
      professionalId: "another-professional", startsAt: "2030-01-08T12:00:00",
      endsAt: "2030-01-08T13:00:00", reason: "Almoço",
    });
    assert.equal(deniedBlock.status, 403);
    const ownBlock = await request("/blocked-slots", "POST", {
      startsAt: "2030-01-08T12:00:00", endsAt: "2030-01-08T13:00:00", reason: "Almoço",
    });
    assert.equal(ownBlock.status, 201);
    const schedule = await request("/schedule?from=2030-01-08T00:00:00&to=2030-01-09T00:00:00");
    assert.equal(schedule.body.blockedSlots.some(row => row.id === ownBlock.body.id && row.reason === "Almoço"), true);
    assert.equal(schedule.body.blockedSlots.find(row => row.id === ownBlock.body.id).createdByName, "Profissional");
    const anonymousAppointment = await request("/appointments", "POST", {
      professionalId: staffId, serviceId, startsAt: "2030-01-08T10:00:00", notes: "Sem cadastro de cliente",
    });
    assert.equal(anonymousAppointment.status, 201);
    const bookedShared = await request("/appointments", "POST", {
      clientId: "shared-client", professionalId: staffId,
      serviceId, startsAt: "2030-01-08T14:00:00",
    });
    assert.equal(bookedShared.status, 201);
    const bookedQuick = await request("/appointments", "POST", {
      clientId: quickClient.body.client.id, professionalId: staffId,
      serviceId, startsAt: "2030-01-08T15:00:00",
    });
    assert.equal(bookedQuick.status, 201);
    // A service registered by the establishment may be booked by the professional
    // without any explicit professional_services assignment.
    db.prepare(`INSERT INTO services (id, tenant_id, name, duration_minutes, price_cents, house_share_percent)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run("unassigned-service", login.body.user.tenantId, "Coloração sem vínculo", 30, 12000, 10);
    assert.equal(db.prepare(`SELECT count(*) AS total FROM professional_services
      WHERE tenant_id = ? AND professional_id = ? AND service_id = ?`)
      .get(login.body.user.tenantId, staffId, "unassigned-service").total, 0);
    const unassignedAppointment = await request("/appointments", "POST", {
      clientId: "shared-client", professionalId: staffId,
      serviceId: "unassigned-service", startsAt: "2030-01-08T16:00:00",
    });
    assert.equal(unassignedAppointment.status, 201);
    const booked = db.prepare(`SELECT a.price_cents AS priceCents,
      a.house_share_percent AS houseSharePercent, a.professional_id AS professionalId
      FROM appointments a WHERE a.id = ? AND a.tenant_id = ?`)
      .get(unassignedAppointment.body.id, login.body.user.tenantId);
    assert.equal(booked.priceCents, 12000);
    assert.equal(booked.houseSharePercent, 10);
    assert.equal(booked.professionalId, staffId);

    const anonymous = db.prepare("SELECT c.name FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.id = ?")
      .get(anonymousAppointment.body.id);
    assert.equal(anonymous.name, "Cliente não informado");
    const visibleClients = await request("/clients");
    assert.equal(visibleClients.body.clients.some(c => c.name === "Cliente não informado"), false);
    const staffEarnings = await request("/professional/earnings?month=2026-11");
    assert.equal(staffEarnings.status, 200);
    assert.equal(staffEarnings.body.dueCents, 3000);
    assert.equal(staffEarnings.body.services.find(row=>row.id === "a-prof-test").earnedCents, 3000);
    assert.equal((await request(`/blocked-slots/${ownBlock.body.id}`, "DELETE")).status, 204);

    assert.equal((await request("/team-members")).status, 403);
    assert.equal((await request("/receivables?month=2026-11")).status, 403);
    const commercialReturn = await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "Nova-Senha-Forte-1234",
    });
    assert.equal(commercialReturn.status, 200);
    // Owner records payment; professional sees accurate due/paid balance.
    const listCommissions = await request("/commissions?month=2026-11");
    assert.equal(listCommissions.status, 200);
    assert.equal(listCommissions.body.commissions.find(row => row.id === "a-prof-test").earnedCents, 3000);
    const adjustment = await request("/commissions/a-prof-test", "PATCH", {
      commissionPercent: 50, houseSharePercent: 10, reason: "Material fornecido pelo estabelecimento",
    });
    assert.equal(adjustment.status, 200);
    assert.equal(adjustment.body.earnedCents, 3000);
    assert.equal(db.prepare("SELECT count(*) AS n FROM commission_adjustments WHERE appointment_id = ?")
      .get("a-prof-test").n, 1);
    const payCommission = await request("/commissions/a-prof-test/pay", "POST");
    assert.equal(payCommission.status, 200);
    assert.equal(payCommission.body.amountCents, 3000);
    assert.equal((await request("/commissions/a-prof-test/pay", "POST")).status, 409);
    assert.equal((await request("/commissions/a-prof-test", "PATCH", {
      commissionPercent: 42, houseSharePercent: 10, reason: "Produtos do estabelecimento",
    })).status, 409);
    assert.equal((await request("/appointments/a-prof-test", "PATCH", { priceCents: 1 })).status, 409);


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
    assert.equal(createdStaff.body.loginCode, "002");
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
    // Custom job functions and employees who do not have system accounts.
    const support = await request("/team-members", "POST", {
      name: "Funcionária de apoio", jobTitle: "Copeira", role: "sem_acesso",
    });
    assert.equal(support.status, 201);
    const teamList = await request("/team-members");
    assert.equal(teamList.body.team.some(row => row.id === support.body.id && row.jobTitle === "Copeira" && row.role === "sem_acesso"), true);
    assert.equal((await request(`/team-members/${support.body.id}`, "PATCH", {
      name: "Funcionária de apoio", jobTitle: "Serviços gerais", active: true,
    })).status, 200);
    const changedJob = await request("/team-members");
    assert.equal(changedJob.body.team.find(row => row.id === support.body.id).jobTitle, "Serviços gerais");

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
