import {db,createId} from "./database.js";

export const subscriptionToday=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
export function subscriptionDeadline(row){return [row?.dueDate,row?.trialUntil].filter(Boolean).sort().at(-1)||null;}
export function subscriptionNotice(row,today=subscriptionToday()){
  const deadline=subscriptionDeadline(row);
  if(!row?.autoSuspend||!deadline)return null;
  const block=new Date(deadline+"T00:00:00Z");block.setUTCDate(block.getUTCDate()+1);
  const blockDate=block.toISOString().slice(0,10);
  const days=Math.round((Date.parse(blockDate+"T00:00:00Z")-Date.parse(today+"T00:00:00Z"))/86400000);
  return {blockDate,days};
}
export function enforceSubscriptionDeadlines(today=subscriptionToday()){
  return db.transaction(()=>{
    const rows=db.prepare(`SELECT s.tenant_id AS id,s.due_date AS dueDate,s.trial_until AS trialUntil,s.auto_suspend AS autoSuspend FROM tenant_subscriptions s JOIN tenants t ON t.id=s.tenant_id WHERE s.auto_suspend=1 AND s.status='active' AND t.slug!='studio-bela-vista'`).all();
    for(const row of rows){const notice=subscriptionNotice(row,today);if(!notice||notice.days>0)continue;
      db.prepare("UPDATE tenant_subscriptions SET status='suspended',auto_suspended=1 WHERE tenant_id=?").run(row.id);
      db.prepare("DELETE FROM sessions WHERE tenant_id=?").run(row.id);
      db.prepare("INSERT INTO saas_audit(id,actor_name,action,target_id,details_json) VALUES (?,?,?,?,?)").run(createId(),"Sistema","suspensao_automatica",row.id,JSON.stringify(notice));
    }
  })();
}
export function startSubscriptionSchedule(){
  const tick=()=>{try{enforceSubscriptionDeadlines();}catch(e){console.error("Falha na verificação de assinaturas:",e.message);}};
  tick();const timer=setInterval(tick,60000);timer.unref();
}

export const planFeatures=["expenses","inventory","packages","advancedReports","automaticWhatsapp"];
export function getPlanAccess(tenantId){
  const row=db.prepare(`SELECT s.plan,s.enforce_plan AS enforced,s.trial_until AS trialUntil,s.due_date AS dueDate,s.auto_suspend AS autoSuspend,p.name,p.professional_limit AS professionalLimit,p.features_json AS featuresJson
    FROM tenant_subscriptions s LEFT JOIN saas_plans p ON p.id=s.plan WHERE s.tenant_id=?`).get(tenantId);
  const enforced=Boolean(row?.enforced);
  const features=Object.fromEntries(planFeatures.map(f=>[f,!enforced]));
  if(enforced){try{const stored=JSON.parse(row.featuresJson||"{}");for(const f of planFeatures)features[f]=stored[f]===true;}catch{}}
  return {plan:row?.plan||"comercial",name:row?.name||"Comercial",enforced,professionalLimit:enforced?row?.professionalLimit??null:null,features,trialUntil:row?.trialUntil??null,notice:subscriptionNotice(row)};
}
export function featureForPath(path){
  if(/^\/api\/expenses(?:\/|$)/.test(path))return "expenses";
  if(/^\/api\/inventory(?:\/|$)/.test(path))return "inventory";
  if(path!=="/api/packages/eligible"&&/^\/api\/(?:packages|loyalty)(?:\/|$)/.test(path))return "packages";
  if(/^\/api\/reports\/appointment-audit(?:\/|$)/.test(path))return "advancedReports";
  return null;
}
export function professionalLimitReached(tenantId){
  const limit=getPlanAccess(tenantId).professionalLimit;
  return limit!==null&&db.prepare("SELECT count(*) AS n FROM users WHERE tenant_id=? AND role='profissional' AND active=1").get(tenantId).n>=limit;
}
