import {db} from "./database.js";

export const planFeatures=["expenses","inventory","packages","advancedReports","automaticWhatsapp"];
export function getPlanAccess(tenantId){
  const row=db.prepare(`SELECT s.plan,s.enforce_plan AS enforced,s.trial_until AS trialUntil,p.name,p.professional_limit AS professionalLimit,p.features_json AS featuresJson
    FROM tenant_subscriptions s LEFT JOIN saas_plans p ON p.id=s.plan WHERE s.tenant_id=?`).get(tenantId);
  const enforced=Boolean(row?.enforced);
  const features=Object.fromEntries(planFeatures.map(f=>[f,!enforced]));
  if(enforced){try{const stored=JSON.parse(row.featuresJson||"{}");for(const f of planFeatures)features[f]=stored[f]===true;}catch{}}
  return {plan:row?.plan||"comercial",name:row?.name||"Comercial",enforced,professionalLimit:enforced?row?.professionalLimit??null:null,features,trialUntil:row?.trialUntil??null};
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
