import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

test("atendimento antecipado entra no caixa da empresa e gera saldo quinzenal sem repasse", async () => {
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
    const complete = await request("/appointments/anticipated","PATCH",{status:"concluido"});
    assert.equal(complete.status,200);
    assert.equal(db.prepare("SELECT completed_on FROM appointments WHERE id='anticipated'").get().completed_on,current);
    const overview = await request("/overview");
    assert.equal(overview.status,200);
    assert.equal(overview.body.upcoming.some(item=>item.id==="anticipated"),false);
    const schedule = await request("/schedule?from="+tomorrow+"T00:00:00&to="+tomorrow+"T23:59:59");
    assert.equal(schedule.status,200);
    assert.equal(schedule.body.appointments.some(item=>item.id==="anticipated"),false);
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
    assert.equal((await request("/cash/closings","POST",{date:current,countedCashCents:0})).status,201);
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
