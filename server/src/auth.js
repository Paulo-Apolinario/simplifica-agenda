import { db } from "./database.js";

export function publicUser(user) {
  return {
    id: user.id,
    tenantId: user.tenantId ?? user.tenant_id,
    slug: user.slug ?? user.businessSlug,
    name: user.name,
    email: user.role === "profissional" ? "" : user.email,
    staffCode: user.login_code ?? user.loginCode ?? user.staff_code ?? user.staffCode ?? null,
    jobTitle: user.job_title ?? user.jobTitle ?? "",
    role: user.role,
    phone: user.phone,
    commissionPercent: user.commissionPercent ?? user.commission_percent,
  };
}

export function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.status(401).json({ error: "Faça login para continuar." });
    return;
  }
  const activeUser = db.prepare(`
    SELECT u.*, t.slug FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ? AND u.tenant_id = ? AND u.active = 1
  `).get(req.session.user.id, req.session.user.tenantId);
  const subscription = activeUser && db.prepare("SELECT status FROM tenant_subscriptions WHERE tenant_id=?").get(activeUser.tenant_id);
  if (!activeUser || subscription?.status === "suspended") {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.status(401).json({ error: "Sua sessão expirou. Faça login novamente." });
    });
    return;
  }
  req.user = publicUser(activeUser);
  next();
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Seu perfil não tem permissão para esta ação." });
      return;
    }
    next();
  };
}
