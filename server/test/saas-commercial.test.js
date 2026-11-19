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
    db.prepare("UPDATE appointments SET status='concluido', completed_on='2026-10-10' WHERE id=?").run(booking.body.id);
    const preview=(await request("/settlements?period=2026-10-1")).body;
    assert.equal(preview.professionals[0].dueCents,8000);
    assert.equal(preview.professionals[0].services[0].serviceName,"Corte");
    assert.equal(preview.professionals[0].services[0].clientName,"Cliente");
    assert.equal(preview.professionals[0].services[0].earnedCents,8000);
    assert.equal((await request("/commissions/"+booking.body.id,"PATCH",{commissionPercent:85,houseSharePercent:10})).status,200);
    assert.equal((await request("/settlements","POST",{professionalId:proId,period:"2026-10-1",expectedTotalCents:8000})).status,409);
    const closed=await request("/settlements","POST",{professionalId:proId,period:"2026-10-1",expectedTotalCents:7500});
    assert.equal(closed.status,201,JSON.stringify(closed.body));
    assert.equal(closed.body.batch.totalCents,7500);
    assert.equal((await request("/settlements","POST",{professionalId:proId,period:"2026-10-1"})).status,409);
    const paid=(await request("/settlements?period=2026-10-1")).body;
    assert.equal(paid.professionals[0].dueCents,0);
    assert.equal(paid.batches.length,1);
    assert.equal(paid.professionals[0].services[0].paid,true);
    assert.equal(paid.professionals[0].services[0].paidCents,7500);
    const pdfUrl=base+"/api/settlements/"+closed.body.batch.id+"/pdf";
    const pdf=await fetch(pdfUrl,{headers:{Cookie:cookie}});
    assert.equal(pdf.status,200);
    assert.match(pdf.headers.get("content-type"),/application\/pdf/);
    assert.match(pdf.headers.get("content-disposition"),/^inline/);
    const bytes=Buffer.from(await pdf.arrayBuffer());
    assert.match(bytes.toString("latin1"),/DEMONSTRATIVO DE REPASSE QUINZENAL/);
    assert.match(bytes.toString("latin1"),/Corte/);
    assert.match(bytes.toString("latin1"),/TOTAL REPASSADO AO PROFISSIONAL: R\$ 75,00/);
    db.prepare("UPDATE services SET name='Corte renomeado' WHERE id=?").run(serviceId);
    const downloaded=await fetch(pdfUrl+"?download=1",{headers:{Cookie:cookie}});
    assert.match(downloaded.headers.get("content-disposition"),/^attachment/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
    db.prepare("UPDATE services SET name='Corte' WHERE id=?").run(serviceId);
    assert.equal((await fetch(pdfUrl)).status,401);
    const csv=await fetch(base+"/api/settlements/export.csv?period=2026-10-1",{
      headers:{Cookie:cookie},
    });
    assert.equal(csv.status,200);
    assert.match(await csv.text(),/Pedro/);
    const another=await request("/saas/businesses","POST",{
      businessName:"Barbearia Outro",slug:"barbearia-outro",ownerName:"Carlos",
      ownerEmail:"carlos@exemplo.com",plan:"profissional",
    },true);
    assert.equal(another.status,201);
    db.prepare(`INSERT INTO users (id,tenant_id,name,email,password_hash,role)
      VALUES (?,?,?,?,?,'profissional')`)
      .run("other-professional",another.body.business.id,"Equipe Outra",
        "outro@staff.invalid",await bcrypt.hash("Another1234567",12));
    assert.equal((await request("/commission-rules","PUT",{
      professionalId:"other-professional",serviceId,commissionPercent:100,
    })).status,404);

    // No Meta credentials and no opt-in: should never claim that the customer was notified.
    db.prepare(`INSERT INTO appointments (id,tenant_id,client_id,professional_id,service_id,
      starts_at,ends_at,price_cents,booking_source) VALUES (?,?,?,?,?,?,?,?, 'public')`)
      .run("request-saas",tenant,clientId,proId,serviceId,"2030-01-09T10:00:00","2030-01-09T10:30:00",10000);
    const confirmation=await request("/requests/request-saas","PATCH",{action:"confirm"});
    assert.equal(confirmation.status,200);
    assert.equal(confirmation.body.whatsappState,"no-consent");
    assert.equal((await request("/requests")).body.requests.find(x=>x.id==="request-saas").whatsappDeliveryState,"no-consent");
    db.prepare(`INSERT INTO appointments (id,tenant_id,client_id,professional_id,service_id,
      starts_at,ends_at,price_cents,booking_source,whatsapp_opt_in)
      VALUES (?,?,?,?,?,?,?,?, 'public',1)`)
      .run("request-consent",tenant,clientId,proId,serviceId,
        "2030-01-09T11:00:00","2030-01-09T11:30:00",10000);
    const noProvider=await request("/appointments/request-consent","PATCH",{status:"confirmado"});
    assert.equal(noProvider.status,200);
    assert.equal(noProvider.body.whatsappState,"not-configured");
    const noticeId = () => db.prepare(`SELECT id FROM whatsapp_notifications
      WHERE appointment_id = 'request-consent' AND status = 'confirmado'`).get().id;
    const firstNotice = noticeId();
    assert.equal((await request("/appointments/request-consent","PATCH",{status:"confirmado"})).body.whatsappState,null);
    assert.equal((await request("/requests/request-consent","PATCH",{action:"confirm"})).status,409);
    assert.equal(noticeId(),firstNotice);
    assert.equal((await request("/appointments/request-consent","PATCH",{status:"agendado"})).status,200);
    assert.equal((await request("/requests/request-consent","PATCH",{action:"confirm"})).body.whatsappState,"not-configured");
    assert.notEqual(noticeId(),firstNotice);

    db.prepare(`INSERT INTO appointments (id,tenant_id,client_id,professional_id,service_id,
      starts_at,ends_at,price_cents,booking_source)
      VALUES (?,?,?,?,?,?,?,?, 'public')`)
      .run("request-reject",tenant,clientId,proId,serviceId,
        "2030-01-09T12:00:00","2030-01-09T12:30:00",10000);
    const reject=await request("/requests/request-reject","PATCH",{action:"reject"});
    assert.equal(reject.status,200);
    assert.equal(reject.body.whatsappState,"no-consent");

    assert.equal((await request("/requests/request-saas/whatsapp-opened","POST",{status:"confirmado"})).status,403);
    assert.equal((await request("/requests/request-consent/whatsapp-opened","POST",{status:"confirmado"})).status,200);
    assert.ok((await request("/requests")).body.requests.find(x=>x.id==="request-consent").whatsappOpenedAt);
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
