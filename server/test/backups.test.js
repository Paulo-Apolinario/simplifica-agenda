import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import Database from "better-sqlite3";

test("backup íntegro e isolado, exportação por estabelecimento e sessões revogadas na cópia",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"agenda-backup-"));
  process.env.DATABASE_PATH=path.join(temp,"app.sqlite");process.env.BACKUP_DIR=path.join(temp,"backups");
  process.env.SAAS_ADMIN_KEY=randomBytes(32).toString("hex");process.env.INSTALL_TOKEN=randomBytes(32).toString("hex");
  process.env.NODE_ENV="test";process.env.DEMO_MODE="false";process.env.BACKUP_INTERVAL_HOURS="0";
  const {default:app}=await import("../src/app.js"),{db}=await import("../src/database.js");
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
  let cookie="",token="";
  const call=async(route,method="GET",body,admin=false)=>{
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api"+route,{method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{}),...(admin==="key"?{"X-Saas-Admin-Key":process.env.SAAS_ADMIN_KEY}:admin?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});
    const next=response.headers.get("set-cookie");if(next)cookie=next.split(";")[0];
    return {status:response.status,headers:response.headers,body:response.headers.get("content-type")?.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer())};
  };
  try{
    assert.equal((await call("/installation/setup","POST",{businessName:"Empresa A",slug:"empresa-a",ownerName:"Dono",ownerEmail:"a@backup.local",password:"Senha-Forte-Backup-123",installToken:process.env.INSTALL_TOKEN})).status,201);
    const login=await call("/auth/login","POST",{email:"a@backup.local",password:"Senha-Forte-Backup-123"});
    const id=login.body.user.tenantId;
    assert.equal((await call("/clients","POST",{name:"Cliente A",phone:"85912345678"})).status,201);
    const other=await call("/saas/businesses","POST",{businessName:"Empresa B",slug:"empresa-b",ownerName:"Outro",ownerEmail:"b@backup.local",plan:"comercial"},"key");
    assert.equal(other.status,201);
    db.prepare("INSERT INTO clients(id,tenant_id,name) VALUES(?,?,?)").run("other-client",other.body.business.id,"Cliente B");
    assert.equal((await call("/export/backup")).status,403);
    const exported=await call("/export/business-data");
    assert.equal(exported.status,200);assert.match(exported.headers.get("content-disposition"),/attachment/);
    assert.equal(exported.body.tenantId,id);assert.equal(exported.body.data.clients.length,1);
    assert.equal(exported.body.data.clients[0].name,"Cliente A");
    assert.ok(!JSON.stringify(exported.body).includes("Cliente B"));
    assert.ok(!JSON.stringify(exported.body).includes("password_hash"));
    assert.equal((await call("/saas/backups","GET",null,"key")).status,403);
    assert.equal((await call("/saas/operators","POST",{name:"Operador",email:"admin@backup.local",password:"Senha-Forte-Admin-123"},"key")).status,201);
    token=(await call("/saas/login","POST",{email:"admin@backup.local",password:"Senha-Forte-Admin-123"})).body.token;
    const created=await call("/saas/backups","POST",null,true);
    assert.equal(created.status,201,JSON.stringify(created.body));
    const name=created.body.name,file=path.join(process.env.BACKUP_DIR,name);
    assert.equal((await call("/saas/backups","GET",null,true)).body.backups.length,1);
    assert.equal((await call("/saas/backups/"+name+"/verify","POST",null,true)).status,200);
    const download=await call("/saas/backups/"+name+"/download","GET",null,true);
    assert.equal(download.status,200);assert.deepEqual(download.body,fs.readFileSync(file));
    const backup=new Database(file,{readonly:true});
    try{
      assert.equal(backup.prepare("SELECT count(*) AS n FROM tenants").get().n,2);
      assert.equal(backup.prepare("SELECT count(*) AS n FROM sessions").get().n,0);
      assert.equal(backup.prepare("SELECT count(*) AS n FROM saas_operator_sessions").get().n,0);
    }finally{backup.close();}
    assert.equal((await call("/auth/me")).status,200);
    const bad=await call("/saas/backups/"+name+"/verify","POST");assert.equal(bad.status,403);
    assert.equal(db.prepare("SELECT count(*) AS n FROM saas_audit WHERE action='backup_criado'").get().n,1);
  }finally{await new Promise(r=>server.close(r));db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
