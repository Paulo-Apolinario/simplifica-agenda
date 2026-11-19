import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import {db} from "./database.js";

const backupName=/^agenda-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.sqlite$/;
let running=false,lastFailure=null;
const intervalHours=Number(process.env.BACKUP_INTERVAL_HOURS??(process.env.NODE_ENV==="production"?24:0));
const folder=()=>path.resolve(process.env.BACKUP_DIR||path.join(path.dirname(path.resolve(db.name)),"backups"));
function ensureFolder(){
  const dir=folder();
  const publicDir=path.resolve(import.meta.dirname,"../../web");
  if(dir===publicDir||dir.startsWith(publicDir+path.sep))throw Error("Diretório de backup não pode ficar na pasta pública.");
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const real=fs.realpathSync(dir);
  if(real===publicDir||real.startsWith(publicDir+path.sep))throw Error("Diretório inválido.");
  return real;
}
async function digest(file){
  const hash=crypto.createHash("sha256");
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  return hash.digest("hex");
}
export function listBackups(){
  const dir=ensureFolder();
  const rows=[];
  for(const name of fs.readdirSync(dir)){
    if(!backupName.test(name))continue;
    try{
      const file=path.join(dir,name),meta=JSON.parse(fs.readFileSync(file+".json","utf8")),stat=fs.lstatSync(file);
      if(stat.isFile()&&!stat.isSymbolicLink()&&meta.name===name&&typeof meta.createdAt==="string"&&/^[a-f0-9]{64}$/.test(meta.sha256))
        rows.push({...meta,sizeBytes:stat.size});
    }catch{}
  }
  return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function backupStatus(){
  const backups=listBackups();
  return {backups,running,lastFailure,intervalHours:Number.isFinite(intervalHours)&&intervalHours>=1&&intervalHours<=168?intervalHours:0,
    totalBytes:backups.reduce((n,b)=>n+b.sizeBytes,0)};
}
export async function createBackup(source="manual"){
  if(running)throw Object.assign(Error("Já existe uma cópia em andamento."),{status:409});
  running=true;
  let temp,final,manifest;
  try{
    const dir=ensureFolder(),createdAt=new Date().toISOString();
    const name="agenda-"+createdAt.replace(/[:.]/g,"-")+"-"+crypto.randomUUID()+".sqlite";
    final=path.join(dir,name);temp=final+".partial";manifest=final+".json";
    const fd=fs.openSync(temp,"wx",0o600);fs.closeSync(fd);
    await db.backup(temp);
    const copied=new Database(temp);
    try{
      copied.pragma("journal_mode = DELETE");
      copied.pragma("secure_delete = ON");
      copied.transaction(()=>{
        copied.prepare("DELETE FROM sessions").run();
        copied.prepare("DELETE FROM saas_operator_sessions").run();
        copied.prepare("UPDATE users SET activation_hash=NULL,activation_expires_at=NULL").run();
      })();
      copied.exec("VACUUM");
      if(copied.pragma("quick_check",{simple:true})!=="ok"||copied.pragma("foreign_key_check").length)throw Error("Cópia não passou na validação.");
    }finally{copied.close();}
    const meta={name,createdAt,source,sha256:await digest(temp),sizeBytes:fs.statSync(temp).size,verifiedAt:new Date().toISOString()};
    fs.renameSync(temp,final);
    fs.writeFileSync(manifest,JSON.stringify(meta),{flag:"wx",mode:0o600});
    lastFailure=null;return meta;
  }catch(e){
    for(const file of [temp,final,manifest])if(file)try{fs.unlinkSync(file);}catch{}
    lastFailure={at:new Date().toISOString(),message:"Falha na criação ou validação do backup."};
    throw e;
  }finally{running=false;}
}
export async function verifyBackup(name){
  if(!backupName.test(name))throw Object.assign(Error("Cópia não encontrada."),{status:404});
  const meta=listBackups().find(b=>b.name===name);
  if(!meta)throw Object.assign(Error("Cópia não encontrada."),{status:404});
  const file=path.join(ensureFolder(),name);
  if(await digest(file)!==meta.sha256)throw Object.assign(Error("A integridade da cópia não foi confirmada."),{status:409});
  const copy=new Database(file,{readonly:true,fileMustExist:true});
  try{if(copy.pragma("quick_check",{simple:true})!=="ok"||copy.pragma("foreign_key_check").length)throw Object.assign(Error("Cópia inválida."),{status:409});}finally{copy.close();}
  return {file,meta};
}
export function startBackupSchedule(){
  if(!Number.isFinite(intervalHours)||intervalHours<1||intervalHours>168)return;
  const tick=async()=>{try{const latest=listBackups()[0];if(!latest||Date.now()-Date.parse(latest.createdAt)>=intervalHours*3600000)await createBackup("automatic");}catch{console.error("Backup automático não concluído; consulte a Central SaaS.");}};
  const initial=setTimeout(tick,10000);initial.unref();
  const timer=setInterval(tick,60*60000);timer.unref();
}
