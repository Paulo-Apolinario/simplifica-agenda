import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";

test("contas a pagar, baixa, gaveta e fluxo financeiro por data efetiva", async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"agenda-expenses-"));
  process.env.DATABASE_PATH=path.join(temp,"app.sqlite");
  process.env.INSTALL_TOKEN=randomBytes(32).toString("hex");
  process.env.NODE_ENV="test";
  process.env.DEMO_MODE="false";
  const {default:app}=await import("../src/app.js");
  const {db}=await import("../src/database.js");
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  let cookie="";
  const request=async(route,method="GET",body)=>{
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api"+route,{
      method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{})},
      body:body?JSON.stringify(body):undefined
    });
    const next=response.headers.get("set-cookie");if(next)cookie=next.split(";")[0];
    return {status:response.status,body:await response.json()};
  };
  try{
    assert.equal((await request("/installation/setup","POST",{businessName:"Salão",slug:"expense-test",ownerName:"Dono",ownerEmail:"owner@expense.local",password:"Senha-Forte-Despesa-123",installToken:process.env.INSTALL_TOKEN})).status,201);
    const login=await request("/auth/login","POST",{email:"owner@expense.local",password:"Senha-Forte-Despesa-123"});
    assert.equal(login.status,200);
    const tenant=login.body.user.tenantId;
    const today=(await request("/cash/daily")).body.today,month=today.slice(0,7);
    const route="/expenses?month="+month;
    const fields={description:"Energia",category:"energia",expenseType:"fixa",amountCents:2000,dueOn:today};
    const create=async(overrides={})=>{
      const result=await request("/expenses","POST",{...fields,...overrides});
      assert.equal(result.status,201);return "/expenses/"+result.body.id;
    };
    assert.equal((await request("/expenses","POST",{...fields,amountCents:-1})).status,400);
    const energy=await create();
    const old=await create({description:"Internet",dueOn:"2020-01-01",amountCents:3000});
    const cancel=await create({description:"Cancelada"});
    assert.equal((await request(cancel+"/cancel","POST")).status,200);
    assert.equal((await request(cancel+"/pay","POST",{paymentMethod:"pix",paidOn:today})).status,409);
    assert.equal((await request(route)).body.pendingCents,5000);
    assert.equal((await request(route)).body.overdueCents,3000);
    assert.equal((await request(energy+"/pay","POST",{paymentMethod:"cash_drawer",paidOn:today})).status,409);
    assert.equal((await request(old+"/pay","POST",{paymentMethod:"pix",paidOn:"2020-01-02"})).status,200);
    assert.equal((await request("/expenses?month=2020-01")).body.cashFlow.expensesCents,3000);
    assert.equal((await request(route)).body.cashFlow.expensesCents,0);
    assert.equal((await request("/cash/openings","POST",{date:today,openingCashCents:1000})).status,201);
    assert.equal((await request(energy+"/pay","POST",{paymentMethod:"cash_drawer",paidOn:today})).status,409);
    assert.equal((await request(energy,"PATCH",{...fields,amountCents:500})).status,200);
    assert.equal((await request(energy+"/pay","POST",{paymentMethod:"cash_drawer",paidOn:today})).status,200);
    assert.equal((await request(energy+"/pay","POST",{paymentMethod:"cash_drawer",paidOn:today})).status,409);
    assert.equal((await request(energy,"PATCH",fields)).status,409);
    const day=(await request("/cash/daily")).body;
    assert.equal(day.expectedDrawerCashCents,500);
    assert.equal(day.movements.length,1);
    assert.equal(day.movements[0].reason,"Despesa: Energia");
    assert.equal((await request("/cash/closings","POST",{date:today,countedCashCents:500})).status,201);
    const other=await create({description:"Material",amountCents:100});
    assert.equal((await request(other+"/pay","POST",{paymentMethod:"cash_drawer",paidOn:today})).status,409);
    assert.equal((await request(other+"/pay","POST",{paymentMethod:"boleto",paidOn:today})).status,200);
    assert.equal((await request("/cash/daily")).body.expectedDrawerCashCents,500);
    const flow=(await request("/reports?month="+month)).body.cashFlow;
    assert.deepEqual(flow,{receivedCents:0,expensesCents:600,payoutsCents:0,balanceCents:-600});
    assert.equal(db.prepare("SELECT count(*) AS n FROM daily_cash_movements WHERE tenant_id=?").get(tenant).n,1);
  }finally{
    await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(temp,{recursive:true,force:true});
  }
});
