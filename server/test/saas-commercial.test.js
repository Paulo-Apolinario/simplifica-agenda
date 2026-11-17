import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

test("SaaS operator, individual commissions, settlement and WhatsApp notice state", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "simplifica-saas-"));
  const old = { DATABASE_PATH:process.env.DATABASE_PATH, SAAS_ADMIN_KEY:process.env.SAAS_ADMIN_KEY,
    NODE_ENV:process.env.NODE_ENV, DEMO_MODE:process.env.DEMO_MODE };
  process.env.DATABASE_PATH = path.join(tmp,"saas.sqlite");
  process.env.SAAS_ADMIN_KEY = crypto.randomBytes(40).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.DEMO_MODE = "false";
  const { default:app } = await import("../src/app.js");
  const { db } = await import("../src/database.js");
  const server = app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  let cookie="";
  async function request(endpoint,method="GET",body,admin=false) {
    const response=await fetch(base+"/api"+endpoint,{
      method,headers:{
        ...(body?{"Content-Type":"application/json"}:{}),
        ...(cookie?{Cookie:cookie}:{}),
        ...(admin?{"X-Saas-Admin-Key":process.env.SAAS_ADMIN_KEY}:{}),
      },
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    const sc=response.headers.get("set-cookie");
    if(sc)cookie=sc.split(";")[0];
    return {status:response.status,body:await response.json()};
  }
  try {
    assert.equal((await request("/saas/businesses")).status,403);
    const created=await request("/saas/businesses","POST",{
      businessName:"Estúdio Real",slug:"estudio-real",ownerName:"Maria",
      ownerEmail:"maria@exemplo.com",plan:"comercial",
    },true);
    assert.equal(created.status,201,JSON.stringify(created.body));
    assert.match(created.body.temporaryPassword,/^[A-Za-z0-9_-]{20,}$/);
    assert.equal((await request("/saas/businesses","POST",{
      businessName:"Duplicado",slug:"estudio-real",ownerName:"Outra",
      ownerEmail:"outra@exemplo.com",plan:"comercial",
    },true)).status,409);
    assert.equal((await request("/saas/businesses","POST",{
      businessName:"Outro",slug:"outro-salao",ownerName:"Maria",
      ownerEmail:"maria@exemplo.com",
    },true)).status,409);
    const login=await request("/auth/login","POST",{
      email:"maria@exemplo.com",password:created.body.temporaryPassword,
    });
    assert.equal(login.status,200);
    const tenant=login.body.user.tenantId;
    const proId="pro-saas", serviceId="svc-saas", clientId="client-saas";
    db.prepare(`INSERT INTO users (id,tenant_id,name,email,password_hash,role,commission_percent)
      VALUES (?,?,?,?,?,'profissional',?)`).run(proId,tenant,"Pedro","pedro@staff.invalid",
        await bcrypt.hash("ProfessionalPass123",12),30);
    db.prepare("INSERT INTO services (id,tenant_id,name,duration_minutes,price_cents) VALUES (?,?,?,?,?)")
      .run(serviceId,tenant,"Corte",30,10000);
    db.prepare("INSERT INTO clients (id,tenant_id,name,phone) VALUES (?,?,?,?)")
      .run(clientId,tenant,"Cliente","85987654321");
    assert.equal((await request("/commission-rules","PUT",{
      professionalId:proId,serviceId,commissionPercent:90,houseSharePercent:10,
    })).status,200);
    const rule=(await request("/commission-rules")).body.rules[0];
    assert.equal(rule.commissionPercent,90);
    assert.equal(rule.houseSharePercent,10);
    const booking=await request("/appointments","POST",{
      clientId,professionalId:proId,serviceId,startsAt:"2030-01-08T10:00:00",
    });
    assert.equal(booking.status,201,JSON.stringify(booking.body));
    const snapshot=db.prepare("SELECT commission_percent AS commission,house_share_percent AS house FROM appointments WHERE id=?").get(booking.body.id);
    assert.deepEqual(snapshot,{commission:90,house:10});
    db.prepare("UPDATE appointments SET status='concluido' WHERE id=?").run(booking.body.id);
    const preview=(await request("/settlements?month=2030-01")).body;
    assert.equal(preview.professionals[0].dueCents,8000);
    const closed=await request("/settlements","POST",{professionalId:proId,month:"2030-01"});
    assert.equal(closed.status,201,JSON.stringify(closed.body));
    assert.equal(closed.body.batch.totalCents,8000);
    assert.equal((await request("/settlements","POST",{professionalId:proId,month:"2030-01"})).status,409);
    const paid=(await request("/settlements?month=2030-01")).body;
    assert.equal(paid.professionals[0].dueCents,0);
    assert.equal(paid.batches.length,1);
    // No Meta credentials and no opt-in: should never claim that the customer was notified.
    db.prepare(`INSERT INTO appointments (id,tenant_id,client_id,professional_id,service_id,
      starts_at,ends_at,price_cents,booking_source) VALUES (?,?,?,?,?,?,?,?, 'public')`)
      .run("request-saas",tenant,clientId,proId,serviceId,"2030-01-09T10:00:00","2030-01-09T10:30:00",10000);
    const confirmation=await request("/requests/request-saas","PATCH",{action:"confirm"});
    assert.equal(confirmation.status,200);
    assert.equal(confirmation.body.whatsappState,"no-consent");
    assert.equal((await request("/requests")).body.requests.find(x=>x.id==="request-saas").whatsappDeliveryState,"no-consent");
    assert.equal((await request("/requests/request-saas/whatsapp-opened","POST",{status:"confirmado"})).status,200);
    assert.ok((await request("/requests")).body.requests.find(x=>x.id==="request-saas").whatsappOpenedAt);
    assert.equal((await request("/commission-rules","PUT",{
      professionalId:"foreign",serviceId,commissionPercent:100,
    })).status,404);
    const blocked=await request("/saas/businesses/"+tenant,"PATCH",{plan:"comercial",status:"suspended"},true);
    assert.equal(blocked.status,200);
    assert.equal((await request("/auth/login","POST",{
      email:"maria@exemplo.com",password:created.body.temporaryPassword,
    })).status,403);
    assert.equal((await request("/public/estudio-real")).status,403);
    assert.equal((await request("/account")).status,401);
    assert.equal((await request("/saas/businesses/"+tenant,"PATCH",{
      plan:"comercial",status:"active",
    },true)).status,200);
    assert.equal((await request("/auth/login","POST",{
      email:"maria@exemplo.com",password:created.body.temporaryPassword,
    })).status,200);
    assert.equal((await request("/account")).status,200);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    db.close();
    for (const [key,value] of Object.entries(old)) {
      if(value===undefined)delete process.env[key];
      else process.env[key]=value;
    }
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
