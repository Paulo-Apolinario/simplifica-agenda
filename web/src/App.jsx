import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown,
  ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Download, ExternalLink, LayoutDashboard,
  LogOut, Menu, Moon, MoreHorizontal, Plus, Search, Settings, ShieldCheck, Sun, Users,
  Wallet, X, Scissors, UserRound, CalendarClock, CalendarX2, Phone, Mail, Sparkles,
  Copy, QrCode, Share2, Link2, Smartphone, Info, ClipboardCheck, UserRoundCheck, Upload,
} from "lucide-react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

const money = (cents = 0) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(cents / 100);
const localDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const shiftDate = (date, days) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return localDate(next);
};
const dateLabel = (date, options = { day: "2-digit", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("pt-BR", options).format(new Date(`${date}T12:00:00`));
const dateTimeLabel = (value) => new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));
const api = async (url, options = {}) => {
  const response = await fetch(`/api${url}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  if (response.status === 204) return null;
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json() : await response.blob();
  if (!response.ok) throw new Error(data?.error ?? "Não foi possível concluir a solicitação.");
  return data;
};
const statusNames = {
  agendado: "Agendado", confirmado: "Confirmado", concluido: "Concluído",
  cancelado: "Cancelado", faltou: "Não compareceu",
};
const statusStyles = {
  agendado: "bg-blue-50 text-blue-700",
  confirmado: "bg-emerald-50 text-emerald-700",
  concluido: "bg-slate-100 text-slate-600",
  cancelado: "bg-rose-50 text-rose-700",
  faltou: "bg-amber-50 text-amber-700",
};
const paymentNames = {
  dinheiro: "Dinheiro", pix: "Pix", cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito", transferencia: "Transferência",
};
const whatsappUrl = (phone, text) => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const number = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
};

function Button({ children, variant = "primary", className = "", ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

function Field({ label, className = "", children, ...props }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children ?? <input className="input" {...props} />}
    </label>
  );
}

function SelectField({ label, children, ...props }) {
  return <Field label={label}>
    <select className="input" {...props}>{children}</select>
  </Field>;
}

function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const close = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-panel ${wide ? "max-w-2xl" : "max-w-lg"}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function Loading({ label = "Carregando..." }) {
  return <div className="loading"><span className="spinner" />{label}</div>;
}

function ErrorMessage({ children }) {
  return children ? <p className="form-error" role="alert">{children}</p> : null;
}

function Login({ onLogin, demoEnabled = false }) {
  const [values, setValues] = useState({ email: demoEnabled ? "admin@simplifica.local" : "", staffCode: "", password: demoEnabled ? "Agenda123!" : "", slug: "" });
  const [mode, setMode] = useState("email");
  const [activation, setActivation] = useState(false);
  const [activationToken, setActivationToken] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "staff" && activation) {
        if (values.password !== confirmPassword) throw new Error("As senhas não coincidem.");
        await api("/auth/activate-professional", { method: "POST", body: {
          slug: values.slug, staffCode: values.staffCode, activationToken, password: values.password,
        } });
        setSuccess("Senha ativada. Agora faça seu login com o código.");
        setActivation(false);
        setValues({ ...values, password: "" }); setConfirmPassword(""); setActivationToken("");
      } else {
        const { user } = await api(mode === "staff" ? "/auth/staff-login" : "/auth/login", {
          method: "POST", body: values,
        });
        onLogin(user);
      }
    } catch (reason) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <img className="login-logo" src="/assets/simplifica-logo.svg" alt="Simplifica" />
        <div className="mb-7">
          <p className="eyebrow">BEM-VINDA DE VOLTA</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Entre na sua conta</h1>
          <p className="mt-2 text-sm text-slate-500">Organize seus horários com mais leveza.</p>
        </div>
        <div className="auth-mode-switch" role="group" aria-label="Tipo de acesso">
          <button type="button" className={mode === "email" ? "selected" : ""} onClick={() => { setMode("email"); setActivation(false); setError(""); }}>Administração</button>
          <button type="button" className={mode === "staff" ? "selected" : ""} onClick={() => { setMode("staff"); setError(""); setValues({ ...values, password: "", slug: "" }); }}>Profissional</button>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {mode === "email" && <Field label="E-mail" type="email" autoComplete="username" required value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })} />}
          {mode === "staff" && <Field label="Código de acesso do profissional (ex.: 001)" inputMode="numeric" pattern="[0-9]{3}" maxLength={3} required value={values.staffCode} onChange={(e) => setValues({ ...values, staffCode: e.target.value.replace(/\D/g, "").slice(0, 3) })}/>}
          <Field label={activation ? "Escolha sua senha (6 a 8 letras e números)" : "Senha"} type="password" autoComplete="current-password" required value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })} minLength={mode === "staff" && activation ? 6 : undefined} maxLength={mode === "staff" && activation ? 8 : undefined} />
          {mode === "staff" && activation && <>
            <Field label="Repita a senha" type="password" required minLength={6} maxLength={8} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}/>
            <Field label="Código de ativação fornecido pelo administrador" required value={activationToken} onChange={e => setActivationToken(e.target.value)}/>
          </>}
          {mode === "email" && <Field label="Identificador do negócio (opcional)" placeholder="Ex.: studio-bela-vista"
            value={values.slug} onChange={(e) => setValues({ ...values, slug: e.target.value })} />}
          <ErrorMessage>{error}</ErrorMessage>
          {success && <p className="success-message" role="status">{success}</p>}
          <Button className="w-full justify-center" type="submit" disabled={loading}>
            {loading ? "Processando..." : activation ? "Ativar minha senha" : "Entrar na minha agenda"}
          </Button>
        </form>
        {mode === "staff" && <button className="staff-activate-switch" type="button" onClick={() => { setActivation(!activation); setError(""); setSuccess(""); }}>
          {activation ? "Já tenho senha — entrar" : "Primeiro acesso? Definir minha senha"}
        </button>}
        {demoEnabled && <>
          <div className="demo-hint">
            <Sparkles size={16} />
            <span>Demonstração: <strong>admin@simplifica.local</strong> · <strong>Agenda123!</strong></span>
          </div>
          <Link to="/agendar/studio-bela-vista" className="login-public-link">Ver página pública de agendamento <ArrowRight size={15} /></Link>
        </>}
      </section>
      <div className="login-decoration">
        <div className="login-decoration-inner">
          <span className="decoration-kicker"><span /> SUA ROTINA, MAIS SIMPLES</span>
          <h2>Mais tempo para<br />cuidar do que importa.</h2>
          <p>Uma agenda organizada deixa seu negócio crescer no seu ritmo.</p>
          <div className="decoration-card"><CalendarCheckDecoration /><div><b>Seu dia, em boas mãos.</b><span>Agendamentos sem complicação.</span></div></div>
        </div>
      </div>
    </main>
  );
}

function InstallationSetup({ onReady }) {
  const [form, setForm] = useState({
    businessName: "", slug: "", ownerName: "", ownerEmail: "", password: "", installToken: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/installation/setup", { method: "POST", body: form });
      onReady();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-card" style={{ maxWidth: 540 }}>
        <img className="login-logo" src="/assets/simplifica-logo.svg" alt="Simplifica Agenda" />
        <p className="eyebrow">PRIMEIRO ACESSO</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Configure seu comércio</h1>
        <p className="mt-2 mb-6 text-sm text-slate-500">Cadastre o negócio e crie a conta administradora. Nenhum dado demonstrativo será adicionado.</p>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Nome do comércio" required maxLength={120} value={form.businessName}
            onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
          <Field label="Identificador do negócio" required placeholder="ex.: minha-barbearia" pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
          <Field label="Nome do administrador" required maxLength={120} value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          <Field label="E-mail do administrador" type="email" required value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
          <Field label="Senha do administrador (mínimo 12 caracteres)" type="password" required minLength={12} autoComplete="new-password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Field label="Código de instalação fornecido pelo técnico" type="password" required autoComplete="off"
            value={form.installToken} onChange={(e) => setForm({ ...form, installToken: e.target.value })} />
          <ErrorMessage>{error}</ErrorMessage>
          <Button className="w-full justify-center" type="submit" disabled={saving}>
            {saving ? "Configurando..." : "Criar meu comércio"}
          </Button>
        </form>
      </section>
      <div className="login-decoration">
        <div className="login-decoration-inner">
          <span className="decoration-kicker"><span /> SUA ROTINA, MAIS SIMPLES</span>
          <h2>Comece com sua agenda organizada.</h2>
          <p>Depois de configurar seu negócio, entre com o e-mail e a senha que você criou.</p>
        </div>
      </div>
    </main>
  );
}

function AccountPage({ user, onUserUpdated, embedded = false }) {
  const [values, setValues] = useState({ name: user.name, phone: user.phone || "", currentPassword: "", newPassword: "", confirmPassword: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (values.newPassword !== values.confirmPassword) {
      setError("As novas senhas não coincidem.");
      return;
    }
    setSaving(true);
    try {
      const { user: updated } = await api("/account", { method: "PATCH", body: {
        name: values.name, phone: values.phone,
        currentPassword: values.currentPassword, newPassword: values.newPassword,
      } });
      onUserUpdated(updated);
      setValues({ ...values, currentPassword: "", newPassword: "", confirmPassword: "" });
      setMessage("Sua conta foi atualizada. Outras sessões foram encerradas se a senha mudou.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };
  return <>
    {!embedded && <PageTitle eyebrow="SEGURANÇA E PERFIL" title="Minha conta"
      description="Atualize seus dados de acesso e proteja sua conta." />}
    <section className="panel management-panel" style={{ maxWidth: embedded ? undefined : 620 }}>
      <div className="panel-heading"><div><h2>Dados e segurança</h2><p className="panel-subtitle">Perfil: {user.role === "dono" ? "Proprietário" : user.role === "recepcao" ? "Recepção" : "Profissional"}</p></div></div>
      <form className="form-stack" onSubmit={submit} style={{ padding: 24 }}>
        <Field label="Nome" required maxLength={120} value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}/>
        {user.role === "profissional" ? <Field label="Código de acesso" disabled value={user.staffCode || ""}/> : <Field label="E-mail de acesso" type="email" disabled value={user.email}/>}
        <Field label="Telefone" type="tel" maxLength={40} value={values.phone}
          onChange={(e) => setValues({ ...values, phone: e.target.value })}/>
        <Field label="Senha atual (necessária para salvar)" type="password" required autoComplete="current-password"
          value={values.currentPassword} onChange={(e) => setValues({ ...values, currentPassword: e.target.value })}/>
        <Field label={user.role === "profissional" ? "Nova senha (6 a 8 letras e números)" : "Nova senha (opcional, mínimo 12 caracteres)"} type="password" minLength={user.role === "profissional" ? 6 : 12} maxLength={user.role === "profissional" ? 8 : undefined} autoComplete="new-password"
          value={values.newPassword} onChange={(e) => setValues({ ...values, newPassword: e.target.value })}/>
        <Field label="Confirmar nova senha" type="password" autoComplete="new-password"
          value={values.confirmPassword} onChange={(e) => setValues({ ...values, confirmPassword: e.target.value })}/>
        <ErrorMessage>{error}</ErrorMessage>
        {message && <p className="success-message" role="status">{message}</p>}
        <Button disabled={saving}>{saving ? "Salvando..." : "Salvar minha conta"}</Button>
      </form>
    </section>
  </>;
}

function CalendarCheckDecoration() {
  return <span className="deco-calendar"><CalendarDays size={23} /><Check size={12} /></span>;
}

const navItems = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/solicitacoes", label: "Solicitações online", icon: ClipboardCheck },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/servicos", label: "Serviços", icon: Scissors },
  { to: "/equipe", label: "Equipe e acessos", icon: Users },
  { to: "/meus-atendimentos", label: "Meus atendimentos", icon: ClipboardCheck },
  { to: "/meus-ganhos", label: "Meus ganhos", icon: Wallet },
  { to: "/comissoes", label: "Comissões da equipe", icon: CircleDollarSign },
  { to: "/regras-comissao", label: "Regras de comissão", icon: Settings },
  { to: "/fechamentos", label: "Fechamentos", icon: Wallet },
  { to: "/recebimentos", label: "Caixa e recebimentos", icon: CircleDollarSign },
  { to: "/financeiro", label: "Relatórios", icon: Wallet },
  { to: "/compartilhar", label: "Link de agendamento", icon: QrCode },
  { to: "/configuracoes", label: "Configurações do estabelecimento", icon: Settings },
  { to: "/minha-conta", label: "Minha conta", icon: ShieldCheck },
];

function Shell({ user, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const [businessName, setBusinessName] = useState("Simplifica Agenda");
  const [businessLogo, setBusinessLogo] = useState("");
  const [pendingOnline,setPendingOnline] = useState(0);
  const isDemo = user.tenantId === "tenant-salao-demo";
  useEffect(() => {
    if (user.role === "profissional" || user.tenantId === "tenant-salao-demo") return;
    let active = true;
    const refreshPending = () => api("/requests")
      .then(({requests}) => { if(active) setPendingOnline(requests.filter(item=>item.status==="agendado").length); })
      .catch(()=>{});
    refreshPending();
    const id = window.setInterval(refreshPending, 60000);
    return ()=>{ active=false; window.clearInterval(id); };
  },[user.role,user.tenantId,location.pathname]);

  const visibleNavItems = navItems.filter((item) => {
    if (user.role === "dono" && item.to === "/minha-conta") return false;
    if (user.role === "profissional") return ["/", "/agenda", "/clientes", "/meus-atendimentos", "/meus-ganhos", "/minha-conta"].includes(item.to)
      && !(isDemo && item.to === "/minha-conta");
    if (user.role === "recepcao") return !["/financeiro", "/configuracoes", "/equipe", "/meus-atendimentos", "/meus-ganhos", "/comissoes", "/regras-comissao", "/fechamentos"].includes(item.to);
    if (isDemo && ["/recebimentos", "/configuracoes", "/minha-conta", "/equipe", "/meus-atendimentos", "/comissoes", "/meus-ganhos", "/regras-comissao", "/fechamentos"].includes(item.to)) return false;
    return !["/meus-atendimentos", "/meus-ganhos"].includes(item.to);
  });
  useEffect(() => {
    api("/settings").then(({ settings }) => {
      if (settings?.businessName) setBusinessName(settings.businessName);
      setBusinessLogo(settings?.logoUrl || "");
    }).catch(() => {});
  }, [location.pathname]);
  useEffect(() => {
    const onLogoChange = (event) => setBusinessLogo(event.detail || "");
    window.addEventListener("simplifica:logo-updated", onLogoChange);
    return () => window.removeEventListener("simplifica:logo-updated", onLogoChange);
  }, []);
  const pageName = visibleNavItems.find((item) => item.to === location.pathname)?.label ?? "Simplifica Agenda";
  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Fechar menu" />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <Link to="/" className="brand-lockup" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark"><img src="/assets/simplifica-perfil.svg" alt="" /></span>
          <span className="brand-type"><b>simplifica<span>.</span></b><small>AGENDA INTELIGENTE</small></span>
        </Link>
        <div className="business-switcher">
          <span className="business-avatar">{businessLogo ? <img src={businessLogo} alt="" className="business-logo-img"/> : businessName.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><b>{businessName}</b><small>{user.slug === "studio-bela-vista" ? "Ambiente de demonstração" : "Meu negócio"}</small></span>
          <ChevronDown size={15} className="text-slate-400" />
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <span className="nav-caption">MENU PRINCIPAL</span>
          {visibleNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {to==="/solicitacoes" && pendingOnline>0 && <span className="nav-request-count" aria-label={`${pendingOnline} solicitações pendentes`}>{pendingOnline>99?"99+":pendingOnline}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-card">
            <span className="profile-avatar">{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
            <div className="min-w-0 flex-1"><b>{user.name}</b><small>{user.role === "dono" ? "Proprietária" : user.role === "recepcao" ? "Recepção" : "Profissional"}</small></div>
            <button type="button" className="button button-secondary logout-button" onClick={onLogout} aria-label="Sair da conta">
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        {user.tenantId === "tenant-salao-demo" && <div role="status" style={{
          padding: "12px 20px", background: "#FEF3C7", color: "#92400E", fontWeight: 600,
          fontSize: 13, borderBottom: "1px solid #F59E0B",
        }}>Ambiente demonstrativo · somente visualização. Para cadastrar, alterar e receber pagamentos, utilize uma conta comercial.</div>}
        <header className="topbar">
          <button className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button>
          <div className="topbar-breadcrumb"><span>{businessName}</span><ChevronRight size={14} /><b>{pageName}</b></div>
          <div className="topbar-right">
            <span className="today-pill"><span /> Sistema funcionando</span>
            <span className="topbar-date">{dateLabel(localDate(), { weekday: "short", day: "2-digit", month: "short" })}</span>
            <button type="button" className="topbar-logout" onClick={onLogout} title="Sair da conta" aria-label="Sair da conta"><LogOut size={17}/></button>
            <span className="topbar-avatar">{user.name[0]}</span>
          </div>
        </header>
        <main className="page-content">{children}</main>
        <nav className="mobile-nav" aria-label="Navegação móvel">
          {visibleNavItems.slice(0, 5).map(({ to, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} aria-label={visibleNavItems.find((item) => item.to === to).label}
              className={({ isActive }) => `mobile-nav-link ${isActive ? "mobile-nav-active" : ""}`}>
              <Icon size={20} /><span>{visibleNavItems.find((item) => item.to === to).label.split(" ")[0]}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function PageTitle({ eyebrow, title, description, actions }) {
  return <div className="page-title-row">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>;
}

function StatCard({ title, value, note, icon: Icon, tone = "blue" }) {
  return <article className="stat-card">
    <div className={`stat-icon stat-${tone}`}><Icon size={19} /></div>
    <div className="stat-copy"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>
    <span className="stat-trend"><ArrowRight size={15} /></span>
  </article>;
}

function AppointmentCard({ appointment, onOpen, compact = false }) {
  const message = `Olá, ${appointment.clientName}! Passando para confirmar seu horário de ${appointment.serviceName} no dia ${dateTimeLabel(appointment.startsAt)} com ${appointment.professionalName}. Podemos confirmar?`;
  const whatsapp = whatsappUrl(appointment.clientPhone, message);
  return (
    <article className={`appointment-card ${compact ? "appointment-card-compact" : ""}`}>
      <button className="appointment-main" onClick={() => onOpen(appointment)}>
        <span className="appointment-time">{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(appointment.startsAt))}</span>
        <span className="appointment-info"><b>{appointment.clientName}</b><small>{appointment.serviceName} · {appointment.professionalName}</small></span>
        <span className={`status-badge ${statusStyles[appointment.status]}`}>{statusNames[appointment.status]}</span>
      </button>
      {!compact && <div className="appointment-footer">
        <span>{money(appointment.priceCents)}</span>
        {whatsapp && <a className="whatsapp-link" href={whatsapp} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          <Phone size={13} /> WhatsApp
        </a>}
      </div>}
    </article>
  );
}

function ReceptionDashboard({ user }) {
  const [overview, setOverview] = useState(null);
  const [schedule, setSchedule] = useState({ appointments: [], blockedSlots: [] });
  const [error, setError] = useState("");
  const today = localDate();
  useEffect(() => {
    Promise.all([
      api("/overview"),
      api(`/schedule?from=${today}T00:00:00&to=${shiftDate(today,1)}T00:00:00`),
    ]).then(([o, s]) => { setOverview(o); setSchedule(s); setError(""); })
      .catch(e => setError(e.message));
  }, [today]);
  const waiting = schedule.appointments.filter(item => item.status === "agendado");
  const confirmed = schedule.appointments.filter(item => item.status === "confirmado");
  return <>
    <PageTitle eyebrow="CENTRAL DE ATENDIMENTO" title={`Bom trabalho, ${user.name.split(" ")[0]} 👋`}
      description="Acompanhe os horários, confirme solicitações e organize o atendimento ao cliente."
      actions={<Link className="button button-primary" to="/agenda"><CalendarDays size={16}/> Abrir agenda</Link>}/>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid">
      <StatCard title="Atendimentos hoje" value={overview?.todayCount ?? "—"} icon={CalendarDays}
        note="Agenda do estabelecimento"/>
      <StatCard title="Aguardando confirmação" value={waiting.length} icon={Clock3}
        tone="orange" note="Horários ainda agendados"/>
      <StatCard title="Confirmados hoje" value={confirmed.length} icon={CheckCheck}
        tone="green" note="Atendimentos confirmados"/>
      <StatCard title="Bloqueios hoje" value={schedule.blockedSlots.length} icon={CalendarX2}
        tone="purple" note="Horários indisponíveis"/>
    </section>
    <div className="overview-grid">
      <section className="panel upcoming-panel">
        <div className="panel-heading"><div><p className="eyebrow">PRIORIDADES DO DIA</p><h2>Agendamentos para conferir</h2></div>
          <Link to="/agenda" className="text-link">Abrir agenda <ArrowRight size={14}/></Link></div>
        {waiting.length ? <div className="appointments-list">{waiting.slice(0,6).map(item =>
          <AppointmentCard key={item.id} appointment={item} compact onOpen={() => { window.location.href="/agenda"; }}/>)}</div> :
          <EmptyState icon={CheckCheck} title="Nenhuma confirmação pendente hoje"
            description="Novos horários e solicitações aparecerão aqui quando estiverem agendados."/>}
      </section>
      <section className="panel shortcut-panel">
        <div className="panel-heading"><div><p className="eyebrow">ATENDIMENTO RÁPIDO</p><h2>O que você precisa fazer?</h2></div></div>
        <div className="shortcuts">
          <Link className="shortcut-item" to="/solicitacoes"><span className="shortcut-icon blue"><ClipboardCheck size={18}/></span><span><b>Solicitações online</b><small>Confirmar ou recusar pedidos públicos</small></span><ArrowRight size={15}/></Link>
          <Link className="shortcut-item" to="/agenda"><span className="shortcut-icon blue"><CalendarDays size={18}/></span><span><b>Organizar agenda</b><small>Registrar, confirmar ou remarcar</small></span><ArrowRight size={15}/></Link>
          <Link className="shortcut-item" to="/clientes"><span className="shortcut-icon green"><Users size={18}/></span><span><b>Clientes</b><small>Buscar e cadastrar clientes</small></span><ArrowRight size={15}/></Link>
          <Link className="shortcut-item" to="/compartilhar"><span className="shortcut-icon violet"><QrCode size={18}/></span><span><b>Agendamento público</b><small>Compartilhar link com o cliente</small></span><ArrowRight size={15}/></Link>
        </div>
      </section>
    </div>
  </>;
}

function OverviewPage({ user }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => api("/overview").then(setData).catch((reason) => setError(reason.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const navigate = useNavigate();
  if (!data && !error) return <Loading />;
  return <>
    <PageTitle eyebrow={`${user.role === "profissional" ? "MINHA ROTINA" : "RESUMO DO NEGÓCIO"} · ${dateLabel(localDate(), { weekday: "long" }).toUpperCase()}`} title={`Olá, ${user.name.split(" ")[0]} 👋`}
      description={user.role === "profissional" ? "Seus horários, serviços concluídos e comissões em um só lugar." : "Aqui está um resumo do seu negócio. Tenha um ótimo dia!"}
      actions={<Button onClick={() => navigate(user.role === "profissional" ? "/meus-atendimentos" : "/agenda")}>
        <CalendarDays size={17} /> {user.role === "profissional" ? "Meus atendimentos" : "Ver agenda"}
      </Button>} />
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid">
      {user.role === "profissional" ? <>
        <StatCard title="Atendimentos hoje" value={data?.todayCount ?? "—"} note="Na minha agenda" icon={CalendarDays} />
        <StatCard title="Serviços concluídos hoje" value={data?.completedToday ?? "—"} note="Registrados como realizados" icon={ClipboardCheck} tone="purple" />
        <StatCard title="Bloqueios hoje" value={data?.blockedToday ?? 0} note="Almoço, pausas e compromissos" icon={CalendarX2} tone="green" />
        <StatCard title="Próximo atendimento" value={data?.upcoming?.[0] ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.upcoming[0].startsAt)) : "Livre"}
          note={data?.upcoming?.[0]?.clientName ?? "Sem próximos horários"} icon={Clock3} tone="orange"/>
      </> : <>
        <StatCard title="Atendimentos hoje" value={data?.todayCount ?? "—"} note="Na agenda de hoje" icon={CalendarDays} />
        <StatCard title={user.role === "dono" ? "Faturamento do mês" : "Agendamentos no mês"}
          value={user.role === "dono" ? money(data?.monthRevenueCents) : data?.monthCount ?? "—"}
          note={user.role === "dono" ? `${data?.monthCount ?? 0} atendimentos agendados` : "Na agenda do negócio"}
          icon={CircleDollarSign} tone="green" />
        <StatCard title="Clientes ativos" value={data?.activeClients ?? "—"} note="Com horário neste mês" icon={Users} tone="purple" />
        <StatCard title="Próximo atendimento" value={data?.upcoming?.[0] ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.upcoming[0].startsAt)) : "Livre"}
          note={data?.upcoming?.[0]?.clientName ?? "Sem próximos horários"} icon={Clock3} tone="orange" />
      </>}
    </section>
    <section className="overview-grid">
      <div className="panel upcoming-panel">
        <div className="panel-heading"><div><p className="eyebrow">AGENDA DO DIA</p><h2>Próximos atendimentos</h2></div><Link to="/agenda" className="text-link">Ver agenda <ArrowRight size={14} /></Link></div>
        {data?.upcoming?.length ? <div className="appointments-list">{data.upcoming.slice(0, 5).map((appointment) =>
          <AppointmentCard key={appointment.id} appointment={appointment} compact onOpen={() => setSelected(appointment)} />)}</div>
          : <EmptyState icon={CalendarDays} title="Sua agenda está livre" description="Aproveite para organizar seus próximos horários." action={<Button variant="secondary" onClick={() => navigate("/agenda")}><CalendarDays size={15} /> Abrir agenda</Button>} />}
      </div>
      <div className="panel shortcut-panel">
        <div className="panel-heading"><div><p className="eyebrow">ACESSO RÁPIDO</p><h2>O que você precisa?</h2></div></div>
        <div className="shortcuts">
          <Link to="/agenda" className="shortcut-item"><span className="shortcut-icon blue"><CalendarDays size={18} /></span><span><b>Organizar agenda</b><small>Visualize sua semana</small></span><ArrowRight size={15} /></Link>
          {user.role === "profissional" ? <>
            <Link to="/meus-atendimentos" className="shortcut-item"><span className="shortcut-icon violet"><ClipboardCheck size={18}/></span><span><b>Registrar serviços</b><small>Concluir atendimentos realizados</small></span><ArrowRight size={15}/></Link>
            <Link to="/meus-ganhos" className="shortcut-item"><span className="shortcut-icon green"><Wallet size={18}/></span><span><b>Meus ganhos</b><small>Comissões pagas e a receber</small></span><ArrowRight size={15}/></Link>
          </> : <>
          <Link to="/clientes" className="shortcut-item"><span className="shortcut-icon green"><Users size={18} /></span><span><b>Cadastrar cliente</b><small>Guarde os detalhes</small></span><ArrowRight size={15} /></Link>
          <Link to="/servicos" className="shortcut-item"><span className="shortcut-icon violet"><Scissors size={18} /></span><span><b>Gerenciar serviços</b><small>Equipe, preços e duração</small></span><ArrowRight size={15} /></Link>
          {user.role === "dono" && <Link to="/financeiro" className="shortcut-item"><span className="shortcut-icon amber"><Wallet size={18} /></span><span><b>Conferir resultados</b><small>Receitas e comissões</small></span><ArrowRight size={15} /></Link>}</>}
        </div>
        <div className="quick-tip"><Sparkles size={17} /><span><b>Dica para o seu dia</b><small>Confirme seus atendimentos pelo WhatsApp e evite faltas.</small></span></div>
      </div>
    </section>
    {selected && <AppointmentDetails appointment={selected}
      readOnly={user.role === "profissional" || user.tenantId === "tenant-salao-demo"}
      canCompleteService={user.role === "profissional"}
      onClose={() => setSelected(null)}
      onUpdated={() => { setSelected(null); refresh(); }}/>}
    <footer className="page-footer">Feito para deixar sua rotina mais leve <span>♥</span></footer>
  </>;
}

function EmptyState({ icon: Icon = CalendarDays, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><b>{title}</b><p>{description}</p>{action}</div>;
}

function AppointmentForm({ onClose, onSaved, initialDate, user }) {
  const isProfessional = user.role === "profissional";
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [values, setValues] = useState({
    clientId: "", serviceId: "", professionalId: isProfessional ? user.id : "",
    startsAt: `${initialDate}T09:00`, notes: "",
  });
  const [quickClient, setQuickClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", phone: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const reloadClients = useCallback(() =>
    api(isProfessional ? "/booking/clients" : "/clients")
      .then(({ clients: list }) => setClients(list)), [isProfessional]);
  useEffect(() => {
    Promise.all([reloadClients(), api("/services"), api("/professionals")])
      .then(([, svc, pro]) => {
        const activePros = pro.professionals.filter(item => item.active);
        setProfessionals(activePros);
        // Every active service in this establishment is available for internal appointments.
        // Service assignments are not required to book a professional's own calendar.
        setServices(svc.services.filter(item => item.active));
      }).catch(reason => setError(reason.message));
  }, [reloadClients, isProfessional, user.id]);

  const selectedService = services.find(item => item.id === values.serviceId);
  const options = professionals.filter(person =>
    !isProfessional || person.id === user.id);
  const submit = async event => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      let clientId = values.clientId;
      if (quickClient) {
        if (!newClient.name.trim()) throw new Error("Informe o nome da cliente.");
        if (isProfessional) {
          const response = await api("/booking/clients", { method: "POST", body: newClient });
          clientId = response.client.id;
        } else {
          const response = await api("/clients", { method: "POST", body: newClient });
          clientId = response.client.id;
        }
      }
      await api("/appointments", { method: "POST", body: { ...values, clientId } });
      onSaved();
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  };
  return <Modal title="Novo agendamento" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <SelectField label="Cliente (opcional)" value={quickClient ? "__new__" : values.clientId}
        onChange={event => {
          if (event.target.value === "__new__") { setQuickClient(true); setValues(v => ({ ...v, clientId: "" })); }
          else { setQuickClient(false); setValues(v => ({ ...v, clientId: event.target.value })); }
        }}>
        <option value="">Atendimento sem cliente cadastrado</option>
        <option value="__new__">+ Cadastrar cliente rapidamente</option>
        {clients.map(client => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` · ${client.phone}` : ""}</option>)}
      </SelectField>
      {quickClient && <div className="form-grid">
        <Field label="Nome da cliente" required maxLength={120} value={newClient.name}
          onChange={event => setNewClient(c => ({ ...c, name: event.target.value }))}/>
        <Field label="Telefone (opcional)" type="tel" maxLength={40} value={newClient.phone}
          onChange={event => setNewClient(c => ({ ...c, phone: event.target.value }))}/>
      </div>}
      <div className="form-grid">
        <SelectField label="Serviço" required value={values.serviceId}
          onChange={event => setValues(v => ({
            ...v, serviceId: event.target.value,
            professionalId: isProfessional ? user.id : "",
          }))}>
          <option value="">Selecione um serviço</option>
          {services.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.priceCents)}</option>)}
        </SelectField>
        <SelectField label="Profissional" required value={values.professionalId}
          onChange={event => setValues(v => ({ ...v, professionalId: event.target.value }))}>
          <option value="">Selecione</option>
          {options.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </SelectField>
      </div>
      {!services.length &&
        <p className="booking-share-notice">Não há serviços ativos cadastrados neste estabelecimento. Solicite ao administrador que cadastre ou ative um serviço.</p>}
      {!options.length &&
        <p className="booking-share-notice">Não há profissionais ativos disponíveis no estabelecimento. Solicite ao administrador que verifique a equipe.</p>}
      <Field label="Data e horário" type="datetime-local" required value={values.startsAt}
        onChange={event => setValues(v => ({ ...v, startsAt: event.target.value }))}/>
      <Field label="Observações" placeholder="Algum detalhe importante?" value={values.notes}
        onChange={event => setValues(v => ({ ...v, notes: event.target.value }))}/>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button disabled={saving || !services.length || !options.length}>
          {saving ? "Salvando..." : "Salvar agendamento"}
        </Button>
      </div>
    </form>
  </Modal>;
}

function BlockForm({ onClose, onSaved, initialDate, user }) {
  const [professionals, setProfessionals] = useState([]);
  const [values, setValues] = useState({ professionalId: user.role === "profissional" ? user.id : "", startsAt: `${initialDate}T12:00`, endsAt: `${initialDate}T13:00`, reason: "" });
  const [error, setError] = useState("");
  useEffect(() => { api("/professionals").then(({ professionals: people }) => setProfessionals(people)); }, []);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try { await api("/blocked-slots", { method: "POST", body: values }); onSaved(); }
    catch (reason) { setError(reason.message); }
  };
  return <Modal title="Bloquear horário" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      {user.role !== "profissional" && <SelectField label="Profissional" value={values.professionalId} onChange={(e) => setValues({ ...values, professionalId: e.target.value })}>
        <option value="">Toda a equipe</option>{professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </SelectField>}
      {user.role === "profissional" && <p className="booking-share-notice">Este bloqueio vale apenas para seus próprios horários.</p>}
      <Field label="Início" type="datetime-local" required value={values.startsAt} onChange={(e) => setValues({ ...values, startsAt: e.target.value })} />
      <Field label="Fim" type="datetime-local" required value={values.endsAt} onChange={(e) => setValues({ ...values, endsAt: e.target.value })} />
      <Field label="Motivo / observação" placeholder="Ex.: almoço, saída para compromisso pessoal" value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} />
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Bloquear horário</Button></div>
    </form>
  </Modal>;
}

function AppointmentDetails({ appointment, onClose, onUpdated, readOnly = false, canCompleteService = false }) {
  const [status, setStatus] = useState(appointment.status);
  const [method, setMethod] = useState(appointment.paymentMethod ?? "");
  const [price, setPrice] = useState(appointment.priceCents);
  const [startsAt, setStartsAt] = useState(appointment.startsAt.slice(0, 16));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (patch) => {
    setSaving(true); setError("");
    try { await api(`/appointments/${appointment.id}`, { method: "PATCH", body: patch }); onUpdated(); }
    catch (reason) { setError(reason.message); } finally { setSaving(false); }
  };
  const completeOwn = async () => {
    if (!canCompleteService || !["agendado", "confirmado"].includes(appointment.status)) return;
    const scheduledTime = new Date(appointment.startsAt).getTime();
    const earlyCompletion = Number.isFinite(scheduledTime) && scheduledTime > Date.now();
    const confirmation = earlyCompletion
      ? "Este horário ainda não começou. Confirma que o serviço foi realmente realizado antecipadamente? O pagamento ficará pendente."
      : "Confirmar que o serviço foi realizado? O pagamento ficará pendente para a administração.";
    if (!window.confirm(confirmation)) return;
    setSaving(true);
    setError("");
    try {
      await api(`/professional/my-services/${encodeURIComponent(appointment.id)}/complete`, { method: "POST" });
      onUpdated();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };
  const message = `Olá, ${appointment.clientName}! Passando para confirmar seu horário de ${appointment.serviceName} no dia ${dateTimeLabel(appointment.startsAt)} com ${appointment.professionalName}. Podemos confirmar?`;
  const whatsApp = whatsappUrl(appointment.clientPhone, message);
  return <Modal title="Detalhes do atendimento" onClose={onClose}>
    <div className="detail-person"><span className="profile-avatar large">{appointment.clientName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span><div><h3>{appointment.clientName}</h3><span>{appointment.clientPhone || "Sem telefone cadastrado"}</span></div></div>
    <div className="detail-summary">
      <div><span>Serviço</span><b>{appointment.serviceName}</b></div>
      <div><span>Profissional</span><b>{appointment.professionalName}</b></div>
    </div>
    {readOnly && <p className="booking-share-notice"><Info size={17}/>{canCompleteService
      ? "Você pode concluir seus próprios serviços aqui. O recebimento e alterações financeiras ficam com a administração."
      : "Visualização somente leitura. Não é possível alterar este atendimento na demonstração."}</p>}
    {canCompleteService && ["agendado", "confirmado"].includes(appointment.status) && <div className="form-stack mt-5">
      <ErrorMessage>{error}</ErrorMessage>
      <Button disabled={saving} onClick={completeOwn}><CheckCheck size={16}/> {saving ? "Concluindo..." : "Concluir serviço realizado"}</Button>
    </div>}
    {!readOnly && <div className="form-stack mt-5">
      <Field label="Remarcar para" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      <div className="form-grid">
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(statusNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </SelectField>
        <Field label="Valor (R$)" type="number" min="0" step="0.01" value={(Number(price) / 100).toFixed(2)}
          onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} />
      </div>
      <SelectField label="Forma de pagamento" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="">Ainda não pago</option>{Object.entries(paymentNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </SelectField>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions modal-actions-split">
        {whatsApp && <a href={whatsApp} target="_blank" rel="noreferrer" className="button button-whatsapp"><Phone size={16} /> WhatsApp</a>}
        <Button disabled={saving} onClick={() => save({ status, paymentMethod: method, priceCents: price, ...(startsAt !== appointment.startsAt.slice(0, 16) ? { startsAt } : {}) })}>{saving ? "Salvando..." : "Salvar alterações"}</Button>
      </div>
    </div>}
  </Modal>;
}

function AgendaPage({ user }) {
  const [date, setDate] = useState(localDate());
  const [view, setView] = useState("dia");
  const [data, setData] = useState({ appointments: [], blockedSlots: [] });
  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const days = useMemo(() => {
    const weekStart = shiftDate(date, -(new Date(`${date}T12:00:00`).getDay() + 6) % 7);
    return view === "semana" ? Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index)) : [date];
  }, [date, view]);
  const refresh = useCallback(() => {
    const from = `${days[0]}T00:00:00`;
    const to = `${shiftDate(days[days.length - 1], 1)}T00:00:00`;
    api(`/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(setData).catch((reason) => setError(reason.message));
  }, [days]);
  useEffect(() => { refresh(); }, [refresh]);
  const move = (offset) => setDate(shiftDate(date, offset * (view === "semana" ? 7 : 1)));
  return <>
    <PageTitle eyebrow="SUA ROTINA EM UM SÓ LUGAR" title="Agenda" description={dateLabel(date)}
      actions={<>{user.tenantId !== "tenant-salao-demo" && <Button variant="secondary" onClick={() => setModal("block")}><CalendarX2 size={16} /> Bloquear horário</Button>}{user.tenantId !== "tenant-salao-demo" && <Button onClick={() => setModal("new")}><Plus size={17} /> Novo agendamento</Button>}</>} />
    <div className="agenda-toolbar">
      <div className="date-nav"><button className="icon-button" onClick={() => move(-1)} aria-label="Anterior"><ChevronLeft size={18} /></button>
        <button className="date-today" onClick={() => setDate(localDate())}>Hoje</button><button className="icon-button" onClick={() => move(1)} aria-label="Próximo"><ChevronRight size={18} /></button></div>
      <div className="view-switch"><button className={view === "dia" ? "selected" : ""} onClick={() => setView("dia")}>Dia</button><button className={view === "semana" ? "selected" : ""} onClick={() => setView("semana")}>Semana</button></div>
      <span className="agenda-current-label">{view === "semana" ? `${dateLabel(days[0], { day: "2-digit", month: "short" })} — ${dateLabel(days.at(-1), { day: "2-digit", month: "short" })}` : dateLabel(date, { weekday: "long", day: "2-digit", month: "long" })}</span>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className={`panel calendar-panel ${view === "semana" ? "week-calendar" : ""}`}>
      <div className="calendar-heading"><div className="calendar-time-spacer" /><div className="calendar-day-heads">{days.map((day) => <div key={day} className={day === localDate() ? "calendar-day-today" : ""}>
        <span>{dateLabel(day, { weekday: "short" })}</span><b>{day.slice(-2)}</b></div>)}</div></div>
      <div className="calendar-body">
        <div className="time-column">{Array.from({ length: 12 }, (_, i) => <span key={i}>{`${String(i + 8).padStart(2, "0")}:00`}</span>)}</div>
        <div className="calendar-day-columns">{days.map((day) => {
          const events = data.appointments.filter((item) => item.startsAt.slice(0, 10) === day);
          const blocks = data.blockedSlots.filter((item) => item.startsAt.slice(0, 10) === day);
          return <div className="calendar-day-column" key={day}>
            {Array.from({ length: 12 }, (_, i) => <button key={i} className="calendar-hour" onClick={() => { if (user.tenantId !== "tenant-salao-demo") { setDate(day); setModal("new"); } }} aria-label={`Novo agendamento às ${i + 8}:00`} />)}
            {events.map((item) => {
              const start = new Date(item.startsAt);
              const mins = start.getHours() * 60 + start.getMinutes() - 8 * 60;
              if (mins < 0 || mins > 720) return null;
              const height = Math.max(50, (item.durationMinutes / 60) * 64);
              return <button key={item.id} className={`calendar-event event-${item.status}`} style={{ top: `${mins / 60 * 64 + 6}px`, height: `${height}px` }} onClick={() => setSelected(item)}>
                <b>{item.clientName}</b><span>{dateTimeLabel(item.startsAt).split(" ")[1]} · {item.serviceName}</span>
              </button>;
            })}
            {blocks.map((block) => <div key={block.id} className="calendar-block" style={{ top: `${((new Date(block.startsAt).getHours() - 8) * 60 + new Date(block.startsAt).getMinutes()) / 60 * 64 + 4}px` }}>{block.professionalName || "Equipe"} · {block.reason || "Indisponível"} · por {block.createdByName || "Não identificado"}</div>)}
          </div>;
        })}</div>
      </div>
    </section>
    <div className="agenda-list-panel panel">
      <div className="panel-heading"><div><p className="eyebrow">{view === "dia" ? "DETALHES DO DIA" : "SEMANA"}</p><h2>Atendimentos</h2></div><span className="count-chip">{data.appointments.length} agendados</span></div>
      {days.map((day) => {
        const events = data.appointments.filter((item) => item.startsAt.slice(0, 10) === day);
        const blocks = data.blockedSlots.filter((item) => item.startsAt.slice(0, 10) === day);
        return <div key={day} className="agenda-day-group">
          {view === "semana" && <h3>{dateLabel(day, { weekday: "long", day: "2-digit", month: "long" })}</h3>}
          {events.length ? events.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} onOpen={setSelected} />)
            : <p className="day-empty">Nenhum atendimento neste dia.</p>}
          {blocks.map((block) => <div className="block-row" key={block.id}><CalendarX2 size={16} /> {block.professionalName || "Equipe"} · {block.reason || "Horário indisponível"} · Bloqueado por {block.createdByName || "Não identificado"}
            <span>{dateTimeLabel(block.startsAt)} — {dateTimeLabel(block.endsAt)}</span><button className="icon-button compact" onClick={() => api(`/blocked-slots/${block.id}`, { method: "DELETE" }).then(refresh).catch(reason => setError(reason.message))} aria-label="Remover bloqueio"><X size={15} /></button></div>)}
        </div>;
      })}
    </div>
    {modal === "new" && <AppointmentForm initialDate={date} user={user} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {modal === "block" && <BlockForm initialDate={date} user={user} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {selected && <AppointmentDetails appointment={selected} readOnly={user.role === "profissional" || user.tenantId === "tenant-salao-demo"} canCompleteService={user.role === "profissional"} onClose={() => setSelected(null)} onUpdated={() => { setSelected(null); refresh(); }} />}
  </>;
}

function ClientForm({ client, onClose, onSaved }) {
  const [values, setValues] = useState({ name: client?.name ?? "", phone: client?.phone ?? "", email: client?.email ?? "", notes: client?.notes ?? "" });
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try {
      await api(client ? `/clients/${client.id}` : "/clients", { method: client ? "PATCH" : "POST", body: values });
      onSaved();
    } catch (reason) { setError(reason.message); }
  };
  return <Modal title={client ? "Editar cliente" : "Novo cliente"} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Nome completo" required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
      <Field label="WhatsApp / telefone" type="tel" placeholder="(11) 99999-9999" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
      <Field label="E-mail" type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
      <Field label="Observações" placeholder="Preferências, alergias, detalhes importantes..." value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
      <ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Salvar cliente</Button></div>
    </form>
  </Modal>;
}

function QuickClientForm({ onClose, onSaved }) {
  const [values, setValues] = useState({ name: "", phone: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError("");
    try { await api("/booking/clients", { method: "POST", body: values }); onSaved(); }
    catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  };
  return <Modal title="Cadastro rápido de cliente" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Nome da cliente" required maxLength={120} value={values.name}
        onChange={event => setValues(v => ({ ...v, name: event.target.value }))}/>
      <Field label="Telefone (opcional)" maxLength={40} type="tel" value={values.phone}
        onChange={event => setValues(v => ({ ...v, phone: event.target.value }))}/>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button disabled={saving}>{saving ? "Salvando..." : "Cadastrar cliente"}</Button>
      </div>
    </form>
  </Modal>;
}

function ClientsPage({ user }) {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => api(`${user.role === "profissional" ? "/booking/clients" : "/clients"}?search=${encodeURIComponent(search)}`).then(({ clients: list }) => setClients(list)).catch((reason) => setError(reason.message)), [search, user.role]);
  useEffect(() => { refresh(); }, [refresh]);
  const showHistory = async (client) => {
    try { const result = await api(`/clients/${client.id}/history`); setHistory({ client, appointments: result.history }); }
    catch (reason) { setError(reason.message); }
  };
  return <>
    <PageTitle eyebrow="RELACIONAMENTO QUE FIDELIZA" title="Clientes" description="Conheça melhor quem confia no seu trabalho."
      actions={user.tenantId !== "tenant-salao-demo" && <Button onClick={() => setModal({})}><Plus size={17} /> Novo cliente</Button>} />
    <ErrorMessage>{error}</ErrorMessage>
    <section className="panel clients-panel">
      <div className="table-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <span className="count-chip">{clients.length} clientes</span>{user.role !== "profissional" && <a className="button button-secondary export-button" href="/api/export/clients.csv"><Download size={15} /> Exportar CSV</a>}</div>
      {clients.length ? <div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>CONTATO</th>{user.role !== "profissional" && <><th>ATENDIMENTOS</th><th>ÚLTIMA VISITA</th></>}<th> </th></tr></thead>
        <tbody>{clients.map((client) => <tr key={client.id}>
          <td><div className="table-person"><span className="table-avatar">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><b>{client.name}</b><small>{user.role === "profissional" ? "Cliente do estabelecimento" : client.email || client.notes || "Cliente Simplifica"}</small></div></div></td>
          <td>{client.phone || "—"}</td>{user.role !== "profissional" && <td><span className="count-chip">{client.appointmentCount}</span></td>}
          {user.role !== "profissional" && <td>{client.lastVisit ? dateTimeLabel(client.lastVisit) : "Ainda sem visita"}</td>}
          <td><div className="row-actions">{user.role !== "profissional" && <button className="text-link" onClick={() => showHistory(client)}>Histórico</button>}
            {user.role !== "profissional" && <button className="icon-button compact" onClick={() => setModal(client)} aria-label="Editar cliente"><MoreHorizontal size={18} /></button>}
            {client.phone && <a className="icon-button compact" aria-label="Enviar mensagem" href={whatsappUrl(client.phone, `Olá, ${client.name}! Tudo bem?`) } target="_blank" rel="noreferrer"><Phone size={15} /></a>}</div></td>
        </tr>)}</tbody></table></div>
        : <EmptyState icon={Users} title="Sua lista começa aqui" description="Cadastre seus clientes e acompanhe cada visita." action={user.tenantId !== "tenant-salao-demo" && <Button onClick={() => setModal({})}><Plus size={15} /> Cadastrar cliente</Button>} />}
    </section>
    {modal && (user.role === "profissional" ?
      <QuickClientForm onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }}/> :
      <ClientForm client={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }}/>)}
    {history && <Modal title={`Histórico de ${history.client.name}`} onClose={() => setHistory(null)} wide>
      <p className="mb-4 text-sm text-slate-500">{history.client.notes || "Sem observações sobre este cliente."}</p>
      {history.appointments.length ? <div className="appointments-list">{history.appointments.map((item) => <div className="history-item" key={item.id}><span>{dateTimeLabel(item.startsAt)}</span><b>{item.serviceName}</b><span>{item.professionalName}</span><span className={`status-badge ${statusStyles[item.status]}`}>{statusNames[item.status]}</span></div>)}</div>
        : <EmptyState icon={CalendarDays} title="Nenhum atendimento ainda" description="Os atendimentos deste cliente aparecerão aqui." />}
    </Modal>}
  </>;
}

function ServiceForm({ service, professionals, onClose, onSaved }) {
  const [values, setValues] = useState({
    name: service?.name ?? "", durationMinutes: service?.durationMinutes ?? 60,
    priceCents: service?.priceCents ?? 0, houseSharePercent: service?.houseSharePercent ?? 0,
    commissionMode: service?.commissionMode ?? "professional", serviceCommissionPercent: service?.serviceCommissionPercent ?? 0, publicEnabled: service?.publicEnabled !== 0, professionalIds: service?.professionalIds ?? [],
  });
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try {
      await api(service ? `/services/${service.id}` : "/services", {
        method: service ? "PATCH" : "POST",
        body: { ...values, priceCents: Math.round(Number(values.priceCents) * (service ? 1 : 100)) },
      });
      onSaved();
    } catch (reason) { setError(reason.message); }
  };
  return <Modal title={service ? "Editar serviço" : "Novo serviço"} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Nome do serviço" required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
      <div className="form-grid">
        <Field label="Duração (minutos)" type="number" min="5" step="5" value={values.durationMinutes} onChange={(e) => setValues({ ...values, durationMinutes: e.target.value })} />
        <Field label="Preço (R$)" type="number" min="0" step="0.01" value={service ? (Number(values.priceCents) / 100).toFixed(2) : values.priceCents}
          onChange={(e) => setValues({ ...values, priceCents: service ? Math.round(Number(e.target.value) * 100) : e.target.value })} />
      </div>
      <SelectField label="Como calcular a comissão deste serviço?" value={values.commissionMode}
        onChange={e => setValues(v => ({ ...v, commissionMode: e.target.value }))}>
        <option value="professional">Usar comissão padrão do profissional</option>
        <option value="custom">Definir percentual próprio deste serviço</option>
      </SelectField>
      {values.commissionMode === "custom" && <Field label="Percentual bruto destinado ao profissional (%)" type="number" min="0" max="100" step="0.5"
        value={values.serviceCommissionPercent} onChange={e => setValues(v => ({ ...v, serviceCommissionPercent: e.target.value }))}/>}
      {values.commissionMode === "custom" && Number(values.serviceCommissionPercent) === 100 && Number(values.houseSharePercent) === 0 &&
        <p className="panel-subtitle">Repasse integral: 100% do preço ao profissional, sem retenção.</p>}
      <Field label="Retenção adicional do estabelecimento (% do preço)" type="number" min="0" max="100" step="0.5"
        value={values.houseSharePercent} onChange={e => setValues(v => ({...v,houseSharePercent:e.target.value}))}/>
      <p className="panel-subtitle">Ex.: serviço com repasse de 70% e retenção de materiais de 10 pontos → profissional recebe 60% do preço. Altere a comissão deste serviço sem modificar os serviços já agendados ou pagos.</p>
      <label className="choice-option"><input type="checkbox" checked={Boolean(values.publicEnabled)}
        onChange={e=>setValues(v=>({...v,publicEnabled:e.target.checked}))}/> Disponível para reserva pelo link ou QR Code</label>
      <p className="panel-subtitle">Todos os profissionais ativos deste estabelecimento podem ser selecionados pelos clientes para este serviço quando a reserva online estiver habilitada.</p>
      <ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Salvar serviço</Button></div>
    </form>
  </Modal>;
}

function TeamMemberForm({ services, businessSlug, onClose, onSaved }) {
  const [values, setValues] = useState({ name: "", email: "", password: "", phone: "", role: "profissional", jobTitle: "", commissionPercent: 40, serviceIds: [] });
  const [error, setError] = useState("");
  const [issued, setIssued] = useState(null);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try {
      const result = await api("/team-members", { method: "POST", body: { ...values, commissionPercent: Number(values.commissionPercent) } });
      if (result.loginCode && result.activationToken) setIssued(result);
      else onSaved();
    }
    catch (reason) { setError(reason.message); }
  };
  return <Modal title="Adicionar à equipe" onClose={onClose}>
    {issued ? <div className="form-stack">
      <p className="success-message">Profissional cadastrado. Copie os dados de ativação agora; o código temporário não poderá ser consultado depois.</p>
      <Field label="Código de acesso único" readOnly value={issued.loginCode}/>
      <Field label="Código de ativação (válido por 24h)" readOnly value={issued.activationToken}/>
      <Button type="button" onClick={() => navigator.clipboard.writeText(`Código de acesso: ${issued.loginCode} | Ativação: ${issued.activationToken}`)}>Copiar informações</Button>
      <Button type="button" variant="secondary" onClick={onSaved}>Concluir</Button>
    </div> : <form className="form-stack" onSubmit={submit}>
      <Field label="Nome" required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
      {values.role === "recepcao" ? <>
        <Field label="E-mail de acesso" type="email" required value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
        <Field label="Senha inicial" type="password" minLength="12" required value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
      </> : values.role === "profissional" ? <p className="booking-share-notice"><Info size={16}/> Um código único de acesso será gerado automaticamente. O profissional escolherá a senha no primeiro acesso, sem precisar informar o estabelecimento.</p> :
      <p className="booking-share-notice"><Info size={16}/> Cadastro administrativo sem login. Ideal para serviços gerais, apoio, copa e outras funções sem acesso ao painel.</p>}
      <SelectField label="Perfil de acesso" value={values.role} onChange={(e) => setValues({ ...values, role: e.target.value })}>
        <option value="profissional">Profissional de atendimento</option><option value="recepcao">Recepção</option><option value="sem_acesso">Funcionário sem acesso ao sistema</option>
      </SelectField>
      <Field label="Cargo / função (livre)" required maxLength={80} placeholder="Ex.: Cabeleireiro, Manicure, Depiladora, Copeira" value={values.jobTitle}
        onChange={event => setValues({ ...values, jobTitle: event.target.value })}/>
      <div className="form-grid"><Field label="Telefone / WhatsApp" type="tel" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
        {values.role === "profissional" && <Field label="Comissão (%)" type="number" min="0" max="100" value={values.commissionPercent} onChange={(e) => setValues({ ...values, commissionPercent: e.target.value })} />}</div>
      {values.role === "profissional" && <div className="field"><span className="field-label">Serviços realizados</span><div className="choice-list">{services.map((service) =>
        <label key={service.id} className="choice-option"><input type="checkbox" checked={values.serviceIds.includes(service.id)}
          onChange={(event) => setValues({ ...values, serviceIds: event.target.checked ? [...values.serviceIds, service.id] : values.serviceIds.filter((id) => id !== service.id) })} />{service.name}</label>)}</div></div>}
      <ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Cadastrar funcionário</Button></div>
    </form>}
  </Modal>;
}

function TeamHours({ professional, onClose }) {
  const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const [hours, setHours] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => { api(`/professionals/${professional.id}/hours`).then(({ hours: values }) => setHours(values)).catch((reason) => setError(reason.message)); }, [professional.id]);
  const change = (weekday, key, value) => setHours((current) => current.map((hour) =>
    hour.weekday === weekday ? { ...hour, [key]: value } : hour));
  const submit = async (event) => {
    event.preventDefault();
    try { await api(`/professionals/${professional.id}/hours`, { method: "PUT", body: { hours } }); onClose(); }
    catch (reason) { setError(reason.message); }
  };
  return <Modal title={`Horários de ${professional.name}`} onClose={onClose} wide>
    <form className="form-stack" onSubmit={submit}>
      {hours.map((hour) => <div className="hours-row" key={hour.weekday}><b>{weekdays[hour.weekday]}</b>
        <label className="hours-check"><input type="checkbox" checked={!!hour.opensAt && !!hour.closesAt} onChange={(e) => {
          change(hour.weekday, "opensAt", e.target.checked ? "09:00" : ""); change(hour.weekday, "closesAt", e.target.checked ? "18:00" : "");
        }} /> Atende</label>
        {hour.opensAt && <><input className="input hours-input" type="time" value={hour.opensAt} onChange={(e) => change(hour.weekday, "opensAt", e.target.value)} />
          <span>às</span><input className="input hours-input" type="time" value={hour.closesAt} onChange={(e) => change(hour.weekday, "closesAt", e.target.value)} /></>}
      </div>)}
      <ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Salvar horários</Button></div>
    </form>
  </Modal>;
}

function ProfessionalEarningsPage() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    api(`/professional/earnings?month=${encodeURIComponent(month)}`)
      .then(result => { setData(result); setError(""); })
      .catch(reason => setError(reason.message));
  }, [month]);
  return <>
    <PageTitle eyebrow="MINHAS COMISSÕES" title="Meus ganhos"
      description="Confira suas comissões de serviços concluídos e os pagamentos registrados pelo comércio."/>
    <div className="month-filter"><label htmlFor="earnings-month">Mês de referência</label>
      <input id="earnings-month" className="input month-input" type="month" value={month} onChange={event => setMonth(event.target.value)}/></div>
    <ErrorMessage>{error}</ErrorMessage>
    {!data ? !error && <Loading/> : <>
      <section className="stats-grid finance-stats">
        <StatCard title="Saldo total a receber" value={money(data.allTime.dueCents)} note="Comissões de todos os períodos não pagas" icon={Wallet} tone="green"/>
        <StatCard title="Comissões deste mês" value={money(data.earnedCents)} note="Serviços concluídos no período" icon={ClipboardCheck} tone="blue"/>
        <StatCard title="Pagamentos registrados" value={money(data.allTime.paidCents)} note="Histórico total de comissões pagas" icon={CheckCheck} tone="purple"/>
      </section>
      <section className="panel management-panel">
        <div className="panel-heading"><div><p className="eyebrow">DETALHAMENTO</p><h2>Serviços prestados</h2>
          <p className="panel-subtitle">Os valores abaixo são comissões, não o preço integral dos serviços. Somente o proprietário registra o pagamento.</p></div></div>
        {data.services.length ? <div className="management-list">{data.services.map(item =>
          <article className="service-row" key={item.id}>
            <span className="service-row-icon"><Wallet size={18}/></span>
            <div className="min-w-0 flex-1"><b>{item.serviceName} · {item.clientName}</b>
              <small>{dateTimeLabel(item.startsAt)} · {Math.max(0,item.commissionPercent - (item.houseSharePercent || 0))}% líquido de comissão</small></div>
            <strong>{money(item.earnedCents)}</strong>
            <span className={`status-badge ${item.paid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {item.paid ? "Pago" : "A receber"}</span>
          </article>)}</div> : <EmptyState icon={Wallet} title="Sem ganhos registrados neste mês"
            description="A comissão aparece quando um serviço atribuído a você é concluído."/>}
      </section>
    </>}
  </>;
}

function TeamCommissionsPage() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const result = await api(`/commissions?month=${encodeURIComponent(month)}`);
      setItems(result.commissions); setError("");
    } catch(reason) { setError(reason.message); }
  }, [month]);
  useEffect(() => { refresh(); }, [refresh]);
  const registerPayment = async item => {
    if (!window.confirm(`Confirmar pagamento da comissão de ${item.professionalName} no valor de ${money(item.earnedCents)}? Essa operação será registrada como paga.`)) return;
    setSaving(item.id);
    try {
      await api(`/commissions/${item.id}/pay`, { method: "POST" });
      await refresh();
    } catch (reason) { setError(reason.message); }
    finally { setSaving(null); }
  };
  const unpaid = items.filter(item => !item.paid);
  return <>
    <PageTitle eyebrow="CONTROLE DA EQUIPE" title="Comissões da equipe"
      description="Registre o pagamento de comissões pelos serviços concluídos; o saldo do profissional é atualizado automaticamente."/>
    <div className="month-filter"><label htmlFor="commissions-month">Mês</label>
      <input id="commissions-month" className="input month-input" type="month" value={month}
        onChange={event => setMonth(event.target.value)}/></div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid finance-stats">
      <StatCard title="Pendente no mês" value={money(unpaid.reduce((sum,item)=>sum+item.earnedCents,0))}
        note="Comissões de serviços concluídos" icon={Wallet} tone="orange"/>
      <StatCard title="Pago no mês" value={money(items.filter(item=>item.paid).reduce((sum,item)=>sum+item.paidCents,0))}
        note="Pagamentos registrados" icon={CheckCheck} tone="green"/>
    </section>
    <section className="panel management-panel">
      <div className="panel-heading"><div><h2>Comissões por serviço</h2>
        <p className="panel-subtitle">Registrar pagamento não transfere dinheiro. Confirme apenas após pagar o profissional.</p></div></div>
      {items.length ? <div className="management-list">{items.map(item =>
        <article className="service-row" key={item.id}>
          <span className="service-row-icon"><CircleDollarSign size={18}/></span>
          <div className="min-w-0 flex-1"><b>{item.professionalName} · {item.serviceName}</b>
            <small>{dateTimeLabel(item.startsAt)} · {item.commissionPercent}% de comissão</small></div>
          <strong>{money(item.earnedCents)}</strong>
          {item.paid ? <span className="status-badge bg-emerald-50 text-emerald-700">Pago</span> : <>
            <Button variant="secondary" onClick={()=>setAdjusting({...item, reason:""})}>Ajustar comissão</Button>
            <Button disabled={saving === item.id} onClick={()=>registerPayment(item)}>{saving === item.id ? "Salvando..." : "Registrar pagamento"}</Button>
          </>}
        </article>)}</div> : <EmptyState icon={Wallet} title="Sem comissões neste mês"
          description="Conclua os atendimentos para registrar comissões."/>}
    </section>
    {adjusting && <Modal title="Ajustar comissão do serviço" onClose={()=>setAdjusting(null)}>
      <form className="form-stack" onSubmit={async event=>{
        event.preventDefault(); setError("");
        try {
          await api(`/commissions/${adjusting.id}`, {method:"PATCH",body:{
            commissionPercent:Number(adjusting.commissionPercent),
            houseSharePercent:Number(adjusting.houseSharePercent || 0),
            reason:adjusting.reason,
          }});
          setAdjusting(null); await refresh();
        } catch(e){setError(e.message);}
      }}>
        <p className="panel-subtitle">Altera somente este serviço, com registro do motivo. Pagamentos já efetuados não podem ser editados diretamente.</p>
        <Field label="Comissão do profissional (%)" type="number" min="0" max="100" step="0.5" value={adjusting.commissionPercent}
          onChange={e=>setAdjusting(v=>({...v,commissionPercent:e.target.value}))}/>
        <Field label="Retenção do estabelecimento / materiais (%)" type="number" min="0" max="100" step="0.5"
          value={adjusting.houseSharePercent ?? 0} onChange={e=>setAdjusting(v=>({...v,houseSharePercent:e.target.value}))}/>
        <Field label="Motivo do ajuste" required minLength={5} maxLength={250}
          value={adjusting.reason} onChange={e=>setAdjusting(v=>({...v,reason:e.target.value}))}/>
        <p className="booking-share-notice">Comissão efetiva: {Math.max(0,Number(adjusting.commissionPercent)-Number(adjusting.houseSharePercent||0))}% do serviço.</p>
        <ErrorMessage>{error}</ErrorMessage>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={()=>setAdjusting(null)}>Cancelar</Button><Button>Salvar ajuste</Button></div>
      </form>
    </Modal>}
  </>;
}

function ProfessionalWorkPage() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [data, setData] = useState({ services: [], totals: { appointments: 0, completed: 0, serviceValueCents: 0 } });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const result = await api(`/professional/my-services?month=${encodeURIComponent(month)}`);
      setData(result); setError("");
    } catch (reason) { setError(reason.message); }
  }, [month]);
  useEffect(() => { refresh(); }, [refresh]);
  const complete = async (id) => {
    const item = data.services.find(service => service.id === id);
    const aheadOfSchedule = item?.startsAt > new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
      minute: "2-digit", hourCycle: "h23",
    }).format(new Date()).replace(" ", "T");
    if (!window.confirm(aheadOfSchedule
      ? "O horário previsto ainda não começou. O serviço foi realmente realizado antecipadamente?"
      : "Confirmar que este serviço foi realizado?")) return;
    setSaving(id);
    try {
      await api(`/professional/my-services/${encodeURIComponent(id)}/complete`, { method: "POST" });
      await refresh();
    } catch (reason) { setError(reason.message); }
    finally { setSaving(null); }
  };
  const canComplete = item => ["agendado", "confirmado"].includes(item.status);
  return <>
    <PageTitle eyebrow="ÁREA DO PROFISSIONAL" title="Meus atendimentos"
      description="Visualize seus serviços e registre os que foram efetivamente realizados." />
    <div className="month-filter"><label htmlFor="professional-month">Mês</label>
      <input id="professional-month" className="input month-input" type="month" value={month}
        onChange={e => setMonth(e.target.value)}/></div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid finance-stats">
      <StatCard title="Meus agendamentos" value={data.totals.appointments} note="No período" icon={CalendarDays} />
      <StatCard title="Serviços realizados" value={data.totals.completed} note="Concluídos" icon={CheckCheck} tone="green"/>
      <StatCard title="Valor dos serviços realizados" value={money(data.totals.serviceValueCents)}
        note="Valor bruto; veja comissões em Meus ganhos" icon={Scissors} tone="blue"/>
    </section>
    <section className="panel management-panel">
      <div className="panel-heading"><div><p className="eyebrow">REGISTRO DE SERVIÇOS</p>
        <h2>Atendimentos atribuídos a mim</h2></div></div>
      {data.services.length ? <div className="management-list">
        {data.services.map(item => <article className="service-row" key={item.id}>
          <span className="service-row-icon"><ClipboardCheck size={18}/></span>
          <div className="min-w-0 flex-1"><b>{item.clientName} · {item.serviceName}</b>
            <small>{dateTimeLabel(item.startsAt)} · {statusNames[item.status]}</small></div>
          <span className={`status-badge ${statusStyles[item.status]}`}>{statusNames[item.status]}</span>
          {canComplete(item) && <Button disabled={saving === item.id} onClick={() => complete(item.id)}>
            {saving === item.id ? "Salvando..." : "Concluir serviço"}
          </Button>}
        </article>)}
      </div> : <EmptyState icon={CalendarDays} title="Nenhum serviço neste mês"
        description="Seus atendimentos agendados aparecerão aqui."/>}
    </section>
  </>;
}

function ServicesPage({ user, section = "services" }) {
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [team, setTeam] = useState([]);
  const [modal, setModal] = useState("");
  const [hoursFor, setHoursFor] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [activationIssued, setActivationIssued] = useState(null);
  const [editPerson, setEditPerson] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => Promise.all([
    api("/services"),
    api("/professionals"),
    user.role === "dono" && user.tenantId !== "tenant-salao-demo" && section === "team" ? api("/team-members") : Promise.resolve(null),
  ])
    .then(([s, p, people]) => { setServices(s.services); setProfessionals(p.professionals); setTeam(people?.team ?? p.professionals); })
    .catch((reason) => setError(reason.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  return <>
    <PageTitle eyebrow="GESTÃO DO ESTABELECIMENTO"
      title={section === "team" ? "Equipe e acessos" : "Serviços"}
      description={section === "team" ? "Cadastre funcionários, defina funções, serviços e horários." : "Organize os serviços, preços e duração dos atendimentos."}
      actions={user.role === "dono" && user.tenantId !== "tenant-salao-demo" && (section === "team"
        ? <Button onClick={() => setModal("team")}><UserRound size={16} /> Adicionar funcionário</Button>
        : <Button onClick={() => setModal("service")}><Plus size={16} /> Novo serviço</Button>)} />
    <ErrorMessage>{error}</ErrorMessage>
    <div className="management-grid">
      {section === "services" && <section className="panel management-panel"><div className="panel-heading"><div><p className="eyebrow">SERVIÇOS OFERECIDOS</p><h2>Serviços</h2></div><span className="count-chip">{services.length}</span></div>
        {services.length ? <div className="management-list">{services.map((service) => <article className="service-row" key={service.id}>
          <span className="service-row-icon"><Scissors size={18} /></span><div className="min-w-0 flex-1"><b>{service.name}</b><small>{service.durationMinutes} min · {service.commissionMode === "custom" ? `Repasse ${service.serviceCommissionPercent}%` : "Comissão padrão da equipe"} · Retenção ${service.houseSharePercent || 0}%</small></div>
          <strong>{money(service.priceCents)}</strong>{user.role === "dono" && user.tenantId !== "tenant-salao-demo" && <button className="icon-button compact" onClick={() => setModal(service)} aria-label="Editar serviço"><MoreHorizontal size={18} /></button>}
        </article>)}</div> : <EmptyState icon={Scissors} title="Nenhum serviço cadastrado" description="Adicione seu primeiro serviço." />}</section>}
      {section === "team" && <section className="panel management-panel"><div className="panel-heading"><div><p className="eyebrow">QUEM FAZ ACONTECER</p><h2>Equipe</h2></div><span className="count-chip">{team.filter((person) => person.active).length} ativos</span></div>
        {team.length ? <div className="management-list">{team.map((person) => <article className="professional-row" key={person.id}>
          <span className="table-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
          <div className="min-w-0 flex-1"><b>{person.name}</b><small>{person.jobTitle || (person.role === "recepcao" ? "Recepção" : person.role === "sem_acesso" ? "Apoio" : "Profissional")}</small><small>{person.role === "profissional" ? `Acesso ${person.loginCode || person.staffCode || "—"} · Comissão padrão ${person.commissionPercent}%` : person.role === "recepcao" ? `${person.email} · Recepção` : "Sem login"}</small></div>
          {person.active ? <span className="status-badge bg-emerald-50 text-emerald-700">Ativa</span> : <span className="status-badge bg-slate-100 text-slate-500">Inativa</span>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && <button className="button button-quiet" onClick={() => setEditPerson({...person})}>Editar</button>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && person.role === "profissional" && <button className="button button-quiet" onClick={() => setHoursFor(person)}>Horários</button>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && person.role === "profissional" && <button className="button button-quiet" onClick={async () => {
            try {
              const result = await api(`/team-members/${person.id}/activation`, { method: "POST" });
              setActivationIssued({ ...result, name: person.name });
            } catch (reason) { setError(reason.message); }
          }}>Configurar acesso</button>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && person.role === "recepcao" && <button className="button button-quiet" onClick={() => { setPasswordFor(person); setResetPassword(""); }}>Redefinir senha</button>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && <button className="icon-button compact" onClick={async () => {
            try { await api(`/team-members/${person.id}`, { method: "PATCH", body: { name: person.name, phone: person.phone, commissionPercent: person.commissionPercent, active: !person.active } }); refresh(); }
            catch (reason) { setError(reason.message); }
          }} aria-label={person.active ? "Desativar pessoa da equipe" : "Ativar pessoa da equipe"}><ShieldCheck size={16} /></button>}
        </article>)}</div> : <EmptyState icon={UserRound} title="Só você por enquanto" description="Adicione profissionais para compartilhar a agenda." />}</section>}
    </div>
    {modal === "team" && <TeamMemberForm services={services} businessSlug={user.slug} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {(modal === "service" || modal?.id) && <ServiceForm service={modal?.id ? modal : null} professionals={professionals} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {editPerson && <Modal title={`Editar funcionário · ${editPerson.name}`} onClose={() => setEditPerson(null)}>
      <form className="form-stack" onSubmit={async event => {
        event.preventDefault(); setError("");
        try {
          await api(`/team-members/${editPerson.id}`, { method:"PATCH", body:{
            name:editPerson.name, phone:editPerson.phone, jobTitle:editPerson.jobTitle,
            commissionPercent:Number(editPerson.commissionPercent), active:Boolean(editPerson.active),
          } });
          setEditPerson(null); refresh();
        } catch(e) { setError(e.message); }
      }}>
        <Field label="Nome" required value={editPerson.name} onChange={e=>setEditPerson(v=>({...v,name:e.target.value}))}/>
        <Field label="Cargo ou função" maxLength={80} required value={editPerson.jobTitle || ""}
          onChange={e=>setEditPerson(v=>({...v,jobTitle:e.target.value}))}/>
        <Field label="Telefone" value={editPerson.phone || ""} onChange={e=>setEditPerson(v=>({...v,phone:e.target.value}))}/>
        {editPerson.role === "profissional" && <Field label="Comissão padrão (%)" type="number" min="0" max="100" step="0.5"
          value={editPerson.commissionPercent} onChange={e=>setEditPerson(v=>({...v,commissionPercent:e.target.value}))}/>}
        <p className="panel-subtitle">A comissão padrão será aplicada apenas a novos agendamentos. Para corrigir um serviço já concluído, use Comissões da equipe.</p>
        <ErrorMessage>{error}</ErrorMessage>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={()=>setEditPerson(null)}>Cancelar</Button><Button>Salvar alterações</Button></div>
      </form>
    </Modal>}
    {hoursFor && <TeamHours professional={hoursFor} onClose={() => { setHoursFor(null); refresh(); }} />}
    {activationIssued && <Modal title={`Ativação de ${activationIssued.name}`} onClose={() => setActivationIssued(null)}>
      <div className="form-stack">
        <p className="booking-share-notice"><Info size={16}/> Entregue o código de ativação diretamente ao profissional. Validade de 24 horas. A senha anterior deixa de funcionar após a nova ativação; as sessões já foram encerradas.</p>
        <Field label="Código único de acesso" value={activationIssued.loginCode} readOnly/>
        <Field label="Código temporário de ativação" value={activationIssued.activationToken} readOnly/>
        <Button type="button" onClick={() => navigator.clipboard.writeText(`Código de acesso: ${activationIssued.loginCode} | Ativação: ${activationIssued.activationToken}`)}>Copiar código de ativação</Button>
        <Button type="button" variant="secondary" onClick={() => setActivationIssued(null)}>Fechar</Button>
      </div>
    </Modal>}
    {passwordFor && <Modal title={`Redefinir senha de ${passwordFor.name}`} onClose={() => setPasswordFor(null)}>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api(`/team-members/${passwordFor.id}/reset-password`, { method: "POST", body: { password: resetPassword } });
          setPasswordFor(null); setResetPassword(""); setError("");
        } catch (reason) { setError(reason.message); }
      }}>
        <p className="panel-subtitle">Ao salvar, as sessões atuais deste funcionário serão encerradas. Informe a nova senha em um canal seguro.</p>
        <Field label="Nova senha (mínimo 12 caracteres)" type="password" minLength={12} required
          value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
        <Button>Redefinir senha</Button>
      </form>
    </Modal>}
  </>;
}

function BookingSharePage({ user }) {
  const publicPath = `/agendar/${encodeURIComponent(user.slug || "")}`;
  const [baseUrl, setBaseUrl] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { setBaseUrl(window.location.origin); }, []);
  const link = baseUrl ? `${baseUrl}${publicPath}` : publicPath;
  const isLocal = /^(localhost|127\\.0\\.0\\.1)$/i.test((() => {
    try { return new URL(link).hostname; } catch { return ""; }
  })());
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Link copiado. Compartilhe com seus clientes.");
    } catch {
      setMessage("Não foi possível copiar automaticamente. Selecione e copie o endereço acima.");
    }
  };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(
    `Agende seu horário em nosso estabelecimento: ${link}`
  )}`;
  return <>
    <PageTitle eyebrow="AGENDAMENTO PARA CLIENTES" title="Divulgar meu agendamento"
      description="Compartilhe sua página pública sem dar acesso ao painel administrativo."/>
    <div className="management-grid booking-sharing-grid">
      <section className="panel management-panel booking-share-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">LINK EXCLUSIVO</p><h2>Sua página de agendamento</h2>
            <p className="panel-subtitle">O cliente escolhe serviço, profissional, data e horário. A solicitação aparece na agenda do estabelecimento.</p></div>
          <Link2 size={20} className="text-blue-500"/>
        </div>
        <div className="booking-url-box">
          <input className="input" aria-label="Endereço de agendamento" value={link} readOnly onFocus={event => event.target.select()}/>
          <Button type="button" onClick={copyLink}><Copy size={16}/> Copiar link</Button>
        </div>
        <div className="booking-share-actions">
          <a className="button button-secondary" href={publicPath} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Ver página do cliente</a>
          <a className="button button-secondary" href={whatsapp} target="_blank" rel="noreferrer"><Share2 size={16}/> Enviar por WhatsApp</a>
        </div>
        {message && <p role="status" className="success-message">{message}</p>}
        {isLocal && <p className="booking-share-notice"><Info size={17}/> Este link usa localhost. Ele funciona neste computador, mas para clientes em outros dispositivos será necessário publicar a página em HTTPS ou usar um endereço acessível na rede.</p>}
        {user.tenantId === "tenant-salao-demo" && <p className="booking-share-notice"><Info size={17}/> Esta é uma demonstração de compartilhamento. A reserva pública demonstrativa não grava solicitações reais.</p>}
      </section>
      <section className="panel management-panel booking-qr-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">DIVULGAÇÃO</p><h2>QR Code</h2>
            <p className="panel-subtitle">Exiba no balcão ou compartilhe com seu cliente.</p></div>
          <QrCode size={20} className="text-blue-500"/>
        </div>
        {baseUrl && <img
          className="booking-qr-image"
          alt="QR Code que direciona para a página pública de agendamentos"
          src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=12&data=${encodeURIComponent(link)}`}
        />}
        <p className="booking-qr-caption">O QR Code é gerado por um serviço externo e requer conexão com a internet. Não compartilha dados de clientes, apenas o endereço público de agendamento.</p>
      </section>
    </div>
  </>;
}



function UnreconciledCash({ user, onChange }) {
  const [receipts, setReceipts] = useState([]);
  const [date, setDate] = useState(localDate().slice(0, 10));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fetchReceipts = useCallback(() => api("/cash/unreconciled")
    .then(result => setReceipts(result.receipts)).catch(err => setError(err.message)), []);
  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);
  const reconcile = async receipt => {
    if (!window.confirm(`Confirma que o pagamento de ${money(receipt.priceCents)} foi recebido em ${date}? A conciliação ficará registrada no histórico.`)) return;
    setBusy(receipt.id); setError("");
    try {
      await api(`/cash/reconcile/${encodeURIComponent(receipt.id)}`, {method:"POST", body:{date}});
      await fetchReceipts();
      onChange();
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  };
  if (!receipts.length) return null;
  return <section className="panel management-panel">
    <div className="panel-heading"><div><p className="eyebrow">CONCILIAÇÃO</p><h2>Recebimentos anteriores sem data</h2>
      <p className="panel-subtitle">Estes pagamentos pertencem à empresa, mas ainda não possuem uma data de recebimento comprovada. Não serão duplicados.</p></div>
      {user.role === "dono" && <input type="date" className="input" aria-label="Data real do pagamento"
        value={date} max={localDate().slice(0, 10)} onChange={e => setDate(e.target.value)}/>}
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <div className="management-list">{receipts.map(receipt => <article className="service-row" key={receipt.id}>
      <span className="service-row-icon"><Clock3 size={18}/></span>
      <div className="min-w-0 flex-1"><b>{receipt.clientName} · {receipt.professionalName}</b>
        <small>Atendimento: {dateTimeLabel(receipt.startsAt)} · {paymentNames[receipt.paymentMethod] || receipt.paymentMethod}</small></div>
      <strong>{money(receipt.priceCents)}</strong>
      {user.role === "dono" && <Button disabled={busy === receipt.id || !date}
        onClick={() => reconcile(receipt)}>{busy === receipt.id ? "Salvando..." : "Conciliar"}</Button>}
    </article>)}</div>
    {user.role === "recepcao" && <p className="panel-subtitle">Somente o administrador pode confirmar as datas históricas destes pagamentos.</p>}
  </section>;
}

function DailyCashClosing({ revision }) {
  const [date, setDate] = useState(localDate().slice(0, 10));
  const [summary, setSummary] = useState(null);
  const [closings, setClosings] = useState([]);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([
      api(`/cash/daily?date=${encodeURIComponent(date)}`),
      api("/cash/closings")
    ]).then(([day, history]) => {
      if (!active) return;
      setSummary(day);
      setClosings(history.closings);
      setCounted((day.expectedCashCents / 100).toFixed(2));
      setError("");
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [date, updated, revision]);
  const closeDay = async () => {
    const input = String(counted).trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(input)) {
      setError("Informe o valor em dinheiro contado, com até duas casas decimais."); return;
    }
    const countedCashCents = Math.round(Number(input) * 100);
    if (!Number.isSafeInteger(countedCashCents)) {
      setError("Valor informado inválido."); return;
    }
    if (!window.confirm(`Confirmar fechamento de ${date}? O registro ficará bloqueado para edição.`)) return;
    setBusy(true); setError("");
    try {
      await api("/cash/closings", {method:"POST", body:{date, countedCashCents, notes}});
      setUpdated(n => n + 1);
      setNotes("");
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const methods = summary?.closing?.methods || summary?.methods || {};
  return <section className="panel management-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">CONFERÊNCIA DIÁRIA</p><h2>Fechamento diário de caixa</h2>
        <p className="panel-subtitle">Confira os pagamentos recebidos na data. O valor contado refere-se apenas ao dinheiro físico.</p></div>
      <input className="input" type="date" aria-label="Data do caixa" value={date}
        max={summary?.today || localDate().slice(0,10)} onChange={e => setDate(e.target.value)}/>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    {!summary ? <p className="report-empty">Carregando o caixa...</p> : <>
      <div className="stats-grid finance-stats">
        <StatCard title="Total recebido" value={money(summary.closing?.expectedTotalCents ?? summary.expectedTotalCents)} note={`${summary.closing?.receiptCount ?? summary.receiptCount} recebimento(s)`} icon={Wallet} tone="green"/>
        <StatCard title="Dinheiro esperado" value={money(summary.closing?.expectedCashCents ?? summary.expectedCashCents)} note="Somente pagamentos em espécie" icon={CircleDollarSign} tone="blue"/>
        <StatCard title="Situação" value={summary.closing ? "Fechado" : "Aberto"} note={summary.closing ? `Por ${summary.closing.closedByName}` : "Aguardando conferência"} icon={CheckCheck} tone={summary.closing ? "green" : "orange"}/>
      </div>
      <div className="management-list">
        {Object.entries(paymentNames).map(([key,label]) => <div className="service-row" key={key}>
          <span className="service-row-icon"><Wallet size={18}/></span>
          <div className="min-w-0 flex-1"><b>{label}</b></div>
          <strong>{money(methods[key] || 0)}</strong>
        </div>)}
      </div>
      {summary.closing ? <div className="panel" style={{marginTop:16}}>
        <b>Fechado por {summary.closing.closedByName}</b>
        <p className="panel-subtitle">Dinheiro contado: {money(summary.closing.countedCashCents)} · Diferença: {money(summary.closing.differenceCents)}</p>
        {summary.closing.notes && <p className="panel-subtitle">Observação: {summary.closing.notes}</p>}
      </div> : <>
        <div className="month-filter" style={{marginTop:16}}>
          <label htmlFor="counted-cash">Dinheiro contado (R$)</label>
          <input id="counted-cash" className="input month-input" inputMode="decimal"
            value={counted} onChange={e => setCounted(e.target.value)} placeholder="0,00"/>
        </div>
        <div className="month-filter">
          <label htmlFor="cash-notes">Observações da conferência</label>
          <textarea id="cash-notes" className="input" maxLength={500} value={notes}
            onChange={e => setNotes(e.target.value)} placeholder="Informe uma justificativa se houver diferença no dinheiro contado."/>
        </div>
        <Button disabled={busy || date > (summary.today || date)} onClick={closeDay}>
          {busy ? "Fechando..." : "Confirmar fechamento do dia"}
        </Button>
      </>}
    </>}
    <div className="panel-heading" style={{marginTop:24}}><div><p className="eyebrow">REGISTROS</p><h3>Últimos fechamentos</h3></div></div>
    {closings.length ? <div className="management-list">{closings.map(item =>
      <article className="service-row" key={item.id}>
        <span className="service-row-icon"><Check size={18}/></span>
        <div className="min-w-0 flex-1"><b>{item.cashDate} · {item.closedByName}</b>
          <small>{item.receiptCount} recebimento(s) · Diferença: {money(item.differenceCents)}</small></div>
        <strong>{money(item.expectedTotalCents)}</strong>
      </article>)}</div> : <p className="report-empty">Ainda não existem fechamentos registrados.</p>}
    <p className="panel-subtitle">Recebimentos antigos sem data registrada não entram automaticamente na conferência diária.</p>
  </section>;
}

function ReceivablesPage({ user }) {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [cashRevision, setCashRevision] = useState(0);
  const [method, setMethod] = useState("pix");
  const refresh = useCallback(() =>
    api(`/receivables?month=${encodeURIComponent(month)}`)
      .then(data => setItems(data.receivables))
      .catch(reason => setError(reason.message)), [month]);
  useEffect(() => { refresh(); }, [refresh]);
  const pending = items.filter(item => !item.paid);
  const paid = items.filter(item => item.paid);
  const total = (rows) => rows.reduce((sum, item) => sum + item.priceCents, 0);
  const receive = async (item) => {
    setBusy(item.id); setError("");
    try {
      await api(`/receivables/${item.id}/pay`, { method: "POST", body: { paymentMethod: method } });
      await refresh();
      setCashRevision(n => n + 1);
    } catch (reason) { setError(reason.message); } finally { setBusy(""); }
  };
  return <>
    <PageTitle eyebrow="CONTROLE DE CAIXA" title="Caixa e recebimentos"
      description="Separe os serviços realizados dos pagamentos efetivamente registrados." />
    <div className="month-filter"><label htmlFor="cash-month">Mês de referência</label>
      <input id="cash-month" className="input month-input" type="month" value={month}
        onChange={e => setMonth(e.target.value)} /></div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid finance-stats">
      <StatCard title="Recebido" value={money(total(paid))} note="Serviços com pagamento registrado" icon={Wallet} tone="green" />
      <StatCard title="A receber" value={money(total(pending))} note={`${pending.length} atendimento(s) pendente(s)`} icon={Clock3} tone="orange" />
      <StatCard title="Concluídos" value={items.length} note="No período selecionado" icon={CheckCheck} tone="blue" />
    </section>
    <section className="panel management-panel">
      <div className="panel-heading"><div><p className="eyebrow">RECEBIMENTOS PENDENTES</p><h2>Registrar recebimento</h2>
        <p className="panel-subtitle">O sistema não registra pagamentos automaticamente ao concluir um atendimento.</p></div>
        <select className="input" style={{ maxWidth: 200 }} aria-label="Forma de recebimento" value={method}
          onChange={event => setMethod(event.target.value)}>
          {Object.entries(paymentNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select>
      </div>
      {pending.length ? <div className="management-list">{pending.map(item =>
        <article className="service-row" key={item.id}>
          <span className="service-row-icon"><CircleDollarSign size={18}/></span>
          <div className="min-w-0 flex-1"><b>{item.clientName} · {item.serviceName}</b>
            <small>{dateTimeLabel(item.startsAt)} · {item.professionalName}</small></div>
          <strong>{money(item.priceCents)}</strong>
          <Button disabled={busy === item.id || user.tenantId === "tenant-salao-demo"}
            onClick={() => receive(item)}>{busy === item.id ? "Registrando..." : "Receber"}</Button>
        </article>)}</div> :
        <p className="report-empty">Nenhum recebimento pendente neste período.</p>}
    </section>
    <section className="panel management-panel">
      <div className="panel-heading"><div><p className="eyebrow">HISTÓRICO</p><h2>Pagamentos registrados</h2></div></div>
      {paid.length ? <div className="management-list">{paid.map(item =>
        <article className="service-row" key={item.id}>
          <span className="service-row-icon"><Check size={18}/></span>
          <div className="min-w-0 flex-1"><b>{item.clientName} · {item.serviceName}</b>
            <small>{dateTimeLabel(item.startsAt)} · {paymentNames[item.paymentMethod] || item.paymentMethod}</small></div>
          <strong>{money(item.priceCents)}</strong>
        </article>)}</div> : <p className="report-empty">Nenhum pagamento registrado neste período.</p>}
    </section>
    <UnreconciledCash user={user} onChange={() => setCashRevision(n => n + 1)}/>
    <DailyCashClosing revision={cashRevision}/>
  </>;
}


function AppointmentAuditReport({ month }) {
  const [events, setEvents] = useState([]);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api(`/reports/appointment-audit?month=${encodeURIComponent(month)}&action=${encodeURIComponent(action)}`)
      .then(data => { if (alive) { setEvents(data.events); setError(""); } })
      .catch(reason => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, [month, action]);
  const labels = { criacao: "Criado", confirmacao: "Confirmado", cancelamento: "Cancelado",
    remarcacao: "Remarcado", conclusao: "Concluído", pagamento: "Pagamento", status: "Status alterado",
    edicao: "Editado", comissao: "Comissão ajustada" };
  const detail = event => {
    const before = event.before || {}, after = event.after || {};
    const changes = [
      ["Status", "status"], ["Horário", "startsAt"], ["Valor", "priceCents"],
      ["Pagamento", "paymentMethod"], ["Comissão (%)", "commissionPercent"], ["Taxa estabelecimento (%)", "houseSharePercent"]
    ].filter(([, key]) => after[key] !== undefined && before[key] !== after[key])
      .map(([label, key]) => `${label}: ${before[key] === undefined ? "—" : before[key]} → ${after[key]}`);
    return changes.join(" · ") || "Ação registrada";
  };
  return <section className="panel management-panel">
    <div className="panel-heading"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Histórico de ações dos atendimentos</h2>
      <p className="panel-subtitle">Ações registradas no mês, com responsável e alterações. Até 300 eventos recentes.</p></div>
      <select className="input" aria-label="Filtrar ações" value={action} onChange={e => setAction(e.target.value)}>
        <option value="">Todas as ações</option>
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></div>
    <ErrorMessage>{error}</ErrorMessage>
    {events.length ? <div className="management-list">{events.map(event =>
      <article className="service-row" key={event.id}>
        <span className="service-row-icon"><Clock3 size={18}/></span>
        <div className="min-w-0 flex-1"><b>{labels[event.action] || event.action} · {event.clientName}</b>
          <small>{event.serviceName} · {event.actorName} · {dateTimeLabel(event.createdAt)}</small>
          <small style={{overflowWrap:"anywhere"}}>{detail(event)}</small>
        </div>
      </article>)}</div> : <p className="report-empty">Nenhuma ação registrada neste período.</p>}
  </section>;
}

function FinancePage() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => api(`/reports?month=${month}`).then(setReport).catch((reason) => setError(reason.message)), [month]);
  useEffect(() => { refresh(); }, [refresh]);
  const downloadBackup = async () => {
    try {
      const blob = await api("/export/backup");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "simplifica-agenda-backup.sqlite"; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason.message); }
  };
  return <>
    <PageTitle eyebrow="CUIDAR DO NEGÓCIO TAMBÉM É CUIDAR DE VOCÊ" title="Financeiro e relatórios" description="Acompanhe seus resultados com clareza."
      actions={<><a className="button button-secondary" href="/api/export/appointments.csv"><Download size={16} /> Exportar atendimentos</a><Button onClick={downloadBackup}><ArrowDownToLine size={16} /> Backup do banco</Button></>} />
    <div className="month-filter"><label htmlFor="report-month">Mês de referência</label><input id="report-month" className="input month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid finance-stats">
      <StatCard title="Faturamento recebido" value={money(report?.revenueCents)} note="Atendimentos concluídos e pagos" icon={CircleDollarSign} tone="green" />
      <StatCard title="A receber" value={money(report?.pendingCents)} note="Serviços concluídos sem pagamento" icon={Clock3} tone="orange" />
      <StatCard title="Atendimentos concluídos" value={report?.completedCount ?? "—"} note="Neste mês" icon={CheckCheck} tone="blue" />
      <StatCard title="Serviços realizados" value={report?.byService?.length ?? "—"} note="Com pelo menos um atendimento" icon={Scissors} tone="purple" />
      <StatCard title="Clientes para reativar" value={report?.inactiveClients?.length ?? "—"} note="Sem voltar há 30 dias ou mais" icon={Users} tone="orange" />
    </section>
    <div className="reports-grid">
      <section className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">O QUE MAIS SAI</p><h2>Serviços em destaque</h2></div></div>
        {report?.byService?.length ? <div className="report-list">{report.byService.map((item, index) => <div className="report-row" key={item.id}><span className={`rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><b>{item.name}</b><small>{item.count} atendimentos</small></div><strong>{money(item.revenueCents)}</strong></div>)}
        </div> : <p className="report-empty">Os serviços realizados aparecerão aqui.</p>}
      </section>
      <section className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">SEU TIME</p><h2>Comissão por profissional</h2></div></div>
        {report?.byProfessional?.length ? <div className="report-list">{report.byProfessional.map((item) => <div className="report-row" key={item.id}><span className="table-avatar">{item.name[0]}</span><div className="min-w-0 flex-1"><b>{item.name}</b><small>{item.count} atendimentos · {money(item.revenueCents)} em vendas</small></div><strong>{money(item.commissionCents)}</strong></div>)}
        </div> : <p className="report-empty">As comissões dos atendimentos concluídos aparecerão aqui.</p>}
      </section>
    </div>
    <section className="panel inactive-panel"><div className="panel-heading"><div><p className="eyebrow">HORA DE MATAR A SAUDADE</p><h2>Clientes que estão sumidos</h2><p className="panel-subtitle">Quem não aparece há pelo menos 30 dias merece uma mensagem especial.</p></div><span className="count-chip">{report?.inactiveClients?.length ?? 0} clientes</span></div>
      {report?.inactiveClients?.length ? <div className="inactive-list">{report.inactiveClients.map((client) => <div className="inactive-row" key={client.id}><span className="table-avatar">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
        <div className="min-w-0 flex-1"><b>{client.name}</b><small>Última visita em {dateTimeLabel(client.lastVisit)}</small></div>
        {client.phone && <a href={whatsappUrl(client.phone, `Oi, ${client.name}! Sentimos sua falta por aqui 💚 Que tal agendar um novo horário?`)} target="_blank" rel="noreferrer" className="button button-whatsapp"><Phone size={15} /> Chamar no WhatsApp</a>}</div>)}</div>
        : <p className="report-empty">Nenhum cliente sumido por enquanto. Seu relacionamento está em dia! 💚</p>}
    </section>
    <AppointmentAuditReport month={month}/>
  </>;
}

const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
function SettingsPage({ user, onUserUpdated }) {
  const [settings, setSettings] = useState(null);
  const [hours, setHours] = useState([]);
  const [tab, setTab] = useState("business");
  const [booking, setBooking] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  useEffect(() => {
    api("/settings").then(data => {
      setSettings(data.settings);
      setHours(data.hours);
      setBooking({ ...data.settings, bookingAllowCancellation: Boolean(data.settings.bookingAllowCancellation) });
    }).catch(reason => setError(reason.message));
  }, []);
  const updateHour = (weekday, key, value) =>
    setHours(current => current.map(hour => hour.weekday === weekday ? { ...hour, [key]: value } : hour));
  const save = async event => {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      await api("/settings", { method: "PUT", body: { ...settings, hours } });
      setMessage("Alterações salvas com sucesso.");
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  };
  const uploadLogo = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoError("");
    setMessage("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 500 * 1024 || !file.size) {
      setLogoError("Selecione PNG, JPG ou WebP de até 500 KB.");
      return;
    }
    setLogoBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
        reader.readAsDataURL(file);
      });
      const response = await api("/settings/logo", { method: "POST", body: { image: dataUrl } });
      setSettings(previous => ({ ...previous, logoUrl: response.logoUrl }));
      window.dispatchEvent(new CustomEvent("simplifica:logo-updated", { detail: response.logoUrl }));
      setMessage("Logo atualizada! Ela já está disponível na página pública.");
    } catch (reason) { setLogoError(reason.message); }
    finally { setLogoBusy(false); }
  };
  const removeLogo = async () => {
    if (!window.confirm("Remover a logo personalizada e voltar à imagem padrão?")) return;
    setLogoError(""); setLogoBusy(true);
    try {
      await api("/settings/logo", { method: "DELETE" });
      setSettings(previous => ({ ...previous, logoUrl: "" }));
      window.dispatchEvent(new CustomEvent("simplifica:logo-updated", { detail: "" }));
      setMessage("Logo removida. A imagem padrão será utilizada.");
    } catch (reason) { setLogoError(reason.message); }
    finally { setLogoBusy(false); }
  };
  if (!settings) return error ? <ErrorMessage>{error}</ErrorMessage> : <Loading />;
  return <>
    <PageTitle eyebrow="PERSONALIZAÇÃO E GESTÃO" title="Configurações do estabelecimento"
      description="Organize os dados comerciais, os horários e a segurança da sua conta." />
    <div className="settings-tab-bar" role="tablist" aria-label="Seções das configurações">
      <button type="button" role="tab" aria-selected={tab === "business"} className={tab === "business" ? "active" : ""}
        onClick={() => { setTab("business"); setError(""); setMessage(""); }}><Settings size={16}/> Estabelecimento</button>
      <button type="button" role="tab" aria-selected={tab === "hours"} className={tab === "hours" ? "active" : ""}
        onClick={() => { setTab("hours"); setError(""); setMessage(""); }}><Clock3 size={16}/> Horários</button>
      <button type="button" role="tab" aria-selected={tab === "booking"} className={tab === "booking" ? "active" : ""}
        onClick={() => { setTab("booking"); setError(""); setMessage(""); }}><CalendarClock size={16}/> Agendamento online</button>
      <button type="button" role="tab" aria-selected={tab === "account"} className={tab === "account" ? "active" : ""}
        onClick={() => { setTab("account"); setError(""); setMessage(""); }}><ShieldCheck size={16}/> Minha conta</button>
    </div>
    {tab === "business" && <form onSubmit={save} className="settings-single-section">
      <section className="panel settings-panel">
        <div className="panel-heading"><div><p className="eyebrow">IDENTIDADE E CONTATO</p><h2>Dados do estabelecimento</h2>
          <p className="panel-subtitle">Informações visíveis aos clientes na página de agendamento.</p></div></div>
        <div className="settings-logo-upload">
          <img src={settings.logoUrl || "/assets/simplifica-perfil.svg"} alt="Logo atual do estabelecimento"/>
          <div className="settings-logo-content">
            <b>Logo do estabelecimento</b>
            <small>PNG, JPG ou WebP de até 500 KB. A imagem é salva automaticamente quando selecionada.</small>
            <div className="settings-logo-actions">
              <label className="button button-secondary settings-file-action">
                <Upload size={15}/> {logoBusy ? "Enviando..." : settings.logoUrl ? "Trocar imagem" : "Selecionar imagem"}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} disabled={logoBusy} />
              </label>
              {settings.logoUrl && <Button type="button" variant="secondary" disabled={logoBusy} onClick={removeLogo}>
                <X size={14}/> Remover</Button>}
            </div>
            <ErrorMessage>{logoError}</ErrorMessage>
          </div>
        </div>
        <div className="form-stack mt-5">
          <Field label="Nome do estabelecimento" required maxLength={120} value={settings.businessName || ""}
            onChange={event => setSettings({ ...settings, businessName: event.target.value })}/>
          <Field label="Endereço" value={settings.address || ""}
            onChange={event => setSettings({ ...settings, address: event.target.value })}/>
          <div className="form-grid">
            <Field label="Telefone" type="tel" maxLength={40} value={settings.phone || ""}
              onChange={event => setSettings({ ...settings, phone: event.target.value })}/>
            <Field label="WhatsApp" type="tel" placeholder="(85) 99999-9999" value={settings.whatsapp || ""}
              onChange={event => setSettings({ ...settings, whatsapp: event.target.value })}/>
          </div>
          <p className="panel-subtitle">O WhatsApp abre uma conversa com o cliente, mas não envia mensagens automáticas.</p>
          <SelectField label="Aparência" value={settings.theme} onChange={event => {
            setSettings({ ...settings, theme: event.target.value });
            document.documentElement.classList.toggle("dark", event.target.value === "escuro");
          }}><option value="claro">Modo claro</option><option value="escuro">Modo escuro</option></SelectField>
        </div>
      </section>
      <div className="settings-save"><ErrorMessage>{error}</ErrorMessage>{message && <span className="success-message">{message}</span>}
        <Button disabled={saving}><Check size={16}/> {saving ? "Salvando..." : "Salvar alterações"}</Button></div>
    </form>}
    {tab === "hours" && <form onSubmit={save} className="settings-single-section">
      <section className="panel settings-panel">
        <div className="panel-heading"><div><p className="eyebrow">AGENDA DO COMÉRCIO</p><h2>Horários de funcionamento</h2>
          <p className="panel-subtitle">Defina os dias e horários disponíveis para agendamento.</p></div><Clock3 size={20}/></div>
        <div className="business-hours-list">{hours.map(hour =>
          <div className="hours-row" key={hour.weekday}>
            <b>{weekdays[hour.weekday]}</b>
            <label className="hours-check"><input type="checkbox" checked={!!hour.opensAt && !!hour.closesAt}
              onChange={event => setHours(previous => previous.map(item => item.weekday === hour.weekday ?
                { ...item, opensAt: event.target.checked ? "09:00" : "", closesAt: event.target.checked ? "18:00" : "" } : item))}/> Aberto</label>
            {hour.opensAt && <><input className="input hours-input" type="time" value={hour.opensAt}
              onChange={event => updateHour(hour.weekday, "opensAt", event.target.value)}/>
              <span>às</span><input className="input hours-input" type="time" value={hour.closesAt}
              onChange={event => updateHour(hour.weekday, "closesAt", event.target.value)}/></>}
          </div>)}</div>
      </section>
      <div className="settings-save"><ErrorMessage>{error}</ErrorMessage>{message && <span className="success-message">{message}</span>}
        <Button disabled={saving}><Check size={16}/> {saving ? "Salvando..." : "Salvar horários"}</Button></div>
    </form>}
    {tab === "booking" && booking && <form className="settings-single-section" onSubmit={async e => {
      e.preventDefault(); setSaving(true); setError(""); setMessage("");
      try { await api("/settings/booking", {method:"PATCH",body:booking}); setMessage("Regras de agendamento atualizadas."); }
      catch(e) { setError(e.message); } finally {setSaving(false);}
    }}>
      <section className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">RESERVAS PELO LINK OU QR CODE</p>
        <h2>Regras do agendamento online</h2><p className="panel-subtitle">Essas regras se aplicam apenas às novas reservas públicas deste estabelecimento.</p></div></div>
        <div className="form-stack">
          <Field label="Antecedência mínima para reservar (minutos)" type="number" min="0" max="10080" step="15" required
            value={booking.bookingMinNoticeMinutes} onChange={e=>setBooking(v=>({...v,bookingMinNoticeMinutes:Number(e.target.value)}))}/>
          <Field label="Até quantos dias à frente aceitar reservas" type="number" min="1" max="365" required
            value={booking.bookingMaxDays} onChange={e=>setBooking(v=>({...v,bookingMaxDays:Number(e.target.value)}))}/>
          <SelectField label="Intervalos para início dos horários" value={booking.bookingSlotIntervalMinutes}
            onChange={e=>setBooking(v=>({...v,bookingSlotIntervalMinutes:Number(e.target.value)}))}>
            <option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>60 minutos</option>
          </SelectField>
          <label className="choice-option"><input type="checkbox" checked={Boolean(booking.bookingAllowCancellation)}
            onChange={e=>setBooking(v=>({...v,bookingAllowCancellation:e.target.checked}))}/> Permitir cancelamento e remarcação pelo link do cliente</label>
          {booking.bookingAllowCancellation && <Field label="Limite para cancelar ou remarcar (horas antes)" type="number" min="0" max="168" required
            value={booking.bookingCancellationHours} onChange={e=>setBooking(v=>({...v,bookingCancellationHours:Number(e.target.value)}))}/>}
          <p className="panel-subtitle">Disponibilidade pública de cada serviço pode ser ligada ou desligada em Serviços. Reservas já feitas continuam registradas.</p>
        </div>
      </section>
      <div className="settings-save"><ErrorMessage>{error}</ErrorMessage>{message && <span className="success-message">{message}</span>}
        <Button disabled={saving}>{saving ? "Salvando..." : "Salvar regras"}</Button></div>
    </form>}
    {tab === "account" && <div className="settings-single-section">
      <AccountPage user={user} onUserUpdated={onUserUpdated} embedded/>
    </div>}
  </>;
}
function PublicBooking({ slug }) {
  const [data, setData] = useState(null);
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState(shiftDate(localDate(), 1));
  const [slots, setSlots] = useState([]);
  const [time, setTime] = useState("");
  const [client, setClient] = useState({ name: "", phone: "" });
  const [whatsappOptIn,setWhatsappOptIn] = useState(false);
  const [message, setMessage] = useState("");
  const [managementToken,setManagementToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  useEffect(() => {
    setData(null); setServiceId(""); setProfessionalId(""); setTime(""); setSlots([]); setError("");
    let active = true;
    api(`/public/${encodeURIComponent(slug)}`)
      .then(result => { if (active) setData(result); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [slug]);
  useEffect(() => {
    setSlots([]); setTime(""); setLoadingSlots(false);
    if (!serviceId || !professionalId || !date) return;
    let active = true;
    setLoadingSlots(true); setError("");
    api(`/public/${encodeURIComponent(slug)}/slots?serviceId=${encodeURIComponent(serviceId)}&professionalId=${encodeURIComponent(professionalId)}&date=${encodeURIComponent(date)}`)
      .then(({ slots: available }) => { if (active) setSlots(available || []); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [slug, serviceId, professionalId, date]);
  const service = data?.services.find((item) => item.id === serviceId);
  const professionals = data?.professionals ?? [];
  const professional = professionals.find(person => person.id === professionalId);
  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage("");
    if (!serviceId || !professionalId || !time) { setError("Selecione serviço, profissional e horário."); return; }
    const digits = client.phone.replace(/\D/g, "");
    if (!/^(?:55)?\d{10,11}$/.test(digits)) { setError("Informe WhatsApp com DDD válido."); return; }
    setLoading(true);
    try {
      const result = await api(`/public/${slug}/appointments`, { method: "POST", body: {
        ...client, serviceId, professionalId, whatsappOptIn, startsAt: `${date}T${time}:00`,
      } });
      setMessage(result.message);
      setManagementToken(result.managementToken || "");
      setTime("");
      setClient({ name: "", phone: "" });
      setWhatsappOptIn(false);
    } catch (reason) { setTime(""); setError(reason.message); } finally { setLoading(false); }
  };
  if (!data && !error) return <div className="public-page"><Loading /></div>;
  if (error && !data) return <div className="public-page"><div className="public-booking-card"><img className="public-logo" src="/assets/simplifica-perfil.svg" alt="Simplifica Agenda"/><h1>Não encontramos esse estabelecimento</h1><p>{error}</p><p>Confira o link recebido do estabelecimento.</p></div></div>;
  return <main className="public-page">
    <header className="public-topbar"><div className="public-brand"><img src="/assets/simplifica-perfil.svg" alt=""/>Simplifica <span>Agenda</span></div><span>Agendamento online</span></header>
    <section className="public-booking-card">
      <div className="public-business"><img className="public-business-logo" src={data.business.logoUrl || "/assets/simplifica-perfil.svg"} alt={`Logo de ${data.business.businessName}`}/>
        <div><p className="eyebrow">AGENDE SEU HORÁRIO</p><h1>{data.business.businessName}</h1>{data.business.address && <p>{data.business.address}</p>}
          {data.business.whatsapp && <a className="text-link" target="_blank" rel="noreferrer"
            href={whatsappUrl(data.business.whatsapp, "Olá! Gostaria de tirar uma dúvida sobre um agendamento.")}>
            <Phone size={14}/> WhatsApp do estabelecimento</a>}</div>
      </div>
      {slug === "studio-bela-vista" && <p className="public-demo-notice"><Info size={16}/> Esta página é demonstrativa. Reservas reais permanecem desativadas.</p>}
      {message ? <div className="booking-success" role="status"><span><Check size={25} /></span><h2>Horário solicitado!</h2><p>{message}</p>
          {managementToken && <><p>Guarde seu comprovante para consultar, remarcar ou cancelar dentro das regras do estabelecimento.</p>
            <Link to={`/acompanhar/${managementToken}`} className="button button-primary">Ver meu comprovante</Link>
            <Button variant="secondary" onClick={()=>navigator.clipboard.writeText(window.location.origin+`/acompanhar/${managementToken}`)}>Copiar link do comprovante</Button>
          </>}
          <Button variant="secondary" onClick={() => {setMessage("");setManagementToken("");}}>Fazer outro agendamento</Button></div> :
        <form className="public-form" onSubmit={submit}>
          <div className="booking-step"><span>1</span><b>Qual serviço você deseja?</b></div>
          <div className="public-service-grid">{data.services.map((item) => <button key={item.id} type="button" aria-pressed={serviceId === item.id} onClick={() => { setServiceId(item.id); setProfessionalId(""); setTime(""); }}
            className={`public-service-card ${serviceId === item.id ? "public-service-selected" : ""}`}><span className="shortcut-icon blue"><Scissors size={18} /></span><span><b>{item.name}</b><small>{item.durationMinutes} min · {money(item.priceCents)}</small></span>{serviceId === item.id && <Check size={16} className="text-blue-600" />}</button>)}</div>
          {!data.services.length && <p className="public-empty-note">Este estabelecimento ainda não possui serviços ativos cadastrados.</p>}
          <div className="booking-step"><span>2</span><b>Escolha profissional e data</b></div>
          <div className="form-grid">
            <SelectField label="Profissional" disabled={!serviceId} required value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Selecione o profissional</option>{professionals.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
            </SelectField>
            <Field label="Data" type="date" min={localDate()} required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {!professionals.length && <p className="public-empty-note">Nenhum profissional ativo está disponível neste estabelecimento.</p>}
          <div className="booking-step"><span>3</span><b>Horários disponíveis</b></div>
          {serviceId && professionalId ? loadingSlots
            ? <p className="public-empty-note" aria-live="polite">Consultando horários disponíveis...</p>
            : <div className="slot-grid">{slots.length ? slots.map((slot) => <button type="button" aria-pressed={time === slot} className={`slot-button ${time === slot ? "slot-selected" : ""}`} onClick={() => setTime(slot)} key={slot}>{slot}</button>)
            : <p className="public-empty-note">Não há horários disponíveis nesta data. Experimente outro dia.</p>}</div>
            : <p className="public-empty-note">Selecione um serviço e um profissional para consultar horários.</p>}
          <div className="booking-step"><span>4</span><b>Seus dados para confirmação</b></div>
          <div className="form-grid"><Field label="Seu nome" required maxLength={120} autoComplete="name" value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
            <Field label="WhatsApp com DDD" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required placeholder="(85) 99999-9999" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} /></div>
          {service && professional && time && <div className="public-booking-summary"><b>Confira seu pedido</b>
            <span>{service.name} com {professional.name}</span><span>{dateLabel(date)} às {time} · {money(service.priceCents)}</span></div>}
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <Button className="public-submit" disabled={loading || loadingSlots || !time || !serviceId || !professionalId || !client.name.trim() || !client.phone.trim()}>{loading ? "Solicitando..." : "Solicitar agendamento"}</Button>
          <label className="choice-option"><input type="checkbox" checked={whatsappOptIn}
            onChange={e=>setWhatsappOptIn(e.target.checked)}/>
            Aceito receber avisos desta reserva por WhatsApp. O agendamento funciona mesmo sem esta autorização.
          </label>
          <p className="public-privacy"><ShieldCheck size={14} /> Seus dados são utilizados para organizar o atendimento e permitir contato do estabelecimento.</p>
        </form>}
    </section>
    <footer className="public-footer">Agendamento simples, do início ao fim. <span>Feito com carinho por Simplifica</span></footer>
  </main>;
}

function OnlineRequestsPage() {
  const [items,setItems]=useState([]);
  const [filter,setFilter]=useState("agendado");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState(null);
  const refresh=useCallback(()=>api("/requests")
    .then(result=>{setItems(result.requests);setError("");})
    .catch(e=>setError(e.message)),[]);
  useEffect(()=>{refresh();},[refresh]);
  const act=async(item,action)=>{
    const description=action==="confirm"?"confirmar":"recusar";
    if(!window.confirm(`Deseja ${description} a solicitação de ${item.clientName}?`))return;
    setBusy(item.id);setError("");
    try{
      const result=await api(`/requests/${item.id}`,{method:"PATCH",body:{action}});
      await refresh();
      if(result.whatsappState!=="submitted" && item.clientPhone)
        setNotice({...item,status:result.status});
    }
    catch(e){setError(e.message);}finally{setBusy("");}
  };
  const visible=items.filter(item=>filter==="all" || item.status===filter);
  return <>
    <PageTitle eyebrow="CENTRAL DE AGENDAMENTOS" title="Solicitações online"
      description="Confirme ou recuse pedidos e abra um aviso pronto para envio manual pelo WhatsApp. A confirmação não envia mensagens sozinha." />
    <div className="booking-queue-tools">
      <SelectField label="Situação" value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="agendado">Aguardando confirmação</option><option value="confirmado">Confirmados</option>
        <option value="cancelado">Cancelados ou recusados</option><option value="all">Todos</option>
      </SelectField>
      <Button type="button" variant="secondary" onClick={refresh}><Search size={15}/> Atualizar lista</Button>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="panel management-panel">
      <div className="panel-heading"><div><p className="eyebrow">PEDIDOS RECEBIDOS</p>
        <h2>{filter==="agendado"?"Aguardando confirmação":"Histórico de solicitações"}</h2></div>
        <span className="count-chip">{visible.length}</span></div>
      {visible.length? <div className="management-list">{visible.map(item=>
        <article className="service-row request-item" key={item.id}>
          <span className="service-row-icon"><CalendarDays size={19}/></span>
          <div className="min-w-0 flex-1"><b>{item.clientName} · {item.serviceName}</b>
            <small>{dateTimeLabel(item.startsAt)} · {item.professionalName}</small>
            <small>WhatsApp: {item.clientPhone} · {statusNames[item.status]||item.status}</small>
          </div>
          {item.status==="agendado"&&<>
            <Button disabled={busy===item.id} onClick={()=>act(item,"confirm")}>Confirmar</Button>
            <Button variant="secondary" disabled={busy===item.id} onClick={()=>act(item,"reject")}>Recusar</Button>
          </>}
          {item.clientPhone && <button type="button" className="button button-secondary" onClick={()=>{
            const state=item.status==="confirmado"?"CONFIRMADO ✅":item.status==="cancelado"?"CANCELADO ❌":"AGUARDANDO CONFIRMAÇÃO ⏳";
            const message=`Olá, ${item.clientName}! Aqui é ${item.businessName}. Seu agendamento de ${item.serviceName}, com ${item.professionalName}, em ${dateTimeLabel(item.startsAt)}, está: ${state}. Em caso de dúvidas, responda por aqui.`;
            window.open(whatsappUrl(item.clientPhone,message),"_blank","noopener,noreferrer");
            api(`/requests/${item.id}/whatsapp-opened`,{method:"POST",body:{status:item.status}})
              .then(refresh).catch(e=>setError(e.message));
          }}><Phone size={16}/> Abrir WhatsApp ({item.status==="confirmado"?"confirmação":item.status==="cancelado"?"cancelamento":"solicitação"})</button>}
          {item.whatsappDeliveryState==="submitted" && <small>Enviado à API do WhatsApp — entrega ainda não verificada</small>}
          {item.whatsappDeliveryState==="failed" && <small>Envio automático não concluído — envie manualmente</small>}
          {item.whatsappOpenedAt && <small>Conversa aberta anteriormente — envio manual não verificado</small>}
        </article>)}</div>:
        <EmptyState icon={ClipboardCheck} title="Nenhuma solicitação nesta situação"
          description="Pedidos de clientes pelo link público aparecerão aqui." />}
    </section>
    {notice && <Modal title="Avisar cliente pelo WhatsApp" onClose={()=>setNotice(null)}>
      <div className="form-stack">
        <p className="booking-share-notice"><Info size={16}/> O agendamento foi
          {notice.status==="confirmado"?" confirmado":" recusado"} no sistema.
          Para avisar o cliente sem API oficial configurada, é necessário enviar a mensagem no WhatsApp.</p>
        <p className="panel-subtitle">Uma conversa aberta não significa que a mensagem foi enviada.</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={()=>setNotice(null)}>Avisar depois</Button>
          <Button onClick={()=>{
            const state=notice.status==="confirmado"?"CONFIRMADO ✅":"CANCELADO ❌";
            const txt=`Olá, ${notice.clientName}! Aqui é ${notice.businessName}. Seu agendamento de ${notice.serviceName}, com ${notice.professionalName}, em ${dateTimeLabel(notice.startsAt)}, está: ${state}.`;
            window.open(whatsappUrl(notice.clientPhone,txt),"_blank","noopener,noreferrer");
            api(`/requests/${notice.id}/whatsapp-opened`,{method:"POST",body:{status:notice.status}})
              .then(refresh).catch(e=>setError(e.message));
            setNotice(null);
          }}><Phone size={16}/> Abrir WhatsApp para enviar</Button>
        </div>
      </div>
    </Modal>}
  </>;
}
function PublicRequestPage({ token }) {
  const [info,setInfo]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [date,setDate]=useState(shiftDate(localDate(),1));
  const [slots,setSlots]=useState([]);
  const [slot,setSlot]=useState("");
  const [loadingSlots,setLoadingSlots]=useState(false);
  const refresh=useCallback(()=>api(`/public/manage/${encodeURIComponent(token)}`)
    .then(result=>{setInfo(result.appointment);setError("");}).catch(e=>setError(e.message)),[token]);
  useEffect(()=>{refresh();},[refresh]);
  useEffect(()=>{
    if(!info?.canManage)return;
    let active=true;setLoadingSlots(true);setSlot("");
    api(`/public/${encodeURIComponent(info.slug)}/slots?serviceId=${encodeURIComponent(info.serviceId)}&professionalId=${encodeURIComponent(info.professionalId)}&date=${date}`)
      .then(result=>{if(active)setSlots(result.slots||[]);})
      .catch(e=>{if(active)setError(e.message);})
      .finally(()=>{if(active)setLoadingSlots(false);});
    return()=>{active=false;};
  },[info?.slug,info?.serviceId,info?.professionalId,info?.canManage,date]);
  const perform=async(action)=>{
    if(action==="cancel"&&!window.confirm("Confirma que deseja cancelar este horário?"))return;
    if(action==="reschedule"&&!slot)return;
    setBusy(true);setError("");
    try {
      await api(`/public/manage/${encodeURIComponent(token)}/${action}`,{
        method:"POST",body:action==="reschedule"?{startsAt:`${date}T${slot}:00`}:{},
      });
      await refresh();
    } catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <main className="public-page"><header className="public-topbar"><div className="public-brand">
    <img src="/assets/simplifica-perfil.svg" alt=""/>Simplifica <span>Agenda</span></div><span>Meu agendamento</span></header>
    <section className="public-booking-card public-manage">
      {!info ? <ErrorMessage>{error||"Consultando agendamento..."}</ErrorMessage> : <>
        <div className="booking-success public-receipt" role="status">
          <span><ClipboardCheck size={26}/></span><p className="eyebrow">COMPROVANTE DIGITAL DE SOLICITAÇÃO</p>
          <h2>{info.businessName}</h2><p>Protocolo: <strong>{info.protocol}</strong></p>
          <div className="public-booking-summary">
            <b>{info.status==="agendado"?"Aguardando confirmação":statusNames[info.status]||info.status}</b>
            <span>Cliente: {info.clientName}</span>
            <span>{info.serviceName} · {info.professionalName}</span>
            <span>{dateTimeLabel(info.startsAt)} · {money(info.priceCents)}</span>
          </div>
          <p>{info.status==="agendado"?"Sua solicitação ainda aguarda confirmação do estabelecimento.":info.status==="confirmado"?"Seu horário foi confirmado pelo estabelecimento.":info.status==="cancelado"?"Esta solicitação foi cancelada.":"Consulte o estabelecimento em caso de dúvidas."}</p>
          <div className="booking-share-actions">
            <Button variant="secondary" onClick={refresh}><ArrowRight size={15}/> Atualizar situação</Button>
            <Button variant="secondary" onClick={()=>window.print()}><Download size={15}/> Imprimir / salvar comprovante</Button>
          </div>
        </div>
        {info.canManage && <div className="public-reschedule">
          <h3>Remarcar atendimento</h3><p>Escolha uma nova data e um dos horários livres.</p>
          <Field label="Nova data" type="date" min={localDate()} value={date} onChange={e=>setDate(e.target.value)}/>
          <div className="slot-grid">{loadingSlots?<p>Consultando horários...</p>:slots.length?slots.map(t=>
            <button type="button" key={t} aria-pressed={slot===t}
              className={`slot-button ${slot===t?"slot-selected":""}`} onClick={()=>setSlot(t)}>{t}</button>)
            :<p>Nenhum horário livre para esta data.</p>}</div>
          <div className="booking-share-actions">
            <Button disabled={busy||!slot} onClick={()=>perform("reschedule")}>Solicitar remarcação</Button>
            <Button variant="secondary" disabled={busy} onClick={()=>perform("cancel")}>Cancelar atendimento</Button>
          </div>
        </div>}
        <ErrorMessage>{error}</ErrorMessage>
      </>}
    </section>
  </main>;
}

function CommissionPoliciesPage() {
  const [data,setData]=useState({services:[],professionals:[],rules:[]});
  const [pro,setPro]=useState(""),[service,setService]=useState("");
  const [percent,setPercent]=useState("70"),[retention,setRetention]=useState("0");
  const [error,setError]=useState(""),[message,setMessage]=useState("");
  const refresh=useCallback(async()=>{
    try{
      const [srv,team,rules]=await Promise.all([api("/services"),api("/professionals"),api("/commission-rules")]);
      setData({services:srv.services,professionals:team.professionals.filter(x=>x.role==="profissional"&&x.active),rules:rules.rules});
    }catch(e){setError(e.message);}
  },[]);
  useEffect(()=>{refresh();},[refresh]);
  const save=async e=>{
    e.preventDefault();setError("");setMessage("");
    try{await api("/commission-rules",{method:"PUT",body:{
      professionalId:pro,serviceId:service,commissionPercent:Number(percent),houseSharePercent:Number(retention),
    }});setMessage("Regra salva para futuros agendamentos.");await refresh();}
    catch(e){setError(e.message);}
  };
  const remove=async rule=>{
    if(!window.confirm("Remover esta regra? Novos agendamentos usarão a comissão padrão do serviço ou profissional."))return;
    try{await api("/commission-rules",{method:"DELETE",body:{professionalId:rule.professionalId,serviceId:rule.serviceId}});await refresh();}
    catch(e){setError(e.message);}
  };
  return <>
    <PageTitle eyebrow="POLÍTICAS DE REPASSE" title="Comissões por profissional e serviço"
      description="Personalize a divisão de cada serviço para cada profissional, inclusive repasse integral."/>
    <form className="panel management-panel settings-single-section" onSubmit={save}>
      <div className="panel-heading"><div><h2>Nova regra personalizada</h2>
        <p className="panel-subtitle">Tem prioridade sobre a taxa do serviço e a comissão padrão do profissional. Não altera agendamentos já registrados.</p></div></div>
      <div className="form-grid">
        <SelectField label="Profissional" value={pro} required onChange={e=>setPro(e.target.value)}>
          <option value="">Selecione</option>{data.professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <SelectField label="Serviço" value={service} required onChange={e=>setService(e.target.value)}>
          <option value="">Selecione</option>{data.services.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <Field label="Repasse do serviço ao profissional (%)" type="number" min="0" max="100" step="0.5"
          value={percent} onChange={e=>setPercent(e.target.value)}/>
        <Field label="Retenção adicional de materiais (pontos %)" type="number" min="0" max="100" step="0.5"
          value={retention} onChange={e=>setRetention(e.target.value)}/>
      </div>
      <p className="panel-subtitle">Repasse efetivo: {Math.max(0,Number(percent)-Number(retention))}% do valor do serviço.
        Para repasse integral, use 100% e retenção 0%.</p>
      <ErrorMessage>{error}</ErrorMessage>{message&&<p className="success-message">{message}</p>}
      <div className="modal-actions"><Button>Salvar regra</Button></div>
    </form>
    <section className="panel management-panel">
      <div className="panel-heading"><div><h2>Regras cadastradas</h2>
        <p className="panel-subtitle">Exceções aplicáveis somente aos próximos atendimentos.</p></div></div>
      {data.rules.length?<div className="management-list">{data.rules.map(rule=>
        <article className="service-row request-item" key={rule.professionalId+"-"+rule.serviceId}>
          <span className="service-row-icon"><CircleDollarSign size={18}/></span>
          <div className="min-w-0 flex-1"><b>{rule.professionalName} · {rule.serviceName}</b>
            <small>{rule.commissionPercent}% de repasse bruto · {rule.houseSharePercent}% de retenção</small></div>
          <strong>{Math.max(0,rule.commissionPercent-rule.houseSharePercent)}% líquido</strong>
          <Button variant="secondary" type="button" onClick={()=>remove(rule)}>Remover</Button>
        </article>)}</div>:<EmptyState icon={Wallet} title="Nenhuma regra especial"
          description="Os agendamentos usam a configuração padrão enquanto não houver exceção."/>}
    </section>
  </>;
}

function SettlementsPage() {
  const today = localDate().slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [half, setHalf] = useState(Number(today.slice(8, 10)) <= 15 ? "1" : "2");
  const period = `${month}-${half}`;
  const [data, setData] = useState({ professionals: [], batches: [] });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const refresh = useCallback(() => api(`/settlements?period=${encodeURIComponent(period)}`)
    .then(result => { setData(result); setError(""); }).catch(err => setError(err.message)), [period]);
  useEffect(() => { refresh(); }, [refresh]);
  const close = async professional => {
    if (!window.confirm(`Confirma que o valor de ${money(professional.dueCents)} JÁ FOI REALMENTE TRANSFERIDO para ${professional.professionalName}? Esta ação registra pagamento efetivo e não realiza PIX.`)) return;
    setBusy(professional.professionalId); setError(""); setMessage("");
    try {
      const result = await api("/settlements", {method:"POST", body:{period,professionalId:professional.professionalId}});
      setMessage(`Repasse confirmado: ${money(result.batch.totalCents)} para ${professional.professionalName}.`);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  };
  const due = data.professionals.reduce((sum, item) => sum + item.dueCents, 0);
  const earned = data.professionals.reduce((sum, item) => sum + item.earnedCents, 0);
  const legacy = data.professionals.reduce((sum, item) => sum + item.legacyUnverified, 0);
  const ended = Boolean(data.end && data.end < today);
  return <>
    <PageTitle eyebrow="GESTÃO FINANCEIRA" title="Saldos e repasses quinzenais"
      description="A empresa recebe os pagamentos dos clientes; a conclusão do serviço gera saldo para o profissional, mas não efetua repasse."/>
    <div className="booking-queue-tools">
      <div className="month-filter"><label>Mês</label><input type="month" className="input month-input" value={month} onChange={event => setMonth(event.target.value)}/></div>
      <div className="month-filter"><label>Quinzena</label><select className="input" value={half} onChange={event => setHalf(event.target.value)}>
        <option value="1">1ª quinzena (01–15)</option><option value="2">2ª quinzena (16–último dia)</option>
      </select></div>
      <a className="button button-secondary" href={`/api/settlements/export.csv?period=${encodeURIComponent(period)}`}>
        <Download size={16}/> Exportar saldos CSV
      </a>
    </div>
    <section className="stats-grid finance-stats">
      <StatCard title="Saldo a pagar" value={money(due)} icon={Wallet} tone="orange" note="Crédito dos profissionais ainda não repassado"/>
      <StatCard title="Comissões geradas" value={money(earned)} icon={CircleDollarSign} note="Serviços concluídos na quinzena"/>
    </section>
    <ErrorMessage>{error}</ErrorMessage>
    {message && <p className="success-message">{message}</p>}
    {legacy > 0 && <p className="panel-subtitle">Existem {legacy} lançamento(s) antigos marcados como pagos, mas sem confirmação de transferência. Eles permanecem como saldo pendente para conferência.</p>}
    <section className="panel management-panel">
      <div className="panel-heading"><div><h2>Saldo por profissional</h2>
        <p className="panel-subtitle">Período: {data.start || "—"} até {data.end || "—"}. Confirme o repasse apenas quando o pagamento tiver acontecido fora do sistema.</p></div></div>
      {data.professionals.length ? <div className="management-list">{data.professionals.map(pro =>
        <article className="service-row request-item" key={pro.professionalId}>
          <span className="service-row-icon"><Wallet size={18}/></span>
          <div className="min-w-0 flex-1"><b>{pro.professionalName}</b>
            <small>{pro.completed} serviço(s) · recebido pela empresa {money(pro.grossCents)} · comissão gerada {money(pro.earnedCents)} · repassado confirmado {money(pro.paidCents)}</small>
          </div>
          <strong>{money(pro.dueCents)} a receber</strong>
          {pro.pendingServices > 0 && <Button disabled={busy === pro.professionalId || !ended}
            onClick={() => close(pro)}>{busy === pro.professionalId ? "Registrando..." : "Confirmar repasse"}</Button>}
        </article>)}</div> : <EmptyState icon={Wallet} title="Nenhum serviço concluído" description="Os saldos dos serviços concluídos na quinzena aparecerão aqui."/>}
      {!ended && <p className="panel-subtitle">A quinzena ainda não terminou. O saldo pode ser consultado, mas o pagamento só poderá ser confirmado após o encerramento do período.</p>}
    </section>
    <section className="panel management-panel">
      <div className="panel-heading"><div><h2>Histórico de repasses confirmados</h2></div></div>
      {data.batches.length ? <div className="management-list">{data.batches.map(batch =>
        <article className="service-row" key={batch.id}><CheckCheck size={18}/>
          <span className="min-w-0 flex-1"><b>{batch.professionalName}</b><small>{batch.paidAt} · protocolo {batch.id.slice(0, 8)}</small></span>
          <strong>{money(batch.totalCents)}</strong></article>)}</div> :
        <p className="panel-subtitle">Nenhum repasse confirmado nesta quinzena.</p>}
    </section>
  </>;
}

function SaasAdminPage() {
  const [key,setKey]=useState("");
  const [connected,setConnected]=useState(false);
  const [businesses,setBusinesses]=useState([]);
  const [values,setValues]=useState({businessName:"",slug:"",ownerName:"",ownerEmail:"",plan:"comercial"});
  const [issued,setIssued]=useState(null);
  const [editing,setEditing]=useState(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const call=useCallback(async(path,method="GET",body)=>{
    const response=await fetch("/api/saas"+path,{
      method,headers:{"X-Saas-Admin-Key":key,...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),credentials:"same-origin",
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Falha na Central SaaS.");
    return data;
  },[key]);
  const refresh=useCallback(async()=>{
    const result=await call("/businesses");setBusinesses(result.businesses);setConnected(true);
  },[call]);
  const connect=async e=>{e.preventDefault();setError("");
    try{await refresh();}catch(e){setError(e.message);}
  };
  const create=async e=>{
    e.preventDefault();setBusy(true);setError("");
    try{
      const result=await call("/businesses","POST",values);
      setIssued(result);
      setValues({businessName:"",slug:"",ownerName:"",ownerEmail:"",plan:"comercial"});
      await refresh();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const change=async(item,status)=>{
    if(!window.confirm(`Deseja ${status==="suspended"?"suspender":"reativar"} ${item.name}?`))return;
    setBusy(true);setError("");
    try{await call(`/businesses/${item.id}`,"PATCH",{
      plan:item.plan,status,notes:item.notes||"",dueDate:item.dueDate||null,
    });await refresh();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <main className="saas-admin-page">
    <div className="saas-admin-header"><div className="public-brand"><img src="/assets/simplifica-perfil.svg" alt=""/> Simplifica <span>Admin</span></div>
      <a className="button button-secondary" href="/">Voltar ao sistema</a></div>
    <div className="saas-admin-content">
      <PageTitle eyebrow="ÁREA RESTRITA DO OPERADOR" title="Central SaaS"
        description="Cadastre clientes comerciais e administre planos e acessos. A chave não é armazenada pelo navegador."/>
      {!connected?<form className="panel management-panel saas-admin-login" onSubmit={connect}>
        <Field label="Chave de acesso da plataforma" type="password" required autoComplete="off" value={key}
          onChange={e=>setKey(e.target.value)} placeholder="Chave SAAS_ADMIN_KEY do servidor"/>
        <ErrorMessage>{error}</ErrorMessage><Button>Acessar Central SaaS</Button>
        <p className="panel-subtitle">Configure SAAS_ADMIN_KEY no arquivo .env do servidor. Use somente em HTTPS fora do localhost.</p>
      </form>:<>
        <div className="saas-admin-top-actions"><Button variant="secondary" type="button" onClick={()=>{
          setConnected(false);setKey("");setIssued(null);setBusinesses([]);
        }}>Encerrar acesso à central</Button></div>
        <section className="panel management-panel">
          <div className="panel-heading"><div><h2>Cadastrar novo estabelecimento</h2>
            <p className="panel-subtitle">O cliente receberá acesso comercial, sem interferir no ambiente de demonstração.</p></div></div>
          <form className="form-stack" onSubmit={create}>
            <div className="form-grid">
              <Field label="Nome do estabelecimento" required maxLength={120} value={values.businessName}
                onChange={e=>setValues(v=>({...v,businessName:e.target.value}))}/>
              <Field label="Identificador do link (sem espaços)" required maxLength={80} placeholder="ex: studio-maria"
                value={values.slug} onChange={e=>setValues(v=>({...v,slug:e.target.value.toLowerCase()}))}/>
              <Field label="Nome do proprietário" required maxLength={120} value={values.ownerName}
                onChange={e=>setValues(v=>({...v,ownerName:e.target.value}))}/>
              <Field label="E-mail de login do proprietário" type="email" required value={values.ownerEmail}
                onChange={e=>setValues(v=>({...v,ownerEmail:e.target.value}))}/>
              <SelectField label="Plano" value={values.plan} onChange={e=>setValues(v=>({...v,plan:e.target.value}))}>
                <option value="comercial">Comercial</option><option value="profissional">Profissional</option>
                <option value="premium">Premium</option>
              </SelectField>
            </div>
            <ErrorMessage>{error}</ErrorMessage><Button disabled={busy}>{busy?"Criando...":"Cadastrar comércio e gerar acesso"}</Button>
          </form>
        </section>
        {issued&&<section className="panel management-panel saas-secret">
          <h2>Acesso criado — entregue a senha uma única vez</h2>
          <p className="panel-subtitle">O sistema não envia credenciais automaticamente. Copie e repasse ao proprietário por canal seguro.</p>
          <Field label="E-mail" value={issued.business.ownerEmail} readOnly/>
          <Field label="Senha temporária (não será exibida novamente)" value={issued.temporaryPassword} readOnly/>
          <div className="booking-share-actions">
            <Button variant="secondary" type="button" onClick={()=>navigator.clipboard.writeText(
              `Comércio: ${issued.business.name}\nE-mail: ${issued.business.ownerEmail}\nSenha temporária: ${issued.temporaryPassword}\nIdentificador: ${issued.business.slug}\nAltere a senha após acessar.`
            )}>Copiar instruções</Button>
            <Button type="button" onClick={()=>setIssued(null)}>Entreguei com segurança</Button>
          </div>
        </section>}
        <section className="panel management-panel"><div className="panel-heading"><div>
          <h2>Estabelecimentos cadastrados</h2><p className="panel-subtitle">Status do acesso e plano de cada empresa.</p></div>
          <span className="count-chip">{businesses.length}</span></div>
          <div className="management-list">{businesses.map(item=>
            <article key={item.id} className="service-row request-item">
              <span className="service-row-icon"><ShieldCheck size={18}/></span>
              <div className="min-w-0 flex-1"><b>{item.name}</b>
                <small>{item.ownerName} · {item.ownerEmail}</small>
                <small>{item.slug} · {item.plan} · {item.status==="suspended"?"Suspenso":"Ativo"}</small></div>
              {item.slug!=="studio-bela-vista"&&<>
                <Button type="button" variant="secondary" onClick={()=>setEditing({...item})}>Editar plano</Button>
                <Button type="button" variant="secondary" disabled={busy}
                  onClick={()=>change(item,item.status==="suspended"?"active":"suspended")}>
                  {item.status==="suspended"?"Reativar":"Suspender"}
                </Button></>}
            </article>)}</div>
        </section>
        {editing&&<Modal title={`Plano de ${editing.name}`} onClose={()=>setEditing(null)}>
          <form className="form-stack" onSubmit={async e=>{
            e.preventDefault();setBusy(true);setError("");
            try{
              await call(`/businesses/${editing.id}`,"PATCH",{
                plan:editing.plan,status:editing.status,notes:editing.notes||"",dueDate:editing.dueDate||null,
              });
              setEditing(null);await refresh();
            }catch(err){setError(err.message);}finally{setBusy(false);}
          }}>
            <SelectField label="Plano" value={editing.plan}
              onChange={e=>setEditing(v=>({...v,plan:e.target.value}))}>
              <option value="comercial">Comercial</option><option value="profissional">Profissional</option><option value="premium">Premium</option>
            </SelectField>
            <Field label="Vencimento (registro administrativo)" type="date" value={editing.dueDate||""}
              onChange={e=>setEditing(v=>({...v,dueDate:e.target.value}))}/>
            <Field label="Observações contratuais">
              <textarea className="input" rows={3} maxLength={300} value={editing.notes||""}
                onChange={e=>setEditing(v=>({...v,notes:e.target.value}))}/>
            </Field>
            <p className="panel-subtitle">O vencimento é apenas informativo nesta fase. Não existe cobrança automática.</p>
            <ErrorMessage>{error}</ErrorMessage>
            <div className="modal-actions"><Button type="button" variant="secondary"
              onClick={()=>setEditing(null)}>Cancelar</Button><Button disabled={busy}>Salvar</Button></div>
          </form>
        </Modal>}
      </>}
    </div>
  </main>;
}
function AccessDenied() {
  return <div className="panel"><EmptyState icon={ShieldCheck} title="Acesso restrito"
    description="Esta área está disponível apenas para o perfil de dono." /></div>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [installation, setInstallation] = useState(null);
  const location = useLocation();
  useEffect(() => {
    if (location.pathname.startsWith("/agendar/") || location.pathname.startsWith("/acompanhar/") || location.pathname === "/central-saas") { setLoading(false); return; }
    Promise.all([
      api("/installation/status"),
      api("/auth/me").then(({ user: current }) => current).catch(() => null),
    ]).then(([status, current]) => { setInstallation(status); setUser(current); })
      .catch(() => setUser(null)).finally(() => setLoading(false));
  }, [location.pathname]);
  useEffect(() => {
    api("/settings").then(({ settings }) => document.documentElement.classList.toggle("dark", settings?.theme === "escuro")).catch(() => {});
  }, [user]);
  if (location.pathname.startsWith("/acompanhar/")) {
    const token=decodeURIComponent(location.pathname.slice("/acompanhar/".length).split("/")[0]);
    return <PublicRequestPage token={token}/>;
  }
  if (location.pathname === "/central-saas") return <SaasAdminPage />;
  if (location.pathname.startsWith("/agendar/")) {
    const slug = decodeURIComponent(location.pathname.slice("/agendar/".length).split("/")[0]);
    return <PublicBooking slug={slug} />;
  }
  if (loading) return <div className="app-loading"><img src="/assets/simplifica-perfil.svg" alt="" /><Loading /></div>;
  if (installation?.needsSetup) return <InstallationSetup onReady={() => { setInstallation({ needsSetup: false, demoEnabled: false }); setUser(null); }} />;
  if (!user) return <Login key={String(installation?.demoEnabled)} onLogin={setUser} demoEnabled={installation?.demoEnabled} />;
  const logout = async () => { try { await api("/auth/logout", { method: "POST" }); } finally { setUser(null); } };
  return <Shell user={user} onLogout={logout}>
    <Routes>
      <Route path="/" element={user.role === "recepcao" ? <ReceptionDashboard user={user}/> : <OverviewPage user={user} />} />
      <Route path="/agenda" element={<AgendaPage user={user} />} />
      <Route path="/solicitacoes" element={user.role!=="profissional" ? <OnlineRequestsPage/> : <AccessDenied/>}/>
      <Route path="/clientes" element={<ClientsPage user={user} />} />
      <Route path="/servicos" element={user.role !== "profissional" ? <ServicesPage user={user} section="services" /> : <AccessDenied />} />
      <Route path="/equipe" element={user.role === "dono" && user.tenantId !== "tenant-salao-demo" ? <ServicesPage user={user} section="team" /> : <AccessDenied />} />
      <Route path="/meus-atendimentos" element={user.role === "profissional" ? <ProfessionalWorkPage /> : <AccessDenied />} />
      <Route path="/meus-ganhos" element={user.role === "profissional" ? <ProfessionalEarningsPage/> : <AccessDenied/>}/>
      <Route path="/comissoes" element={user.role === "dono" && user.tenantId !== "tenant-salao-demo" ? <TeamCommissionsPage/> : <AccessDenied/>}/>
      <Route path="/regras-comissao" element={user.role === "dono" && user.tenantId !== "tenant-salao-demo" ? <CommissionPoliciesPage/> : <AccessDenied/>}/>
      <Route path="/fechamentos" element={user.role === "dono" && user.tenantId !== "tenant-salao-demo" ? <SettlementsPage/> : <AccessDenied/>}/>
      <Route path="/compartilhar" element={<BookingSharePage user={user} />} />
      <Route path="/financeiro" element={user.role === "dono" ? <FinancePage /> : <AccessDenied />} />
      <Route path="/recebimentos" element={["dono", "recepcao"].includes(user.role) && user.tenantId !== "tenant-salao-demo" ? <ReceivablesPage user={user} /> : <AccessDenied />} />
      <Route path="/configuracoes" element={user.role === "dono" && user.tenantId !== "tenant-salao-demo" ? <SettingsPage user={user} onUserUpdated={setUser} /> : <AccessDenied />} />
      <Route path="/minha-conta" element={user.tenantId === "tenant-salao-demo" ? <AccessDenied /> :
        user.role === "dono" ? <Navigate to="/configuracoes" replace /> :
        <AccountPage user={user} onUserUpdated={setUser} />} />
      <Route path="*" element={user.role === "recepcao" ? <ReceptionDashboard user={user}/> : <OverviewPage user={user} />} />
    </Routes>
  </Shell>;
}
