import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

test("atendimento antecipado entra no caixa da empresa e gera saldo quinzenal sem repasse", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "simplifica-fortnight-"));
  const keys = ["DATABASE_PATH", "INSTALL_TOKEN", "NODE_ENV", "DEMO_MODE"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATABASE_PATH = path.join(temp, "app.sqlite");
  process.env.INSTALL_TOKEN = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.DEMO_MODE = "false";
  const {default: app} = await import("../src/app.js");
  const {db} = await import("../src/database.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const request = async (route, method = "GET", body) => {
    const response = await fetch(base + "/api" + route, {
      method,
      headers: {...(body ? {"Content-Type":"application/json"} : {}), ...(cookie ? {Cookie:cookie} : {})},
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return {status:response.status, body:await response.json()};
  };
  try {
    assert.equal((await request("/installation/setup", "POST", {
      businessName:"Salão Teste",slug:"salao-quinzena",ownerName:"Dono",
      ownerEmail:"owner@fortnight.local",password:"Senha-Forte-Quinzena-123",
      installToken:process.env.INSTALL_TOKEN,
    })).status,201);
    const login = await request("/auth/login","POST",{
      email:"owner@fortnight.local",password:"Senha-Forte-Quinzena-123",
    });
    assert.equal(login.status,200);
    const tenant = login.body.user.tenantId;
    db.prepare(`INSERT INTO users(id,tenant_id,name,email,password_hash,role,commission_percent)
      VALUES(?,?,?,?,?,'profissional',?)`).run("pro-1",tenant,"Pedro","pro@fortnight.local","hash",40);
    db.prepare("INSERT INTO services(id,tenant_id,name,duration_minutes,price_cents) VALUES(?,?,?,?,?)")
      .run("service-1",tenant,"Corte",30,5000);
    db.prepare("INSERT INTO clients(id,tenant_id,name) VALUES(?,?,?)")
      .run("client-1",tenant,"Cliente");
    // Scheduling reserves time only. Even today's booking is valid before the cash register opens.
    db.prepare("UPDATE business_hours SET opens_at = '09:00', closes_at = '18:00' WHERE tenant_id = ?").run(tenant);
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-19T13:00:00Z") });
    try {
      const reservation = await request("/appointments", "POST", {
        clientId: "client-1", professionalId: "pro-1", serviceId: "service-1", startsAt: "2026-11-19T15:00:00",
      });
      assert.equal(reservation.status, 201);
      assert.equal((await request("/appointments/" + reservation.body.id, "PATCH", {status:"concluido"})).status,409);
    } finally {
      t.mock.timers.reset();
    }
    const current = (await request("/cash/daily")).body.today;
    const tomorrowDate = new Date(current + "T12:00:00Z");
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate()+1);
    const tomorrow = tomorrowDate.toISOString().slice(0,10);
    const add = db.prepare(`INSERT INTO appointments
      (id,tenant_id,client_id,professional_id,service_id,starts_at,ends_at,status,price_cents,commission_percent)
      VALUES(?,?,?,?,?,?,?,'confirmado',?,?)`);
    add.run("anticipated",tenant,"client-1","pro-1","service-1",tomorrow+"T10:00:00",tomorrow+"T10:30:00",5000,40);
    const unopened = await request("/appointments/anticipated","PATCH",{status:"concluido"});
    assert.equal(unopened.status,409);
    assert.match(unopened.body.error,/Abra o caixa/);
    assert.equal((await request("/cash/openings","POST",{date:current,openingCashCents:0})).status,201);
    const complete = await request("/appointments/anticipated","PATCH",{status:"concluido",paymentMethod:""});
    assert.equal(complete.status,200);
    assert.equal(db.prepare("SELECT completed_on FROM appointments WHERE id='anticipated'").get().completed_on,current);
    assert.equal((await request("/receivables/pending")).body.receivables.some(row => row.id === "anticipated"), true);
    assert.equal((await request("/cash/daily?date="+current)).body.expectedTotalCents,0);
    assert.equal((await request("/clients")).body.clients.find(row => row.id === "client-1").lastVisit,current);
    const overview = await request("/overview");
    assert.equal(overview.status,200);
    assert.equal(overview.body.upcoming.some(item=>item.id==="anticipated"),false);
    const schedule = await request("/schedule?from="+tomorrow+"T00:00:00&to="+tomorrow+"T23:59:59");
    assert.equal(schedule.status,200);
    assert.equal(schedule.body.appointments.some(item=>item.id==="anticipated"),false);
    const history = await request("/clients/client-1/history");
    const completed = history.body.history.find(item => item.id === "anticipated");
    assert.equal(completed.startsAt, tomorrow + "T10:00:00");
    assert.equal(completed.completedOn, current);

    db.prepare("UPDATE business_hours SET opens_at = '09:00', closes_at = '18:00' WHERE tenant_id = ?").run(tenant);
    const slotsRoute = "/public/salao-quinzena/slots?serviceId=service-1&professionalId=pro-1&date=" + tomorrow;
    assert.ok((await request(slotsRoute)).body.slots.includes("10:00"));
    const replacement = await request("/public/salao-quinzena/appointments", "POST", {
      name: "Novo cliente", phone: "85900000001", startsAt: tomorrow + "T10:00:00",
      serviceId: "service-1", professionalId: "pro-1",
    });
    assert.equal(replacement.status, 201);
    assert.equal((await request("/appointments/anticipated", "PATCH", {status:"agendado"})).status, 409);

    assert.equal((await request("/receivables/anticipated/pay","POST",{paymentMethod:"pix"})).status,200);
    const day = await request("/cash/daily?date="+current);
    assert.equal(day.body.expectedTotalCents,5000);
    assert.equal(day.body.methods.pix,5000);
    assert.equal(day.body.methods.dinheiro,0);
    const period = current.slice(0,7) + "-" + (Number(current.slice(8,10)) <= 15 ? "1" : "2");
    const wages = await request("/settlements?period="+period);
    assert.equal(wages.status,200);
    assert.equal(wages.body.professionals[0].dueCents,2000);
    assert.equal(wages.body.professionals[0].paidCents,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM commission_payments").get().n,0);
    assert.equal((await request("/commissions/anticipated/pay","POST")).status,409);

    // Legacy receipts remain visible to reconcile, but are not automatically dated.
    db.prepare(`INSERT INTO appointments(id,tenant_id,client_id,professional_id,service_id,
      starts_at,ends_at,status,price_cents,payment_method,commission_percent)
      VALUES(?,?,?,?,?,? ,?,'concluido',?,'pix',?)`)
      .run("legacy",tenant,"client-1","pro-1","service-1",tomorrow+"T11:00:00",
        tomorrow+"T11:30:00",2500,40);
    const legacy = await request("/cash/unreconciled");
    assert.equal(legacy.body.receipts.some(row=>row.id==="legacy"),true);
    assert.equal((await request("/cash/reconcile/legacy","POST",{date:current})).status,200);
    assert.equal((await request("/cash/reconcile/legacy","POST",{date:current})).status,409);
    assert.equal((await request("/cash/daily?date="+current)).body.expectedTotalCents,7500);
    const directPayload = {clientId:"client-1", professionalId:"pro-1", serviceId:"service-1"};
    const direct = await request("/direct-services","POST",directPayload);
    assert.equal(direct.status,201);
    const directId = direct.body.id;
    assert.equal(direct.body.completedOn,current);
    const directRow = db.prepare("SELECT * FROM appointments WHERE id=?").get(directId);
    assert.equal(directRow.booking_source,"direct");
    assert.equal(directRow.status,"concluido");
    assert.equal((await request("/schedule?from="+current+"T00:00:00&to="+current+"T23:59:59")).body.appointments.some(row=>row.id===directId),false);
    assert.equal((await request("/receivables/pending")).body.receivables.some(row=>row.id===directId),true);
    assert.equal((await request("/cash/daily?date="+current)).body.expectedTotalCents,7500);
    const directPaid = await request("/direct-services","POST",{...directPayload,paymentMethod:"pix"});
    assert.equal(directPaid.status,201);
    assert.equal((await request("/cash/daily?date="+current)).body.expectedTotalCents,12500);
    const commissions = (await request("/commissions?month="+current.slice(0,7))).body.commissions;
    assert.equal(commissions.find(row=>row.id===directId).earnedCents,2000);
    assert.equal(commissions.find(row=>row.id===directId).paymentMethod,"");
    const summary = (await request("/settlements?period="+period)).body.professionals[0];
    assert.ok(summary.customerPendingCents >= 5000);
    assert.ok(summary.receivedCents >= 5000);
    assert.equal((await request("/receivables/"+directId+"/pay","POST",{paymentMethod:"pix"})).status,200);
    assert.equal((await request("/receivables/"+directId+"/pay","POST",{paymentMethod:"pix"})).status,409);
    assert.equal((await request("/cash/daily?date="+current)).body.expectedTotalCents,17500);
    assert.equal((await request("/cash/closings","POST",{date:current,countedCashCents:0})).status,201);
    assert.equal((await request("/direct-services","POST",directPayload)).status,409);
    assert.equal((await request("/cash/reconcile/legacy","POST",{date:current})).status,409);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    db.close();
    for (const [key,value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key]=value;
    }
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
