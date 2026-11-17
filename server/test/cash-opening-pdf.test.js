import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

test("abertura, saldo inicial, fechamento e PDF imutável", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cash-opening-"));
  const keys = ["DATABASE_PATH","INSTALL_TOKEN","NODE_ENV","DEMO_MODE"];
  const old = Object.fromEntries(keys.map(key=>[key, process.env[key]]));
  process.env.DATABASE_PATH = path.join(temp,"test.sqlite");
  process.env.INSTALL_TOKEN = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.DEMO_MODE = "false";
  const {default:app} = await import("../src/app.js");
  const {db} = await import("../src/database.js");
  const server = app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  async function request(route, method="GET", body) {
    const response = await fetch(base+"/api"+route, {
      method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{})},
      body:body?JSON.stringify(body):undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return {status:response.status, body:await response.json()};
  }
  try {
    const setup = await request("/installation/setup","POST",{
      businessName:"Salão de Teste",slug:"salao-pdf",ownerName:"Dono",
      ownerEmail:"cashowner@test.local",password:"Senha-Segura-12345",
      installToken:process.env.INSTALL_TOKEN,
    });
    assert.equal(setup.status,201);
    const login = await request("/auth/login","POST",{email:"cashowner@test.local",password:"Senha-Segura-12345"});
    assert.equal(login.status,200);
    const tenant = login.body.user.tenantId;
    const today = (await request("/cash/daily")).body.today;
    assert.equal((await request("/cash/openings","POST",{date:today,openingCashCents:-1})).status,400);
    assert.equal((await request("/cash/openings","POST",{
      date:today,openingCashCents:10000,notes:"Troco inicial",
    })).status,201);
    assert.equal((await request("/cash/openings","POST",{date:today,openingCashCents:10000})).status,409);
    assert.equal((await request("/cash/openings","POST",{date:"2030-01-01",openingCashCents:0})).status,400);
    assert.equal((await request("/cash/movements","POST",{type:"sangria",amountCents:11000,reason:"Sangria excedente"})).status,409);
    assert.equal((await request("/cash/movements","POST",{type:"suprimento",amountCents:2000,reason:"Troco adicional"})).status,201);
    assert.equal((await request("/cash/movements","POST",{type:"sangria",amountCents:500,reason:"Depósito bancário"})).status,201);
    db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES(?,?,?,?,?,'profissional')")
      .run("pro-pdf",tenant,"Profissional","pro@pdf.local","hash");
    db.prepare("INSERT INTO services(id,tenant_id,name,duration_minutes,price_cents) VALUES(?,?,?,?,?)")
      .run("service-pdf",tenant,"Corte",30,5000);
    db.prepare("INSERT INTO clients(id,tenant_id,name) VALUES(?,?,?)").run("client-pdf",tenant,"Cliente");
    db.prepare(`INSERT INTO appointments (id,tenant_id,client_id,professional_id,service_id,starts_at,ends_at,status,price_cents)
      VALUES (?,?,?,?,?,?,?,'concluido',?)`).run("appt-pdf",tenant,"client-pdf","pro-pdf","service-pdf",
        today+"T09:00:00",today+"T09:30:00",5000);
    assert.equal((await request("/receivables/appt-pdf/pay","POST",{paymentMethod:"dinheiro"})).status,200);
    const day=await request("/cash/daily?date="+today);
    assert.equal(day.body.opening.openingCashCents,10000);
    assert.equal(day.body.expectedCashCents,5000);
    assert.equal(day.body.expectedDrawerCashCents,16500);
    assert.equal(day.body.expectedTotalCents,5000);
    const closing=await request("/cash/closings","POST",{date:today,countedCashCents:16400,notes:"Faltam 1 real"});
    assert.equal(closing.status,201);
    const saved=await request("/cash/daily?date="+today);
    assert.equal(saved.body.closing.differenceCents,-100);
    assert.equal(saved.body.closing.openingCashCents,10000);
    assert.equal((await request("/cash/openings","POST",{date:today,openingCashCents:0})).status,409);
    const url="/api/cash/closings/"+encodeURIComponent(closing.body.closing.id)+"/pdf";
    const pdf=await fetch(base+url,{headers:{Cookie:cookie}});
    assert.equal(pdf.status,200);
    assert.match(pdf.headers.get("content-type"),/application\/pdf/);
    assert.match(pdf.headers.get("content-disposition"),/fechamento-caixa-/);
    const bytes=Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0,8).toString(),"%PDF-1.4");
    assert.ok(bytes.length>1000);
    assert.ok(bytes.toString("latin1").includes("165,00"));
    assert.ok(bytes.toString("latin1").includes("Troco adicional"));
    assert.ok(bytes.toString("latin1").includes("Faltam 1 real"));
    assert.equal((await request("/cash/closings")).body.closings.length,1);
    assert.equal((await request("/cash/movements","POST",{type:"sangria",amountCents:100,reason:"Retirada após fechar"})).status,409);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    db.close();
    for (const [key,value] of Object.entries(old)) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
