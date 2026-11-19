import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck,
  ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Download, ExternalLink, LayoutDashboard,
  LogOut, Menu, Moon, MoreHorizontal, Plus, Search, Settings, ShieldCheck, Sun, Users,
  Wallet, X, Scissors, UserRound, CalendarClock, CalendarX2, Phone, Mail, Sparkles, RefreshCw, List, CalendarRange, Eye, EyeOff,
  Copy, QrCode, Share2, Link2, Smartphone, Info, ClipboardCheck, UserRoundCheck, Upload, Package,
} from "lucide-react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import QRCode from "react-qr-code";

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

const cashTimestamp = (value, timeZone = "America/Sao_Paulo") => new Intl.DateTimeFormat("pt-BR", {
  timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

function confirmAction(message, title = "Confirmar ação") {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const panel = document.createElement("section");
    panel.className = "modal-panel max-w-lg";
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);
    const header = document.createElement("header");
    header.className = "modal-header";
    const heading = document.createElement("h2");
    heading.textContent = title;
    header.appendChild(heading);
    const description = document.createElement("p");
    description.className = "panel-subtitle";
    description.style.whiteSpace = "pre-wrap";
    description.textContent = message;
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button button-secondary";
    cancel.textContent = "Cancelar";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "button button-primary";
    confirm.textContent = "Confirmar";
    actions.append(cancel, confirm);
    const body=document.createElement("div");
    body.className="modal-body confirmation-body";
    body.append(description,actions);
    panel.append(header, body);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    const previousFocus = document.activeElement;
    const finish = accepted => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(accepted);
    };
    const onKey = event => {
      if (event.key === "Escape") finish(false);
      if (event.key === "Tab") {
        event.preventDefault();
        (document.activeElement === cancel ? confirm : cancel).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) finish(false); });
    cancel.focus();
  });
}
function showNotice(message, type = "warning") {
  const notice = document.createElement("div");
  notice.setAttribute("role", "alert");
  notice.style.cssText = "position:fixed;top:24px;right:24px;z-index:10000;max-width:min(420px,calc(100vw - 32px));padding:16px 20px;border-radius:14px;box-shadow:0 16px 40px rgba(15,23,42,.20);font-weight:600;line-height:1.5;background:var(--surface,#fff);color:var(--text,#17253c);border:1px solid #d8e1ed;border-left:5px solid " + (type === "warning" ? "#d97706" : "#2563eb");
  notice.textContent = message;
  document.body.appendChild(notice);
  window.setTimeout(() => notice.remove(), 6500);
}

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
  if (!response.ok) {
    const message = data?.error ?? "Não foi possível concluir a solicitação.";
    if (response.status === 409 && /caixa|abertura|abr[a-z]* o caixa/i.test(message))
      showNotice(message, "warning");
    throw Object.assign(new Error(message), { status: response.status });
  }
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
    <select className="input" aria-label={typeof label==="string"?label:undefined} {...props}>{children}</select>
  </Field>;
}

function Modal({ title, onClose, children, wide = false }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...panel.current.querySelectorAll(
      "button, input, select, textarea, a[href], summary, [tabindex]"
    )].filter((element) => !element.matches(":disabled") && element.tabIndex >= 0 && element.getClientRects().length);
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panel} onKeyDown={handleKeyDown} className={`modal-panel ${wide ? "max-w-2xl" : "max-w-lg"}`} role="dialog" aria-modal="true" aria-label={title}>
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
  const [showPassword,setShowPassword]=useState(false);
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
    <main className="login-page premium-login">
      <section className="login-card">
        <img className="login-logo" src="/assets/simplifica-logo.svg" alt="Simplifica" />
        <div className="login-access-label"><ShieldCheck size={15}/> Acesso ao estabelecimento</div>
        <div className="mb-7">
          <p className="eyebrow">BEM-VINDO DE VOLTA</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Entre na sua conta</h1>
          <p className="mt-2 text-sm text-slate-500">Organize seus horários com mais leveza.</p>
        </div>
        <div className="auth-mode-switch" role="group" aria-label="Tipo de acesso">
          <button type="button" aria-pressed={mode==="email"} className={mode === "email" ? "selected" : ""} onClick={() => { setMode("email"); setActivation(false); setError(""); setShowPassword(false); }}> <LayoutDashboard size={16}/> Administração</button>
          <button type="button" aria-pressed={mode==="staff"} className={mode === "staff" ? "selected" : ""} onClick={() => { setMode("staff"); setError(""); setShowPassword(false); setValues({ ...values, password: "", slug: "" }); }}><UserRound size={16}/> Profissional</button>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {mode === "email" && <Field label="E-mail" type="email" autoComplete="username" required value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })} />}
          {mode === "staff" && <Field label="Código de acesso do profissional (ex.: 001)" inputMode="numeric" pattern="[0-9]{3}" maxLength={3} required value={values.staffCode} onChange={(e) => setValues({ ...values, staffCode: e.target.value.replace(/\D/g, "").slice(0, 3) })}/>}
          <div className="login-password-field"><Field label={activation ? "Escolha sua senha (6 a 8 letras e números)" : "Senha"} type={showPassword?"text":"password"} autoComplete={activation?"new-password":"current-password"} required value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })} minLength={mode === "staff" && activation ? 6 : undefined} maxLength={mode === "staff" && activation ? 8 : undefined} />
            <button type="button" className="login-password-toggle" aria-label={showPassword?"Ocultar senha":"Mostrar senha"} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div>
          {mode === "staff" && activation && <>
            <Field label="Repita a senha" type="password" required minLength={6} maxLength={8} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}/>
            <Field label="Código de ativação fornecido pelo administrador" required value={activationToken} onChange={e => setActivationToken(e.target.value)}/>
          </>}
          {mode === "email" && <Field label="Identificador do negócio (opcional)" placeholder="Ex.: studio-bela-vista"
            value={values.slug} onChange={(e) => setValues({ ...values, slug: e.target.value })} />}
          <ErrorMessage>{error}</ErrorMessage>
          {success && <p className="success-message" role="status">{success}</p>}
          <Button className="w-full justify-center login-submit" type="submit" disabled={loading}>
            {loading ? "Processando..." : activation ? "Ativar minha senha" : "Entrar na minha agenda"} {!loading&&<ArrowRight size={17}/>}
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
        <p className="login-footer">Simplifica Agenda · Sua rotina, mais simples.</p>
      </section>
      <div className="login-decoration">
        <div className="login-decoration-inner">
          <span className="decoration-kicker"><span /> SUA ROTINA, MAIS SIMPLES</span>
          <h2>Mais tempo para<br />cuidar do que importa.</h2>
          <p>Uma agenda organizada deixa seu negócio crescer no seu ritmo.</p>
          <div className="login-feature-grid">
            <div><CalendarDays size={23}/><b>Agenda organizada</b><small>Horários e equipe em um único lugar.</small></div>
            <div><Wallet size={23}/><b>Financeiro claro</b><small>Recebimentos e repasses separados.</small></div>
            <div><Users size={23}/><b>Clientes conectados</b><small>Histórico e reservas online.</small></div>
          </div>
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
    <main className="login-page premium-login">
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
    <section className="panel management-panel premium-account" style={{ maxWidth: embedded ? undefined : 760 }}>
      <div className="account-profile-banner"><span className="profile-avatar">{user.name.slice(0,1).toUpperCase()}</span><div><b>{user.name}</b><small>Perfil: {user.role === "dono" ? "Proprietário" : user.role === "recepcao" ? "Recepção" : "Profissional"}</small></div><ShieldCheck size={23}/></div>
      <div className="panel-heading"><div><h2>Dados e segurança</h2><p className="panel-subtitle">Confira seus dados e altere a senha quando necessário.</p></div></div>
      <form className="form-stack" onSubmit={submit}>
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
  { to: "/estoque", label: "Estoque e produtos", icon: Package },
  { to: "/pacotes", label: "Pacotes e fidelização", icon: Sparkles },
  { to: "/equipe", label: "Equipe e acessos", icon: Users },
  { to: "/meus-atendimentos", label: "Meus atendimentos", icon: ClipboardCheck },
  { to: "/meus-ganhos", label: "Meus ganhos", icon: Wallet },
  { to: "/recebimentos", label: "Gestão financeira", icon: Wallet },
  { to: "/financeiro", label: "Relatórios", icon: Wallet },
  { to: "/compartilhar", label: "Link de agendamento", icon: QrCode },
  { to: "/configuracoes", label: "Configurações do estabelecimento", icon: Settings },
  { to: "/minha-conta", label: "Minha conta", icon: ShieldCheck },
];

function Shell({ user, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("simplifica:sidebar-collapsed") === "true"; } catch { return false; }
  });
  const toggleSidebar = () => setCollapsed(previous => {
    const next = !previous;
    try { localStorage.setItem("simplifica:sidebar-collapsed", String(next)); } catch {}
    return next;
  });
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
    if (user.role === "recepcao") return !["/financeiro", "/configuracoes", "/equipe", "/meus-atendimentos", "/meus-ganhos"].includes(item.to);
    if (isDemo && ["/pacotes", "/estoque", "/recebimentos", "/configuracoes", "/minha-conta", "/equipe", "/meus-atendimentos", "/comissoes", "/meus-ganhos", "/regras-comissao", "/fechamentos"].includes(item.to)) return false;
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
  const mobileRoutes = user.role === "profissional"
    ? ["/", "/agenda", "/meus-atendimentos", "/meus-ganhos", "/clientes"]
    : ["/", "/agenda", "/solicitacoes", "/clientes", "/recebimentos"];
  const mobileItems = mobileRoutes.map((route) => visibleNavItems.find((item) => item.to === route)).filter(Boolean);
  const pageName = location.pathname === "/recebimentos" && user.role === "recepcao"
    ? "Caixa e recebimentos"
    : (visibleNavItems.find((item) => item.to === location.pathname)?.label ?? "Simplifica Agenda");
  return (
    <div className={`app-shell ${collapsed ? "app-shell-collapsed" : ""}`}>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Fechar menu" />}
      <aside id="menu-principal" className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <Link to="/" className="brand-lockup" aria-label="Simplifica Agenda — visão geral" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark"><img src="/assets/simplifica-perfil.svg" alt="" /></span>
          <span className="brand-type"><b>simplifica<span>.</span></b><small>AGENDA INTELIGENTE</small></span>
        </Link>
        <div className="business-switcher">
          <span className="business-avatar">{businessLogo ? <img src={businessLogo} alt="" className="business-logo-img"/> : businessName.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><b>{businessName}</b><small>{user.slug === "studio-bela-vista" ? "Ambiente de demonstração" : "Meu negócio"}</small></span>
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <span className="nav-caption">MENU PRINCIPAL</span>
          {visibleNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)}
              title={to === "/recebimentos" && user.role === "recepcao" ? "Caixa e recebimentos" : label}
              aria-label={to === "/recebimentos" && user.role === "recepcao" ? "Caixa e recebimentos" : label}
              className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{to === "/recebimentos" && user.role === "recepcao" ? "Caixa e recebimentos" : label}</span>
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
          <button className="icon-button mobile-menu-button" onClick={() => setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-controls="menu-principal" aria-label="Menu principal"><Menu size={21} /></button>
          <button type="button" className="icon-button desktop-sidebar-toggle" onClick={toggleSidebar} aria-expanded={!collapsed} aria-controls="menu-principal" aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"} title={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}>{collapsed ? <ChevronRight size={19}/> : <ChevronLeft size={19}/>}</button>
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
          {mobileItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} aria-label={label}
              className={({ isActive }) => `mobile-nav-link ${isActive ? "mobile-nav-active" : ""}`}>
              <Icon size={20} /><span>{{ "/recebimentos": "Caixa", "/meus-atendimentos": "Atender", "/meus-ganhos": "Ganhos" }[to] || label.split(" ")[0]}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function PageTitle({ eyebrow, title, description, actions, actionClassName = "", dashboard = false }) {
  return <div className={`page-title-row ${dashboard ? "dashboard-hero" : ""}`}>
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>
    {actions && <div className={`page-actions ${actionClassName}`.trim()}>{actions}</div>}
  </div>;
}

function StatCard({ title, value, note, icon: Icon, tone = "blue" }) {
  return <article className="stat-card" data-tone={tone}>
    <div className={`stat-icon stat-${tone}`}><Icon size={19} /></div>
    <div className="stat-copy"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>
  </article>;
}

function usePendingPayments(enabled = true) {
  const [pending, setPending] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const version = ++refreshVersion.current;
    try {
      const data = await api("/receivables/pending");
      if (version === refreshVersion.current) {
        setPending(data.receivables);
        setLoaded(true);
        setError("");
      }
    } catch (reason) {
      if (version === refreshVersion.current) setError(reason.message);
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { ++refreshVersion.current; window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [enabled, refresh]);
  return { pending, loaded, error, refresh };
}

const pendingPaymentsPath = "/recebimentos?aba=pendentes";

function PendingPaymentsCard({ user }) {
  const {pending, loaded, error, refresh} = usePendingPayments(user.tenantId !== "tenant-salao-demo");
  const [open, setOpen] = useState(false);
  if (user.tenantId === "tenant-salao-demo") return <StatCard title="Pagamentos pendentes" value="—" note="Disponível na operação comercial" icon={Wallet}/>;
  return <>
    <button type="button" data-tone={pending.length ? "orange" : "green"} className={`stat-card pending-dashboard-card ${pending.length ? "has-pending" : ""}`}
      onClick={() => { setOpen(true); refresh(); }}>
      <div className={`stat-icon stat-${pending.length ? "orange" : "green"}`}><Wallet size={19}/></div>
      <div className="stat-copy"><span>Pagamentos pendentes</span>
        <strong>{loaded ? money(pending.reduce((sum, item) => sum + item.priceCents, 0)) : "—"}</strong>
        <small>{error ? "Consultar pendências" : loaded ? `${pending.length} pagamento(s) em aberto` : "Consultando..."}</small>
      </div>
      <ArrowRight className="pending-card-arrow" size={16}/>
    </button>
    {open && <Modal title="Pagamentos pendentes" onClose={() => setOpen(false)} wide>
      <PendingPaymentsList user={user} pending={pending} loaded={loaded} loadError={error} refresh={refresh}/>
    </Modal>}
  </>;
}

function AppointmentCard({ appointment, onOpen, compact = false }) {
  const message = `Olá, ${appointment.clientName}! Passando para confirmar seu horário de ${appointment.serviceName} no dia ${dateTimeLabel(appointment.startsAt)} com ${appointment.professionalName}. Podemos confirmar?`;
  const whatsapp = appointment.bookingSource !== "public" || appointment.whatsappOptIn
    ? whatsappUrl(appointment.clientPhone, message) : "";
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


function CashStatusBanner({ user }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!["dono", "recepcao"].includes(user.role) || user.tenantId === "tenant-salao-demo") return;
    let active = true;
    api("/cash/daily").then(data => {if (active) setState(data.cashState);}).catch(() => {});
    return () => {active = false;};
  }, [user.role, user.tenantId]);
  if (!state || state === "open") return null;
  return <section className="panel dashboard-cash-status" role="status">
    <div className="dashboard-cash-content">
      <div className="dashboard-cash-copy">
        <strong>{state === "closed" ? "Caixa do dia encerrado" : "Caixa ainda não aberto"}</strong>
        <p className="panel-subtitle" style={{marginTop:5}}>
          {state === "closed"
            ? "O caixa deste dia já foi fechado. Novas movimentações serão liberadas somente após a abertura do próximo dia."
            : "Para concluir serviços e receber pagamentos, registre primeiro a abertura do caixa de hoje."}
        </p>
      </div>
      <div className="dashboard-cash-action"><Link className="button button-primary dashboard-action-button" to="/recebimentos">
        <Wallet size={16}/> {state === "closed" ? "Consultar caixa" : "Abrir caixa"}
      </Link></div>
    </div>
  </section>;
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
    <PageTitle dashboard actionClassName="dashboard-top-actions" eyebrow="CENTRAL DE ATENDIMENTO" title={`Bom trabalho, ${user.name.split(" ")[0]} 👋`}
      description="Acompanhe os horários, confirme solicitações e organize o atendimento ao cliente."
      actions={<Link className="button button-primary dashboard-action-button" to="/solicitacoes"><ClipboardCheck size={16}/> Solicitações online</Link>}/>
    <ErrorMessage>{error}</ErrorMessage>
    <CashStatusBanner user={user}/>
    <section className="stats-grid">
      <PendingPaymentsCard user={user}/>
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
        <div className="panel-heading"><div><p className="eyebrow">ATENDIMENTO RÁPIDO</p><h2>Atalhos da recepção</h2></div></div>
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
  if (!data && !error) return <div className="dashboard-skeleton" aria-busy="true" aria-label="Carregando visão geral"><div/><section>{Array.from({length:4},(_,i)=><div key={i}/>)}</section><div/></div>;
  return <>
    <PageTitle dashboard actionClassName={user.role === "dono" ? "dashboard-top-actions" : ""} eyebrow={`${user.role === "profissional" ? "MINHA ROTINA" : "RESUMO DO NEGÓCIO"} · ${dateLabel(localDate(), { weekday: "long" }).toUpperCase()}`} title={`Olá, ${user.name.split(" ")[0]} 👋`}
      description={user.role === "profissional" ? "Seus horários, serviços concluídos e comissões em um só lugar." : "Aqui está um resumo do seu negócio. Tenha um ótimo dia!"}
      actions={<Button className={user.role === "dono" ? "dashboard-action-button" : ""} onClick={() => navigate(user.role === "profissional" ? "/meus-atendimentos" : "/agenda")}>
        <CalendarDays size={17} /> {user.role === "profissional" ? "Meus atendimentos" : "Ver agenda"}
      </Button>} />
    <ErrorMessage>{error}</ErrorMessage>
    {user.role === "dono" && <CashStatusBanner user={user}/>}
    <section className="stats-grid">
      {user.role === "profissional" ? <>
        <StatCard title="Atendimentos hoje" value={data?.todayCount ?? "—"} note="Na minha agenda" icon={CalendarDays} />
        <StatCard title="Serviços concluídos hoje" value={data?.completedToday ?? "—"} note="Registrados como realizados" icon={ClipboardCheck} tone="purple" />
        <StatCard title="Bloqueios hoje" value={data?.blockedToday ?? 0} note="Almoço, pausas e compromissos" icon={CalendarX2} tone="green" />
        <StatCard title="Próximo atendimento" value={data?.upcoming?.[0] ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.upcoming[0].startsAt)) : "Livre"}
          note={data?.upcoming?.[0]?.clientName ?? "Sem próximos horários"} icon={Clock3} tone="orange"/>
      </> : <>
        <PendingPaymentsCard user={user}/>
        <StatCard title={user.role === "dono" ? "Clientes pagaram neste mês" : "Agendamentos no mês"}
          value={user.role === "dono" ? money(data?.monthRevenueCents) : data?.monthCount ?? "—"}
          note={user.role === "dono" ? "Total bruto, antes dos repasses" : "Na agenda do negócio"}
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
        <div className="panel-heading"><div><p className="eyebrow">ACESSO RÁPIDO</p><h2>Atalhos de trabalho</h2></div></div>
        <div className="shortcuts">
          <Link to="/agenda" className="shortcut-item"><span className="shortcut-icon blue"><CalendarDays size={18} /></span><span><b>Organizar agenda</b><small>Visualize os horários do dia</small></span><ArrowRight size={15} /></Link>
          {user.role === "profissional" ? <>
            <Link to="/meus-atendimentos" className="shortcut-item"><span className="shortcut-icon violet"><ClipboardCheck size={18}/></span><span><b>Registrar serviços</b><small>Concluir atendimentos realizados</small></span><ArrowRight size={15}/></Link>
            <Link to="/meus-ganhos" className="shortcut-item"><span className="shortcut-icon green"><Wallet size={18}/></span><span><b>Meus ganhos</b><small>Comissões pagas e a receber</small></span><ArrowRight size={15}/></Link>
          </> : <>
          <Link to="/clientes" className="shortcut-item"><span className="shortcut-icon green"><Users size={18} /></span><span><b>Cadastrar cliente</b><small>Guarde os detalhes</small></span><ArrowRight size={15} /></Link>
          <Link to="/servicos" className="shortcut-item"><span className="shortcut-icon violet"><Scissors size={18} /></span><span><b>Gerenciar serviços</b><small>Equipe, preços e duração</small></span><ArrowRight size={15} /></Link>
          {user.role === "dono" && <Link to="/financeiro" className="shortcut-item"><span className="shortcut-icon amber"><Wallet size={18} /></span><span><b>Conferir resultados</b><small>Receitas e comissões</small></span><ArrowRight size={15} /></Link>}</>}
        </div>

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

function AppointmentForm({ onClose, onSaved, initialDate = localDate(), initialHour, initialProfessional = "", user, direct = false }) {
  const isProfessional = user.role === "profissional";
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [values, setValues] = useState({
    clientId: "", serviceId: "", professionalId: isProfessional ? user.id : initialProfessional,
    startsAt: initialHour ? `${initialDate}T${initialHour}` : initialDate === localDate() ? "" : `${initialDate}T09:00`, notes: "", paymentMethod: "",
  });
  const [quickClient, setQuickClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", phone: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [commissionPreview, setCommissionPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    setCommissionPreview(null); setPreviewError("");
    if (!direct || user.role !== "dono" || !values.serviceId || !values.professionalId) return;
    let active = true;
    api(`/commission-preview?serviceId=${encodeURIComponent(values.serviceId)}&professionalId=${encodeURIComponent(values.professionalId)}`)
      .then(result => { if (active) setCommissionPreview({...result, serviceId:values.serviceId, professionalId:values.professionalId}); })
      .catch(reason => { if (active) setPreviewError(reason.message); });
    return () => { active = false; };
  }, [direct,user.role,values.serviceId,values.professionalId]);

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
        const response = await api(isProfessional ? "/booking/clients" : "/clients", { method: "POST", body: newClient });
        clientId = response.client.id;
        setClients(previous => [...previous, response.client]);
        setValues(previous => ({ ...previous, clientId }));
        setQuickClient(false);
      }
      const result = await api(direct ? "/direct-services" : "/appointments", { method: "POST", body: { ...values, clientId } });
      onSaved(direct ? result.completedOn : values.startsAt.slice(0, 10));
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  };
  return <Modal title={direct ? "Registrar serviço" : "Novo agendamento"} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      {direct && <p className="booking-share-notice">Registre um serviço já realizado, sem reservar horário na agenda. A comissão será calculada automaticamente e o recebimento controlado pelo caixa.</p>}
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
            professionalId: isProfessional ? user.id : v.professionalId,
          }))}>
          <option value="">Selecione um serviço</option>
          {services.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.priceCents)}</option>)}
        </SelectField>
        <SelectField label="Profissional" required disabled={isProfessional} value={values.professionalId}
          onChange={event => setValues(v => ({ ...v, professionalId: event.target.value }))}>
          <option value="">Selecione</option>
          {options.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </SelectField>
      </div>
      {!services.length &&
        <p className="booking-share-notice">Não há serviços ativos cadastrados neste estabelecimento. Solicite ao administrador que cadastre ou ative um serviço.</p>}
      {!options.length &&
        <p className="booking-share-notice">Não há profissionais ativos disponíveis no estabelecimento. Solicite ao administrador que verifique a equipe.</p>}
      {!direct && <Field label="Data e horário" type="datetime-local" required value={values.startsAt}
        onChange={event => setValues(v => ({ ...v, startsAt: event.target.value }))}/>}
      {!direct && selectedService && values.startsAt && <p className="booking-share-notice">
        Duração: {selectedService.durationMinutes} min · Término previsto: {dateTimeLabel(new Date(new Date(values.startsAt).getTime() + selectedService.durationMinutes * 60000))}
      </p>}
      {direct && selectedService && <p className="booking-share-notice">Valor do serviço: {money(selectedService.priceCents)}</p>}
      {direct && user.role === "dono" && values.serviceId && values.professionalId && (
        commissionPreview?.serviceId === values.serviceId && commissionPreview?.professionalId === values.professionalId
          ? <div className="booking-share-notice"><b>Profissional recebe {money(commissionPreview.earnedCents)}</b><br/>
            Comissão efetiva: {Math.max(0,commissionPreview.commissionPercent - commissionPreview.houseSharePercent)}% · Parcela do estabelecimento: {money(commissionPreview.priceCents - commissionPreview.earnedCents)}<br/>
            Regra aplicada: {commissionPreview.ruleSource === "personalizada" ? "Profissional + serviço" : commissionPreview.ruleSource === "servico" ? "Comissão do serviço" : "Comissão padrão do profissional"}</div>
          : <p className="panel-subtitle">{previewError || "Calculando comissão atual..."}</p>)}
      {direct && !isProfessional && <SelectField label="Forma de pagamento" value={values.paymentMethod}
        onChange={event => setValues(v => ({...v, paymentMethod:event.target.value}))}>
        <option value="">Em aberto — receber depois</option>
        {Object.entries(paymentNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </SelectField>}
      {direct && !isProfessional && <p className="panel-subtitle">Para utilizar pacote ou pontos de fidelidade, registre o serviço em aberto e faça a baixa em Pagamentos pendentes.</p>}
      {direct && isProfessional && <p className="panel-subtitle">Pagamento será registrado pela recepção ou administrador.</p>}
      <Field label="Observações" placeholder="Algum detalhe importante?" value={values.notes}
        onChange={event => setValues(v => ({ ...v, notes: event.target.value }))}/>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button disabled={saving || !services.length || !options.length || (direct && user.role === "dono" && (!commissionPreview || commissionPreview.serviceId !== values.serviceId || commissionPreview.professionalId !== values.professionalId))}>
          {saving ? "Salvando..." : direct ? "Registrar serviço" : "Salvar agendamento"}
        </Button>
      </div>
    </form>
  </Modal>;
}

function BlockForm({ onClose, onSaved, initialDate, user }) {
  const [professionals, setProfessionals] = useState([]);
  const [values, setValues] = useState({ professionalId: user.role === "profissional" ? user.id : "", startDate: initialDate, endDate: initialDate, startTime: "", endTime: "", reason: "" });
  const [error, setError] = useState("");
  useEffect(() => { api("/professionals").then(({ professionals: people }) => setProfessionals(people)); }, []);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    const startsAt = `${values.startDate}T${values.startTime}`;
    const endsAt = `${values.endDate}T${values.endTime}`;
    if (!values.startTime || !values.endTime || startsAt >= endsAt) {
      setError("Informe o início e o fim do bloqueio. O término deve ser posterior ao início.");
      return;
    }
    try { await api("/blocked-slots", { method: "POST", body: { professionalId: values.professionalId, reason: values.reason, startsAt, endsAt } }); onSaved(); }
    catch (reason) { setError(reason.message); }
  };
  return <Modal title="Bloquear horário" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      {user.role !== "profissional" && <SelectField label="Profissional" value={values.professionalId} onChange={(e) => setValues({ ...values, professionalId: e.target.value })}>
        <option value="">Toda a equipe</option>{professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </SelectField>}
      {user.role === "profissional" && <p className="booking-share-notice">Este bloqueio vale apenas para seus próprios horários.</p>}
      <div className="form-grid">
        <Field label="Data inicial" type="date" required value={values.startDate} onChange={(e) => {
          const startDate = e.target.value;
          setValues(previous => ({ ...previous, startDate, endDate: previous.endDate === previous.startDate || previous.endDate < startDate ? startDate : previous.endDate }));
        }}/>
        <Field label="Das (hora inicial)" type="time" required value={values.startTime} onChange={(e) => setValues({ ...values, startTime: e.target.value })}/>
        <Field label="Data final" type="date" required min={values.startDate} value={values.endDate} onChange={(e) => setValues({ ...values, endDate: e.target.value })}/>
        <Field label="Até (hora final)" type="time" required value={values.endTime} onChange={(e) => setValues({ ...values, endTime: e.target.value })}/>
      </div>
      <p className="panel-subtitle">Somente o intervalo informado ficará indisponível para agendamentos.</p>
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
  const [notice, setNotice] = useState(null);
  const [clientId, setClientId] = useState(appointment.clientId);
  const [clients, setClients] = useState([]);
  const canChangeClient = !readOnly && ["agendado", "confirmado"].includes(appointment.status);
  useEffect(() => {
    if (canChangeClient) api("/clients").then(({clients}) => setClients(clients))
      .catch((reason) => setError(reason.message));
  }, [canChangeClient]);
  const save = async (patch) => {
    setSaving(true); setError("");
    try {
      const result = await api(`/appointments/${appointment.id}`, { method: "PATCH", body: patch });
      const savedAppointment = result.appointment || appointment;
      if (needsManualWhatsApp(savedAppointment, result.whatsappState)) {
        setNotice({ ...savedAppointment, status: patch.status, startsAt: patch.startsAt || savedAppointment.startsAt });
      } else {
        onUpdated();
      }
    }
    catch (reason) { setError(reason.message); } finally { setSaving(false); }
  };
  const completeOwn = async () => {
    if (!canCompleteService || !["agendado", "confirmado"].includes(appointment.status)) return;
    const scheduledTime = new Date(appointment.startsAt).getTime();
    const earlyCompletion = Number.isFinite(scheduledTime) && scheduledTime > Date.now();
    const confirmation = earlyCompletion
      ? "Este horário ainda não começou. Confirma que o serviço foi realmente realizado antecipadamente? O pagamento ficará pendente."
      : "Confirmar que o serviço foi realizado? O pagamento ficará pendente para a administração.";
    if (!await confirmAction(confirmation)) return;
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
  const whatsApp = appointment.bookingSource !== "public" || appointment.whatsappOptIn
    ? whatsappUrl(appointment.clientPhone, message) : "";
  if (notice) return <WhatsAppStatusNotice appointment={notice} onClose={onUpdated} />;
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
    {appointment.paymentMethod==="pacote"&&<p className="booking-share-notice">Sessão de pacote utilizada · {money(appointment.priceCents)} de valor proporcional. Não há novo recebimento.</p>}
    {!readOnly && appointment.paymentMethod!=="pacote" && <div className="form-stack mt-5">
      {canChangeClient && <SelectField label="Cliente do atendimento" value={clientId} onChange={(event) => setClientId(event.target.value)}>
        <option value={appointment.clientId}>{appointment.clientName}</option>
        {clients.filter((client) => client.id !== appointment.clientId).map((client) => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` · ${client.phone}` : ""}</option>)}
      </SelectField>}
      <Field label="Remarcar para" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      <div className="form-grid">
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(statusNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </SelectField>
        <Field label="Valor (R$)" type="number" min="0" step="0.01" value={(Number(price) / 100).toFixed(2)}
          onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} />
      </div>
      <SelectField label="Forma de pagamento" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="">Em aberto — pagar depois</option>{Object.entries(paymentNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </SelectField>
      {status === "concluido" && !method && <p className="panel-subtitle">O serviço será concluído e permanecerá em Pagamentos pendentes até o recebimento.</p>}
      {!appointment.paymentMethod&&["agendado","confirmado","concluido"].includes(appointment.status)&&clientId===appointment.clientId&&<BenefitActions appointment={appointment} onSaved={onUpdated}/>}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions modal-actions-split">
        {whatsApp && <a href={whatsApp} target="_blank" rel="noreferrer" className="button button-whatsapp"><Phone size={16} /> WhatsApp</a>}
        <Button disabled={saving} onClick={() => save({ status, paymentMethod: method, priceCents: price, ...(clientId !== appointment.clientId ? { clientId } : {}), ...(startsAt !== appointment.startsAt.slice(0, 16) ? { startsAt } : {}) })}>{saving ? "Salvando..." : status === "concluido" && !method ? "Concluir em aberto" : "Salvar alterações"}</Button>
      </div>
    </div>}
  </Modal>;
}

function AgendaGrid({ days, professionals, appointments, blocks, onOpen, onCreate }) {
  const columns = days.flatMap((day) => professionals.map((professional) => ({ day, professional })));
  const minutes = (value, day) => value.slice(0, 10) < day ? 0
    : value.slice(0, 10) > day ? 1440 : Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  const gridAppointments = appointments.filter((item) => !["cancelado", "faltou"].includes(item.status));
  const scheduledHours = [...gridAppointments, ...blocks].flatMap((item) => [
    Math.floor(minutes(item.startsAt, item.startsAt.slice(0, 10)) / 60),
    Math.ceil(minutes(item.endsAt, item.startsAt.slice(0, 10)) / 60),
  ]);
  const firstHour = Math.min(8, ...scheduledHours);
  const lastHour = Math.max(20, ...scheduledHours);
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) =>
    `${String(firstHour + index).padStart(2, "0")}:00`);
  const pixels = (value) => value * 96 / 60;
  const geometry = (item, day) => ({
    top: pixels(Math.max(0, minutes(item.startsAt, day) - firstHour * 60)),
    height: pixels(minutes(item.endsAt, day) - Math.max(firstHour * 60, minutes(item.startsAt, day))),
  });
  return <section className="panel calendar-panel operational-calendar" aria-label="Grade de horários"
    style={{ "--day-count": columns.length }}>
    <div className="calendar-heading"><div className="calendar-time-spacer"><Clock3 size={17}/></div>
      <div className="calendar-day-heads">{columns.map(({day, professional}) => <div key={`${day}-${professional.id}`}>
        <div className="calendar-prof-avatar">{professional.name.slice(0,1).toUpperCase()}</div>
        <div className="calendar-prof-copy"><b>{professional.name}</b><span>{gridAppointments.filter(item=>item.professionalId===professional.id && item.startsAt.slice(0,10)===day).length} atendimento(s)</span></div>
      </div>)}</div>
    </div>
    <div className="calendar-body">
      <div className="time-column">{hours.map((hour) => <span key={hour}>{hour}</span>)}</div>
      <div className="calendar-day-columns">{columns.map(({day, professional}) => {
        const events = gridAppointments.filter((item) => item.startsAt.slice(0, 10) === day
          && (!professional.id || item.professionalId === professional.id));
        const dayBlocks = blocks.filter((item) => item.startsAt < `${day}T24:00` && item.endsAt > `${day}T00:00`
          && (!item.professionalId || !professional.id || item.professionalId === professional.id));
        return <div className="calendar-day-column" key={`${day}-${professional.id}`}>
          {hours.flatMap(hour=>[hour,hour.replace(":00",":30")]).map((hour) => onCreate
            ? <button key={hour} type="button" className="calendar-hour"
                onClick={() => onCreate(day, hour, professional.active ? professional.id : "")}
                aria-label={`Novo agendamento às ${hour}, ${dateLabel(day)}, ${professional.name}`} />
            : <div key={hour} className="calendar-hour" />)}
          {dayBlocks.map((block) => <div key={block.id} className="calendar-block" style={geometry(block, day)}>
            <b>{block.startsAt.slice(11, 16)} – {block.endsAt.slice(11, 16)}</b><br/>{block.reason || "Horário bloqueado"}
          </div>)}
          {events.map((item) => {
            const label = `${item.startsAt.slice(11, 16)} · ${item.clientName} · ${item.serviceName}`;
            return <button key={item.id} className={`calendar-event event-${item.status}`}
              style={geometry(item, day)} title={label} aria-label={label} onClick={() => onOpen(item)}>
              <b>{item.startsAt.slice(11, 16)} · {item.clientName}</b><span>{item.serviceName} · {statusNames[item.status]}</span>
            </button>;
          })}
        </div>;
      })}</div>
    </div>
  </section>;
}

function AgendaPage({ user }) {
  const [date, setDate] = useState(localDate());
  const [professionals, setProfessionals] = useState([]);
  const [professionalId, setProfessionalId] = useState("");
  const [agendaView, setAgendaView] = useState(() => window.matchMedia("(max-width: 760px)").matches ? "lista" : "grade");
  const [newSlot, setNewSlot] = useState(null);
  const canEdit = user.tenantId !== "tenant-salao-demo";
  const [data, setData] = useState({ appointments: [], blockedSlots: [] });
  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const days = useMemo(() => [date], [date]);
  const refreshVersion = useRef(0);
  const refresh = useCallback(() => {
    const version = ++refreshVersion.current;
    const from = `${days[0]}T00:00:00`;
    const to = `${shiftDate(days[days.length - 1], 1)}T00:00:00`;
    return api(`/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((result) => { if (version === refreshVersion.current) setData(result); })
      .catch((reason) => { if (version === refreshVersion.current) setError(reason.message); });
  }, [days]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    api("/professionals").then(({professionals: team}) =>
      setProfessionals(team.filter((person) => user.role !== "profissional" || person.id === user.id)))
      .catch((reason) => setError(reason.message));
  }, [user.id, user.role]);
  const team = professionals.filter((person) => person.active
    || data.appointments.some((item) => item.professionalId === person.id)
    || data.blockedSlots.some((item) => item.professionalId === person.id));
  const appointments = data.appointments.filter((item) => !professionalId || item.professionalId === professionalId);
  const blocks = data.blockedSlots.filter((item) => !professionalId || !item.professionalId || item.professionalId === professionalId);
  const visibleTeam = team.filter((person) => !professionalId || person.id === professionalId);
  const createAt = (day, hour, professional) => {
    setNewSlot({ day, hour, professional });
    setModal("new");
  };
  const move = (offset) => setDate(shiftDate(date, offset));
  return <>
    <PageTitle eyebrow="SUA ROTINA EM UM SÓ LUGAR" title="Agenda" description={dateLabel(date)}
      actions={<>{canEdit && <Button variant="secondary" onClick={() => setModal("direct")}><Scissors size={16} /> Registrar serviço</Button>}{user.tenantId !== "tenant-salao-demo" && <Button variant="secondary" onClick={() => setModal("block")}><CalendarX2 size={16} /> Bloquear horário</Button>}{user.tenantId !== "tenant-salao-demo" && <Button onClick={() => createAt(date, null, professionalId)}><Plus size={17} /> Novo agendamento</Button>}</>} />
    <div className="agenda-day-summary" aria-label="Resumo do dia">
      <div><span className="agenda-summary-icon blue"><CalendarDays size={20}/></span><div><small>Agendamentos</small><strong>{appointments.length}</strong></div></div>
      <div><span className="agenda-summary-icon green"><CheckCheck size={20}/></span><div><small>Confirmados</small><strong>{appointments.filter(item=>item.status==="confirmado").length}</strong></div></div>
      <div><span className="agenda-summary-icon purple"><ClipboardCheck size={20}/></span><div><small>Concluídos</small><strong>{appointments.filter(item=>item.status==="concluido").length}</strong></div></div>
      <div><span className="agenda-summary-icon amber"><CalendarX2 size={20}/></span><div><small>Bloqueios</small><strong>{blocks.length}</strong></div></div>
    </div>
    <div className="agenda-toolbar premium-agenda-toolbar panel">
      <div className="date-nav"><button className="icon-button" onClick={() => move(-1)} aria-label="Anterior"><ChevronLeft size={18} /></button>
        <button className="date-today" onClick={() => setDate(localDate())}>Hoje</button><button className="icon-button" onClick={() => move(1)} aria-label="Próximo"><ChevronRight size={18} /></button></div>
      <Field label="Data da agenda" type="date" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} />
      {team.length > 1 && <div className="agenda-professional-filter">
      <SelectField label="Profissional" value={professionalId} onChange={(event) => setProfessionalId(event.target.value)}>
        <option value="">Todos os profissionais</option>
        {team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </SelectField>
      </div>}
      <div className="agenda-view-control"><span className="field-label">Visualização</span><div className="view-switch"><button type="button" className={agendaView==="grade"?"selected":""} aria-pressed={agendaView==="grade"} onClick={()=>setAgendaView("grade")}><CalendarRange size={15}/> Grade</button><button type="button" className={agendaView==="lista"?"selected":""} aria-pressed={agendaView==="lista"} onClick={()=>setAgendaView("lista")}><List size={15}/> Lista</button></div></div>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    {agendaView==="grade" && <div className="agenda-grid-wrapper">
      <div className="agenda-grid-label"><div><b>Horários por profissional</b><small>{canEdit?"Clique em um horário livre para agendar.":"Consulte os horários disponíveis."}</small></div><div className="agenda-legend"><span data-status="agendado">Agendado</span><span data-status="confirmado">Confirmado</span><span data-status="concluido">Concluído</span><span data-status="bloqueado">Bloqueado</span></div></div>
      <AgendaGrid days={days} professionals={visibleTeam.length ? visibleTeam : [{ id: "", name: "Agenda" }]}
        appointments={appointments} blocks={blocks} onOpen={setSelected} onCreate={canEdit ? createAt : null} />
    </div>}
    <div className="agenda-list-panel panel premium-agenda-list">
      <div className="panel-heading"><div><h2>Agendamentos do dia</h2><p className="panel-subtitle">{dateLabel(date)}</p></div><span className="count-chip">{appointments.length} atendimento(s)</span></div>
      {days.map((day) => {
        const events = appointments.filter((item) => item.startsAt.slice(0, 10) === day);
        const dayBlocks = blocks.filter((item) => item.startsAt < `${day}T24:00` && item.endsAt > `${day}T00:00`);
        return <div key={day} className="agenda-day-group">
          {events.length ? events.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} onOpen={setSelected} />)
            : <p className="day-empty">Nenhum atendimento neste dia.</p>}
          {dayBlocks.map((block) => <div className="block-row" key={block.id}><CalendarX2 size={16} /> {block.professionalName || "Equipe"} · {block.reason || "Horário indisponível"} · Bloqueado por {block.createdByName || "Não identificado"}
            <span>{dateTimeLabel(block.startsAt)} — {dateTimeLabel(block.endsAt)}</span><button className="icon-button compact" onClick={() => api(`/blocked-slots/${block.id}`, { method: "DELETE" }).then(refresh).catch(reason => setError(reason.message))} aria-label="Remover bloqueio"><X size={15} /></button></div>)}
        </div>;
      })}
    </div>
    {modal === "new" && <AppointmentForm initialDate={newSlot.day} initialHour={newSlot.hour} initialProfessional={newSlot.professional} user={user} onClose={() => setModal("")} onSaved={(savedDate) => { setModal(""); if (savedDate === date) refresh(); else setDate(savedDate); }} />}
    {modal === "direct" && <AppointmentForm direct initialProfessional={professionalId} user={user} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
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
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const refreshVersion = useRef(0);
  const [modal, setModal] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    const version=++refreshVersion.current;
    setLoading(true);
    return api(`${user.role === "profissional" ? "/booking/clients" : "/clients"}?search=${encodeURIComponent(search)}`)
      .then(({clients:list})=>{if(version===refreshVersion.current){setClients(list);setError("");}})
      .catch(reason=>{if(version===refreshVersion.current)setError(reason.message);})
      .finally(()=>{if(version===refreshVersion.current)setLoading(false);});
  }, [search, user.role]);
  useEffect(() => { refresh(); }, [refresh]);
  const showHistory = async (client) => {
    try { const result = await api(`/clients/${client.id}/history`); setHistory({ client, appointments: result.history, benefits:result.benefits,totalPaidCents:result.totalPaidCents }); }
    catch (reason) { setError(reason.message); }
  };
  const isProfessional=user.role==="profissional";
  const visible=clients.filter(client=>filter==="all" || (filter==="visited"&&client.lastVisit) || (filter==="new"&&!client.lastVisit) || (filter==="contactless"&&!client.phone));
  const historyCompleted=history?.appointments.filter(item=>item.status==="concluido")||[];
  return <>
    <PageTitle eyebrow="CRM • RELACIONAMENTO" title="Clientes" description="Gerencie contatos, acompanhe visitas e conheça o histórico de atendimento."
      actions={user.tenantId !== "tenant-salao-demo" && <Button onClick={() => setModal({})}><Plus size={17} /> Novo cliente</Button>} />
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid directory-stats">
      <StatCard title={search?"Clientes encontrados":"Clientes na lista"} value={loading?"—":clients.length} note={isProfessional?"Diretório de contatos":"Cadastros do estabelecimento"} icon={Users}/>
      {!isProfessional && <><StatCard title="Já foram atendidos" value={loading?"—":clients.filter(c=>c.lastVisit).length} note="Com visita concluída" icon={CheckCheck} tone="green"/>
      <StatCard title="Ainda sem visita" value={loading?"—":clients.filter(c=>!c.lastVisit).length} note="Sem atendimento concluído" icon={CalendarClock} tone="purple"/></>}
      <StatCard title="Sem telefone" value={loading?"—":clients.filter(c=>!c.phone).length} note="Na lista atual" icon={Phone} tone="orange"/>
    </section>
    <section className="panel clients-panel premium-directory">
      <div className="directory-heading"><div><p className="eyebrow">BASE DE RELACIONAMENTO</p><h2>Carteira de clientes</h2></div><span className="count-chip">{visible.length} resultado(s)</span></div>
      <div className="table-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Buscar cliente" placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <SelectField label="Filtrar clientes" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos</option>{!isProfessional&&<><option value="visited">Já atendidos</option><option value="new">Sem visita</option></>}<option value="contactless">Sem telefone</option></SelectField>
        {user.role !== "profissional" && user.tenantId!=="tenant-salao-demo" && <a className="button button-secondary export-button" href="/api/export/clients.csv"><Download size={15} /> Exportar CSV</a>}</div>
      {loading ? <Loading label="Carregando clientes..."/> : visible.length ? <div className="table-scroll client-records"><table role="table" aria-label="Clientes"><thead><tr><th>CLIENTE</th><th>CONTATO</th>{user.role !== "profissional" && <><th>ATENDIMENTOS</th><th>ÚLTIMA VISITA</th></>}<th>AÇÕES</th></tr></thead>
        <tbody role="rowgroup">{visible.map((client) => <tr role="row" key={client.id}>
          <td role="cell" className="client-record-name"><div className="table-person"><span className="table-avatar">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><b>{client.name}</b><small>{user.role === "profissional" ? "Cliente do estabelecimento" : client.email || "Cliente cadastrado"}</small></div></div></td>
          <td role="cell" data-label="Contato">{client.phone || "Sem telefone"}</td>{user.role !== "profissional" && <td role="cell" data-label="Atendimentos"><span className="count-chip">{client.appointmentCount}</span></td>}
          {user.role !== "profissional" && <td role="cell" data-label="Última visita">{client.lastVisit ? dateLabel(client.lastVisit.slice(0, 10)) : "Ainda sem visita"}</td>}
          <td role="cell" className="client-record-actions"><div className="row-actions">{user.role !== "profissional" && <button className="button button-secondary" onClick={() => showHistory(client)}>Histórico</button>}
            {user.role !== "profissional" && user.tenantId!=="tenant-salao-demo" && <button className="icon-button compact" onClick={() => setModal(client)} aria-label="Editar cliente" title="Editar cliente"><MoreHorizontal size={18} /></button>}
            {client.phone && <a className="icon-button compact client-contact-button" aria-label="Enviar mensagem" title="Enviar mensagem" href={whatsappUrl(client.phone, `Olá, ${client.name}! Tudo bem?`) } target="_blank" rel="noreferrer"><Phone size={15} /></a>}</div></td>
        </tr>)}</tbody></table></div>
        : <EmptyState icon={Users} title={search||filter!=="all"?"Nenhum cliente encontrado":"Sua lista começa aqui"} description={search||filter!=="all"?"Altere a busca ou o filtro para encontrar outros clientes.":"Cadastre seus clientes e acompanhe cada visita."} action={search||filter!=="all"?<Button variant="secondary" onClick={()=>{setSearch("");setFilter("all");}}>Limpar filtros</Button>:user.tenantId !== "tenant-salao-demo" && <Button onClick={() => setModal({})}><Plus size={15} /> Cadastrar cliente</Button>} />}
    </section>
    {modal && (user.role === "profissional" ?
      <QuickClientForm onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }}/> :
      <ClientForm client={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }}/>)}
    {history && <Modal title={`Histórico de ${history.client.name}`} onClose={() => setHistory(null)} wide>
      <div className="crm-profile-header"><span className="table-avatar">{history.client.name.slice(0,1).toUpperCase()}</span><div><b>{history.client.name}</b><small>{history.client.phone||"Sem telefone"} · {history.client.email||"Sem e-mail"}</small></div></div>
      <div className="crm-profile-summary"><div><small>Atendimentos concluídos</small><b>{historyCompleted.length}</b></div><div><small>Valor dos serviços realizados</small><b>{money(historyCompleted.reduce((sum,item)=>sum+item.priceCents,0))}</b></div><div><small>Última visita</small><b>{history.client.lastVisit?dateLabel(history.client.lastVisit.slice(0,10)):"Nenhuma"}</b></div></div>
      <div className="crm-profile-notes"><b>Observações</b><p>{history.client.notes || "Sem observações sobre este cliente."}</p></div>
      {history.benefits&&<><div className="crm-profile-summary"><div><small>Pago em serviços e pacotes</small><b>{money(history.totalPaidCents)}</b></div><div><small>Pontos disponíveis</small><b>{history.benefits.loyalty.balance}</b></div><div><small>Pacotes ativos</small><b>{history.benefits.purchases.filter(p=>p.expiresOn>=localDate()&&p.items.some(i=>i.used<i.sessions)).length}</b></div></div><h3 className="crm-history-title">Pacotes adquiridos</h3>{history.benefits.purchases.map(p=><div className="expense-row" key={p.id}><div className="expense-row-details"><b>{p.packageName}</b><small>Válido até {dateLabel(p.expiresOn)} · {p.items.map(i=>i.serviceName+": "+(i.sessions-i.used)+"/"+i.sessions).join(" · ")}</small></div><strong>{money(p.priceCents)}</strong></div>)}</>}
      <h3 className="crm-history-title">Histórico de atendimentos</h3>
      {history.appointments.length ? <div className="appointments-list crm-history-list">{history.appointments.map((item) => <div className="history-item" key={item.id}><span>{item.status === "concluido" && item.completedOn ? <>
        {item.bookingSource==="direct"?"Registro direto":`Agendado: ${dateTimeLabel(item.startsAt)}`}<br />Realizado em {dateLabel(item.completedOn)}
      </> : dateTimeLabel(item.startsAt)}</span><div><b>{item.serviceName}</b><small>{item.professionalName}</small></div><span>{money(item.priceCents)}</span><span className={`status-badge ${statusStyles[item.status]}`}>{statusNames[item.status]}</span></div>)}</div>
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
  const [filter,setFilter]=useState("all");
  useEffect(() => {
    let active=true;setData(null);setError("");
    api(`/professional/earnings?month=${encodeURIComponent(month)}`)
      .then(result => { if(active){setData(result);setError("");} })
      .catch(reason => {if(active)setError(reason.message);});
    return ()=>{active=false;};
  }, [month]);
  const visible=(data?.services||[]).filter(item=>filter==="all"||(filter==="paid"?item.paid:!item.paid));
  return <div className="professional-workspace">
    <PageTitle eyebrow="MINHAS COMISSÕES" title="Meus ganhos"
      description="Confira suas comissões de serviços concluídos e os pagamentos registrados pelo comércio."
      actions={<Link className="button button-secondary" to="/meus-atendimentos"><ClipboardCheck size={16}/> Meus atendimentos</Link>}/>
    <div className="panel professional-filter-bar"><div className="month-filter"><label htmlFor="earnings-month">Mês de referência</label>
      <input id="earnings-month" className="input month-input" type="month" value={month} onChange={event => {if(event.target.value)setMonth(event.target.value);}}/></div>
      <SelectField label="Situação da comissão" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todas</option><option value="pending">A receber</option><option value="paid">Pagas</option></SelectField></div>
    <ErrorMessage>{error}</ErrorMessage>
    {!data ? !error && <Loading/> : <>
      <section className="professional-balance-hero"><div><span className="eyebrow">SALDO TOTAL A RECEBER</span><strong>{money(data.allTime.dueCents)}</strong><small>Comissões pendentes de todos os períodos</small></div><span className="professional-balance-icon"><Wallet size={30}/></span><div className="professional-balance-foot"><span>Total já repassado</span><b>{money(data.allTime.paidCents)}</b></div></section>
      <section className="stats-grid finance-stats professional-stats">
        <StatCard title="Comissões do mês" value={money(data.earnedCents)} note="Geradas pelos serviços concluídos" icon={ClipboardCheck} tone="purple"/>
        <StatCard title="Repassado (serviços do mês)" value={money(data.paidCents)} note="Pagamento confirmado" icon={CheckCheck} tone="green"/>
        <StatCard title="A receber (serviços do mês)" value={money(data.dueCents)} note="Comissão ainda não repassada" icon={Wallet} tone="orange"/>
      </section>
      <section className="panel management-panel professional-list-panel">
        <div className="panel-heading"><div><p className="eyebrow">DETALHAMENTO</p><h2>Serviços prestados</h2>
          <p className="panel-subtitle">Os valores abaixo são comissões, não o preço integral dos serviços. Somente o proprietário registra o pagamento.</p></div></div>
        {visible.length ? <div className="professional-card-grid">{visible.map(item =>
          <article className="professional-service-card" key={item.id}>
            <div className="professional-card-head"><span className="professional-card-icon"><Wallet size={19}/></span><div><b>{item.serviceName}</b><small>{item.clientName}</small></div><span className={`status-badge ${item.paid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.paid?"Pago":"A receber"}</span></div>
            <p className="professional-card-date"><CalendarDays size={15}/> Realizado em {dateLabel(item.completedOn||item.startsAt.slice(0,10))} · {item.bookingSource==="direct"?"Registro direto":"Agendado"}</p>
            <div className="professional-card-amounts"><div><small>Valor do serviço</small><b>{money(item.priceCents)}</b></div><div><small>Comissão efetiva</small><b>{Math.max(0,item.commissionPercent-(item.houseSharePercent||0))}%</b></div><div><small>{item.paid?"Comissão paga":"Sua comissão"}</small><strong>{money(item.paid?item.paidCents:item.earnedCents)}</strong></div></div>
            <small className="professional-card-note">Cliente: {item.paymentMethod?"pagamento recebido":"pagamento pendente"}{item.paid&&item.paidAt?` · Repasse registrado em ${cashTimestamp(item.paidAt)}`:""}</small>
          </article>)}</div> : <EmptyState icon={Wallet} title="Sem ganhos registrados neste mês"
            description="A comissão aparece quando um serviço atribuído a você é concluído."/>}
      </section>
    </>}
  </div>;
}

function TeamCommissionsPage({ user }) {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [adjusting, setAdjusting] = useState(null);
  const [direct, setDirect] = useState(false);
  const [professionalId, setProfessionalId] = useState("");
  const [payoutFilter,setPayoutFilter]=useState("all");
  const [adjustError, setAdjustError] = useState("");
  const [loadingRule, setLoadingRule] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const result = await api(`/commissions?month=${encodeURIComponent(month)}`);
      setItems(result.commissions); setError("");
    } catch(reason) { setError(reason.message); }
  }, [month]);
  useEffect(() => { refresh(); }, [refresh]);
  const filtered = items.filter(item => !professionalId || item.professionalId === professionalId);
  const unpaid = filtered.filter(item => !item.paid);
  const visible=filtered.filter(item=>payoutFilter==="all"||(payoutFilter==="paid"?item.paid:!item.paid));
  const gross = filtered.reduce((sum,item)=>sum+item.priceCents,0);
  const earned = filtered.reduce((sum,item)=>sum+item.earnedCents,0);
  const professionals = [...new Map(items.map(item=>[item.professionalId,item.professionalName])).entries()];
  return <>
    <PageTitle eyebrow="CONTROLE DA EQUIPE" title="Lançamentos dos profissionais"
      description="Registre serviços realizados e confira o valor que cada profissional tem direito a receber. Não lance novamente serviços já concluídos na agenda."
      actions={<Button onClick={()=>setDirect(true)}><Plus size={16}/> Registrar serviço</Button>}/>
    {direct && <AppointmentForm direct user={user} initialProfessional={professionalId} onClose={()=>setDirect(false)} onSaved={day=>{setDirect(false);if(day.slice(0,7)===month)refresh();else setMonth(day.slice(0,7));}}/>}
    <div className="booking-queue-tools panel finance-filter-bar">
    <div className="month-filter"><label htmlFor="commissions-month">Mês</label>
      <input id="commissions-month" className="input month-input" type="month" value={month}
        onChange={event => {setMonth(event.target.value);setProfessionalId("");}}/></div>
    <SelectField label="Profissional" value={professionalId} onChange={e=>setProfessionalId(e.target.value)}><option value="">Todos os profissionais</option>{professionals.map(([id,name])=><option key={id} value={id}>{name}</option>)}</SelectField>
    <SelectField label="Situação do repasse" value={payoutFilter} onChange={e=>setPayoutFilter(e.target.value)}><option value="all">Todos</option><option value="pending">A repassar</option><option value="paid">Repassados</option></SelectField>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid finance-stats commission-overview">
      <StatCard title="Serviços realizados" value={money(gross)} note="Valor bruto dos serviços" icon={Scissors}/>
      <StatCard title="Comissão dos profissionais" value={money(earned)} note="Total devido pelos serviços do período" icon={CircleDollarSign}/>
      <StatCard title="Parcela do estabelecimento" value={money(gross-earned)} note="Antes das demais despesas" icon={Wallet}/>
      <StatCard title="Falta repassar" value={money(unpaid.reduce((sum,item)=>sum+item.earnedCents,0))}
        note="Comissão ainda não paga ao profissional" icon={Wallet} tone="orange"/>
      <StatCard title="Já repassado" value={money(filtered.filter(item=>item.paid).reduce((sum,item)=>sum+item.paidCents,0))}
        note="Repasses confirmados destes serviços" icon={CheckCheck} tone="green"/>
    </section>
    <section className="panel management-panel finance-ledger">
      <div className="panel-heading"><div><h2>Serviços lançados</h2>
        <p className="panel-subtitle">O recebimento do cliente é separado do repasse ao profissional. Confirme os repasses em Fechamentos quinzenais.</p></div></div>
      {visible.length ? <div className="management-list">{visible.map(item =>
        <article className="service-row" key={item.id}>
          <span className="service-row-icon"><CircleDollarSign size={18}/></span>
          <div className="min-w-0 flex-1"><b>{item.professionalName} · {item.serviceName}</b>
            <small>{item.clientName} · Realizado em {dateLabel(item.completedOn)} · {item.bookingSource === "direct" ? "Registro direto" : "Agendado"}</small>
            <small>Serviço: {money(item.priceCents)} · Comissão efetiva: {Math.max(0,item.commissionPercent - (item.houseSharePercent || 0))}% · Estabelecimento: {money(item.priceCents-item.earnedCents)}</small>
            <small>Cliente: {item.paymentMethod ? "Pagamento recebido" : "Pagamento pendente"} · Repasse: {item.paid ? "Confirmado" : "Pendente"}</small></div>
          <div className="finance-amount"><small>Profissional recebe</small><strong>{money(item.earnedCents)}</strong></div>
          {item.paid ? <span className="status-badge bg-emerald-50 text-emerald-700">Repassado</span> : <>
            <Button variant="secondary" onClick={()=>{setAdjustError("");setAdjusting({...item, reason:""});}}>Ajustar comissão</Button>
          </>}
        </article>)}</div> : <EmptyState icon={Wallet} title="Nenhum lançamento neste filtro"
          description="Altere o filtro ou conclua atendimentos para registrar comissões."/>}
    </section>
    {adjusting && <Modal title="Ajustar comissão do serviço" onClose={()=>setAdjusting(null)}>
      <form className="form-stack" onSubmit={async event=>{
        event.preventDefault(); setAdjustError("");
        try {
          await api(`/commissions/${adjusting.id}`, {method:"PATCH",body:{
            commissionPercent:Number(adjusting.commissionPercent),
            houseSharePercent:Number(adjusting.houseSharePercent || 0),
            reason:adjusting.reason,
          }});
          setAdjusting(null); await refresh();
        } catch(e){setAdjustError(e.message);}
      }}>
        <p className="panel-subtitle">Altera somente este serviço. Repasses já confirmados não podem ser editados diretamente.</p>
        <Button type="button" variant="secondary" disabled={loadingRule} onClick={async()=>{
          setLoadingRule(true);setAdjustError("");
          try{const rule=await api(`/commission-preview?serviceId=${encodeURIComponent(adjusting.serviceId)}&professionalId=${encodeURIComponent(adjusting.professionalId)}`);
            setAdjusting(v=>v&&v.id===adjusting.id?{...v,commissionPercent:rule.commissionPercent,houseSharePercent:rule.houseSharePercent}:v);}
          catch(e){setAdjustError(e.message);}finally{setLoadingRule(false);}
        }}>{loadingRule?"Consultando...":"Usar regra de comissão atual"}</Button>
        <Field label="Comissão do profissional (%)" type="number" min="0" max="100" step="0.5" value={adjusting.commissionPercent}
          onChange={e=>setAdjusting(v=>({...v,commissionPercent:e.target.value}))}/>
        <Field label="Retenção do estabelecimento / materiais (%)" type="number" min="0" max="100" step="0.5"
          value={adjusting.houseSharePercent ?? 0} onChange={e=>setAdjusting(v=>({...v,houseSharePercent:e.target.value}))}/>
        <Field label="Motivo do ajuste (opcional)" maxLength={250}
          value={adjusting.reason} onChange={e=>setAdjusting(v=>({...v,reason:e.target.value}))}/>
        <p className="booking-share-notice">Valor do serviço: {money(adjusting.priceCents)} · Comissão efetiva: {Math.max(0,Number(adjusting.commissionPercent)-Number(adjusting.houseSharePercent||0))}%<br/><b>Profissional recebe: {money(Math.round(adjusting.priceCents*Math.max(0,Number(adjusting.commissionPercent)-Number(adjusting.houseSharePercent||0))/100))}</b></p>
        <ErrorMessage>{adjustError}</ErrorMessage>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={()=>setAdjusting(null)}>Cancelar</Button><Button>Salvar ajuste</Button></div>
      </form>
    </Modal>}
  </>;
}

function ProfessionalWorkPage({ user }) {
  const [direct, setDirect] = useState(false);
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [data, setData] = useState({ services: [], totals: { appointments: 0, completed: 0, serviceValueCents: 0 } });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(null);
  const [filter,setFilter]=useState("all");
  const refreshVersion=useRef(0);
  const refresh = useCallback(async () => {
    const version=++refreshVersion.current;
    try {
      const result = await api(`/professional/my-services?month=${encodeURIComponent(month)}`);
      if(version===refreshVersion.current){setData(result);setError("");}
    } catch (reason) { if(version===refreshVersion.current)setError(reason.message); }
  }, [month]);
  useEffect(() => { refresh(); }, [refresh]);
  const complete = async (id) => {
    const item = data.services.find(service => service.id === id);
    const aheadOfSchedule = item?.startsAt > new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
      minute: "2-digit", hourCycle: "h23",
    }).format(new Date()).replace(" ", "T");
    if (!await confirmAction(aheadOfSchedule
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
  const current=data.month===month;
  const services=current?data.services:[];
  const visible=services.filter(item=>filter==="all"||(filter==="pending"?canComplete(item):filter==="today"?(item.status==="concluido"?item.completedOn||item.startsAt.slice(0,10):item.startsAt.slice(0,10))===localDate():item.status===filter));
  return <div className="professional-workspace">
    <PageTitle eyebrow="ÁREA DO PROFISSIONAL" title="Meus atendimentos"
      description="Visualize seus serviços e registre os que foram efetivamente realizados."
      actions={<Button onClick={() => setDirect(true)}><Plus size={16}/> Registrar serviço</Button>} />
    <div className="panel professional-filter-bar"><div className="month-filter"><label htmlFor="professional-month">Mês</label>
      <input id="professional-month" className="input month-input" type="month" value={month}
        onChange={e => {if(e.target.value)setMonth(e.target.value);}}/></div><SelectField label="Filtrar atendimentos" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos</option><option value="today">Hoje</option><option value="pending">A realizar</option><option value="concluido">Concluídos</option><option value="cancelado">Cancelados</option><option value="faltou">Faltas</option></SelectField><Link className="button button-secondary" to="/agenda"><CalendarDays size={16}/> Abrir agenda</Link></div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid finance-stats professional-stats">
      <StatCard title="Meus atendimentos" value={current?data.totals.appointments:"—"} note="Agendados ou realizados no período" icon={CalendarDays} />
      <StatCard title="A realizar" value={current?services.filter(canComplete).length:"—"} note="Agendados ou confirmados" icon={Clock3} tone="orange"/>
      <StatCard title="Serviços realizados" value={current?data.totals.completed:"—"} note="Concluídos" icon={CheckCheck} tone="green"/>
      <StatCard title="Valor dos serviços realizados" value={current?money(data.totals.serviceValueCents):"—"}
        note="Valor bruto; veja comissões em Meus ganhos" icon={Scissors} tone="blue"/>
    </section>
    <section className="panel management-panel professional-list-panel">
      <div className="panel-heading"><div><p className="eyebrow">REGISTRO DE SERVIÇOS</p>
        <h2>Atendimentos atribuídos a mim</h2></div><span className="count-chip">{visible.length} resultado(s)</span></div>
      {!current&&!error?<Loading label="Carregando atendimentos..."/>:visible.length ? <div className="professional-card-grid">
        {visible.map(item => <article className="professional-service-card" data-status={item.status} key={item.id}>
          <div className="professional-card-head"><span className="professional-card-icon"><ClipboardCheck size={19}/></span><div><b>{item.clientName}</b><small>{item.serviceName}</small></div><span className={`status-badge ${statusStyles[item.status]}`}>{statusNames[item.status]}</span></div>
          <div className="professional-card-date"><CalendarDays size={16}/><small>{item.bookingSource==="direct"?"Registro direto":dateTimeLabel(item.startsAt)}{item.status==="concluido"&&item.completedOn?` · Realizado em ${dateLabel(item.completedOn)}`:""} · {statusNames[item.status]}</small></div>
          <div className="professional-card-amounts"><div><small>Valor do serviço</small><strong>{money(item.priceCents)}</strong></div><div><small>Origem</small><b>{item.bookingSource==="direct"?"Registro direto":"Agendado"}</b></div></div>
          {canComplete(item) && <Button disabled={saving !== null} onClick={() => complete(item.id)}>
            {saving === item.id ? "Salvando..." : "Concluir serviço"}
          </Button>}
        </article>)}
      </div> : <EmptyState icon={CalendarDays} title="Nenhum serviço neste filtro"
        description="Altere o filtro ou registre um atendimento realizado."/>}
    </section>
    {direct && <AppointmentForm direct user={user} onClose={() => setDirect(false)} onSaved={(day) => { setDirect(false); if (day.slice(0,7) === month) refresh(); else setMonth(day.slice(0,7)); }} />}
  </div>;
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
  const [query,setQuery]=useState("");
  const [statusFilter,setStatusFilter]=useState("all");
  const [roleFilter,setRoleFilter]=useState("all");
  const [loading,setLoading]=useState(true);
  const directoryVersion=useRef(0);
  const refresh = useCallback(() => {
    const version=++directoryVersion.current;
    setLoading(true);
    return Promise.all([
    api("/services"),
    api("/professionals"),
    user.role === "dono" && user.tenantId !== "tenant-salao-demo" && section === "team" ? api("/team-members") : Promise.resolve(null),
  ])
    .then(([s, p, people]) => { if(version===directoryVersion.current){setServices(s.services);setProfessionals(p.professionals);setTeam(people?.team ?? p.professionals);setError("");} })
    .catch((reason) => {if(version===directoryVersion.current)setError(reason.message);}).finally(()=>{if(version===directoryVersion.current)setLoading(false);});
  }, [user.role,user.tenantId,section]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(()=>{setQuery("");setStatusFilter("all");setRoleFilter("all");},[section]);
  const term=query.trim().toLocaleLowerCase("pt-BR");
  const matchesStatus=item=>statusFilter==="all" || (statusFilter==="active" ? Boolean(item.active) : !item.active);
  const filteredServices=services.filter(item=>matchesStatus(item)&&(!term||item.name.toLocaleLowerCase("pt-BR").includes(term)));
  const filteredTeam=team.filter(person=>matchesStatus(person)&&(roleFilter==="all"||person.role===roleFilter)&&(!term||[person.name,person.jobTitle,person.email,person.phone].some(value=>String(value||"").toLocaleLowerCase("pt-BR").includes(term))));
  return <>
    <PageTitle eyebrow="GESTÃO DO ESTABELECIMENTO"
      title={section === "team" ? "Equipe e acessos" : "Serviços"}
      description={section === "team" ? "Cadastre funcionários, defina funções, serviços e horários." : "Organize os serviços, preços e duração dos atendimentos."}
      actions={user.role === "dono" && user.tenantId !== "tenant-salao-demo" && (section === "team"
        ? <Button onClick={() => setModal("team")}><UserRound size={16} /> Adicionar funcionário</Button>
        : <Button onClick={() => setModal("service")}><Plus size={16} /> Novo serviço</Button>)} />
    <ErrorMessage>{error}</ErrorMessage>
    {section==="services" ? <section className="stats-grid directory-stats">
      <StatCard title="Serviços cadastrados" value={loading?"—":services.length} note="Catálogo completo" icon={Scissors}/>
      <StatCard title="Serviços ativos" value={loading?"—":services.filter(s=>s.active).length} note="Disponíveis para atendimento" icon={CheckCheck} tone="green"/>
      <StatCard title="Agendamento online" value={loading?"—":services.filter(s=>s.active&&s.publicEnabled).length} note="Visíveis no link público" icon={CalendarDays} tone="purple"/>
      <StatCard title="Serviços inativos" value={loading?"—":services.filter(s=>!s.active).length} note="Indisponíveis no catálogo" icon={X} tone="orange"/>
    </section>:<section className="stats-grid directory-stats">
      <StatCard title="Equipe cadastrada" value={loading?"—":team.length} note="Todos os colaboradores" icon={Users}/>
      <StatCard title="Colaboradores ativos" value={loading?"—":team.filter(p=>p.active).length} note="Cadastro ativo" icon={CheckCheck} tone="green"/>
      <StatCard title="Profissionais" value={loading?"—":team.filter(p=>p.role==="profissional"&&p.active).length} note="Profissionais ativos com agenda" icon={Scissors} tone="purple"/>
      <StatCard title="Recepção e apoio" value={loading?"—":team.filter(p=>p.role!=="profissional"&&p.active).length} note="Colaboradores ativos" icon={UserRound} tone="orange"/>
    </section>}
    <div className="management-grid">
      {section === "services" && <section className="panel management-panel catalog-panel"><div className="panel-heading"><div><p className="eyebrow">SERVIÇOS OFERECIDOS</p><h2>Catálogo de serviços</h2></div><span className="count-chip">{filteredServices.length} resultado(s)</span></div>
        <div className="directory-filters"><Field label="Buscar serviço" placeholder="Nome do serviço" value={query} onChange={e=>setQuery(e.target.value)}/><SelectField label="Situação" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></SelectField></div>
        {loading?<Loading label="Carregando catálogo..."/>:filteredServices.length ? <div className="catalog-grid">{filteredServices.map((service) => <article className="catalog-card" key={service.id}>
          <div className="catalog-card-head"><span className="catalog-icon"><Scissors size={23}/></span><span className={`status-badge ${service.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{service.active?"Ativo":"Inativo"}</span></div>
          <h3>{service.name}</h3><div className="catalog-price">{money(service.priceCents)}</div>
          <div className="catalog-detail"><span><Clock3 size={15}/> {service.durationMinutes} min</span><span><CalendarDays size={15}/> {service.active&&service.publicEnabled?"Online disponível":"Sem oferta online"}</span></div>
          <div className="catalog-commission"><small>Regra de comissão</small><b>{service.commissionMode === "custom" ? `${service.serviceCommissionPercent}% do serviço` : "Padrão do profissional"}</b><small>Retenção: {service.houseSharePercent||0} pontos percentuais</small></div>
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && <Button variant="secondary" onClick={()=>setModal(service)} aria-label="Editar serviço"><Settings size={15}/> Editar serviço</Button>}
        </article>)}</div> : <EmptyState icon={Scissors} title={services.length?"Nenhum serviço encontrado":"Nenhum serviço cadastrado"} description={services.length?"Altere os filtros para encontrar outros serviços.":"Adicione seu primeiro serviço."} />}</section>}
      {section === "team" && <section className="panel management-panel catalog-panel"><div className="panel-heading"><div><p className="eyebrow">QUEM FAZ ACONTECER</p><h2>Equipe do estabelecimento</h2></div><span className="count-chip">{filteredTeam.length} resultado(s)</span></div>
        <div className="directory-filters"><Field label="Buscar colaborador" placeholder="Nome, cargo ou contato" value={query} onChange={e=>setQuery(e.target.value)}/><SelectField label="Função" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="all">Todas</option><option value="profissional">Profissional</option><option value="recepcao">Recepção</option><option value="sem_acesso">Apoio</option></SelectField><SelectField label="Situação" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></SelectField></div>
        {loading?<Loading label="Carregando equipe..."/>:filteredTeam.length ? <div className="catalog-grid team-catalog-grid">{filteredTeam.map((person) => <article className="team-catalog-card" key={person.id}>
          <div className="team-card-head"><span className="team-card-avatar" data-role={person.role}>{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
          <div className="min-w-0 flex-1"><h3>{person.name}</h3><small>{person.jobTitle || (person.role === "recepcao" ? "Recepção" : person.role === "sem_acesso" ? "Apoio" : "Profissional")}</small></div></div>
          <div className="team-card-badges"><span className="count-chip">{person.role==="profissional"?"Profissional":person.role==="recepcao"?"Recepção":"Apoio"}</span>{person.active ? <span className="status-badge bg-emerald-50 text-emerald-700">Ativo</span> : <span className="status-badge bg-slate-100 text-slate-500">Inativo</span>}</div>
          <div className="team-card-details"><span><Phone size={15}/>{person.phone||"Sem telefone"}</span>
          {person.role==="profissional"?<><span><ShieldCheck size={15}/> Acesso: {person.loginCode||person.staffCode||"—"}</span><span><Wallet size={15}/> Comissão padrão: {person.commissionPercent}%</span></>:person.role==="recepcao"?<span><Mail size={15}/> {person.email||"Sem e-mail"}</span>:<span><ShieldCheck size={15}/> Sem acesso ao painel</span>}</div>
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && <details className="row-action-menu">
            <summary className="button button-secondary" aria-label={`Ações de ${person.name}`}><MoreHorizontal size={17}/> Ações</summary>
            <div className="row-action-options">
              <button className="button button-quiet" onClick={() => setEditPerson({...person})}>Editar</button>
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && person.role === "profissional" && <button className="button button-quiet" onClick={() => setHoursFor(person)}>Horários</button>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && person.role === "profissional" && <button className="button button-quiet" onClick={async () => {
            try {
              const result = await api(`/team-members/${person.id}/activation`, { method: "POST" });
              setActivationIssued({ ...result, name: person.name });
            } catch (reason) { setError(reason.message); }
          }}>Configurar acesso</button>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && person.role === "recepcao" && <button className="button button-quiet" onClick={() => { setPasswordFor(person); setResetPassword(""); }}>Redefinir senha</button>}
          {user.role === "dono" && user.tenantId !== "tenant-salao-demo" && <button className="button button-quiet" onClick={async () => {
            try { await api(`/team-members/${person.id}`, { method: "PATCH", body: { name: person.name, phone: person.phone, commissionPercent: person.commissionPercent, active: !person.active } }); refresh(); }
            catch (reason) { setError(reason.message); }
          }} aria-label={person.active ? "Desativar pessoa da equipe" : "Ativar pessoa da equipe"}><ShieldCheck size={16} />{person.active ? "Desativar" : "Ativar"}</button>}
            </div>
          </details>}
        </article>)}</div> : <EmptyState icon={UserRound} title={team.length?"Nenhum colaborador encontrado":"Só você por enquanto"} description={team.length?"Altere os filtros para encontrar outros colaboradores.":"Adicione profissionais para compartilhar a agenda."} />}</section>}
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
        <p className="panel-subtitle">A comissão padrão será aplicada a novos lançamentos sem regra de comissão do serviço ou regra individual anterior. Para corrigir um serviço já concluído, use Lançamentos dos profissionais.</p>
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
  const hostname = baseUrl && new URL(baseUrl).hostname;
  const isLocal = ["localhost", "[::1]", "0.0.0.0"].includes(hostname) || hostname.startsWith("127.");
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setMessage(isLocal ? "Endereço local copiado para teste." : "Link copiado. Compartilhe com seus clientes.");
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
    <div className="management-grid booking-sharing-grid premium-booking-share">
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
          {!isLocal && <a className="button button-secondary" href={whatsapp} target="_blank" rel="noreferrer"><Share2 size={16}/> Enviar por WhatsApp</a>}
        </div>
        {message && <p role="status" className="success-message">{message}</p>}
        {isLocal && <p className="booking-share-notice"><Info size={17}/> Este endereço funciona apenas neste computador. Para divulgar aos clientes, abra o sistema pelo endereço público.</p>}
        {user.tenantId === "tenant-salao-demo" && <p className="booking-share-notice"><Info size={17}/> Esta é uma demonstração de compartilhamento. A reserva pública demonstrativa não grava solicitações reais.</p>}
      </section>
      <section className="panel management-panel booking-qr-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">DIVULGAÇÃO</p><h2>QR Code</h2>
            <p className="panel-subtitle">Exiba no balcão ou compartilhe com seu cliente.</p></div>
          <QrCode size={20} className="text-blue-500"/>
        </div>
        {baseUrl && <div className="booking-qr-image">
          <QRCode value={link} size={200} title="QR Code da página de agendamento"
            role="img" aria-label="QR Code da página de agendamento" />
        </div>}
        <p className="booking-qr-caption">{isLocal ? "O QR Code aponta para o endereço local de teste." : "Escaneie o código para abrir a página de agendamento."}</p>
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
    if (!await confirmAction(`Confirma que o pagamento de ${money(receipt.priceCents)} foi recebido em ${date}? A conciliação ficará registrada no histórico.`)) return;
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

function CashOpeningPanel({ revision, onOpened }) {
  const [state, setState] = useState(null);
  const [openingAmount, setOpeningAmount] = useState("0.00");
  const [openingNotes, setOpeningNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => api("/cash/daily")
      .then(day => { if (active) { setState(day); setError(""); } })
      .catch(reason => { if (active) setError(reason.message); });
    refresh();
    const interval = window.setInterval(refresh, 60000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [revision]);
  const openDay = async () => {
    const input = openingAmount.trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(input))
      return setError("Informe o dinheiro inicial em reais, com até duas casas decimais.");
    const openingCashCents = Math.round(Number(input) * 100);
    if (!Number.isSafeInteger(openingCashCents) || openingCashCents < 0)
      return setError("Valor de abertura inválido.");
    if (!await confirmAction(`Abrir o caixa de ${state.today} com ${money(openingCashCents)} em espécie?`, "Abertura de caixa")) return;
    setBusy(true); setError("");
    try {
      await api("/cash/openings", { method:"POST",
        body:{date:state.today, openingCashCents, notes:openingNotes} });
      setOpeningNotes("");
      setState(previous => ({...previous, cashState:"open"}));
      onOpened();
    } catch (reason) {setError(reason.message);}
    finally {setBusy(false);}
  };
  const status = state?.cashState;
  const isUnopened = status === "unopened";
  const isOpen = status === "open";
  const isClosed = status === "closed";
  return <section className="panel management-panel premium-cash-opening" data-state={status||"loading"}>
    <div className="panel-heading"><div>
      <p className="eyebrow">INÍCIO DO EXPEDIENTE</p>
      <h2><Wallet size={20}/> Abertura do caixa</h2>
      <p className="panel-subtitle">Acompanhe a situação do caixa e registre o dinheiro inicial antes de iniciar as operações financeiras.</p>
    </div><span className="cash-state-pill"><span/>{isOpen ? "Caixa aberto" : isClosed ? "Caixa encerrado" : isUnopened ? "Aguardando abertura" : "Consultando..."}</span></div>
    <ErrorMessage>{error}</ErrorMessage>
    {isOpen && <div className="panel-subtitle" role="status">
      Caixa do dia aberto por {state.opening?.openedByName || "usuário autorizado"}, com saldo inicial de {money(state.opening?.openingCashCents || 0)}. As movimentações do dia estão liberadas.
    </div>}
    {isClosed && <div className="panel-subtitle" role="status">
      O caixa de {state.today?.split("-").reverse().join("/")} já foi encerrado. Não é possível reabri-lo neste dia. No próximo dia, a abertura será liberada automaticamente.
    </div>}
    {isUnopened && <>
      <p className="panel-subtitle">Informe R$ 0,00 caso não haja troco em espécie.</p>
      <div className="form-grid">
      <Field label="Dinheiro inicial (R$)" value={openingAmount}
        onChange={event=>setOpeningAmount(event.target.value)} inputMode="decimal"/>
      <Field label="Observação (opcional)" value={openingNotes} maxLength={500}
        placeholder="Ex.: troco deixado pelo caixa anterior"
        onChange={event=>setOpeningNotes(event.target.value)}/>
    </div>
      <div style={{marginTop:16}}>
        <Button disabled={busy} onClick={openDay}><Wallet size={16}/>{busy ? "Abrindo caixa..." : "Abrir caixa do dia"}</Button>
      </div>
    </>}
  </section>;
}

function DailyCashClosing({ revision, user, children, onClosed }) {
  const [date, setDate] = useState(localDate().slice(0, 10));
  const [summary, setSummary] = useState(null);
  const [closings, setClosings] = useState([]);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(0);
  const isOwner = user.role === "dono";
  const [pdfBusy, setPdfBusy] = useState("");
  const [movementType,setMovementType] = useState("sangria");
  const [movementAmount,setMovementAmount] = useState("");
  const [movementReason,setMovementReason] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      api(`/cash/daily?date=${encodeURIComponent(date)}`),
      isOwner ? api("/cash/closings") : Promise.resolve({closings:[]})
    ]).then(([day, history]) => {
      if (!active) return;
      setSummary(day);
      setClosings(history.closings);
      setCounted(((day.closing?.countedCashCents ?? day.expectedDrawerCashCents) / 100).toFixed(2));
      setError("");
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [date, updated, revision, isOwner]);
  const parseCash = (value) => {
    const text = String(value).trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const cents = Math.round(Number(text) * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  };
  const downloadPdf = async (id, cashDate) => {
    setPdfBusy(id); setError("");
    try {
      const blob = await api(`/cash/closings/${encodeURIComponent(id)}/pdf`);
      if (!(blob instanceof Blob) || (blob.type && !blob.type.includes("pdf")))
        throw new Error("Não foi possível obter o arquivo PDF.");
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `fechamento-caixa-${cashDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
    } catch (err) { setError(err.message); }
    finally { setPdfBusy(""); }
  };
  const recordMovement = async () => {
    const cents = parseCash(movementAmount);
    if (cents === null || cents <= 0) return setError("Informe um valor positivo.");
    if (movementReason.trim().length < 5) return setError("Informe o motivo (mínimo de 5 caracteres).");
    if (!await confirmAction(`Registrar ${movementType} de ${money(cents)}?`)) return;
    setBusy(true);setError("");
    try {
      await api("/cash/movements", {method:"POST",body:{
        type:movementType, amountCents:cents, reason:movementReason.trim()
      }});
      setMovementAmount("");setMovementReason("");setUpdated(n=>n+1);
    } catch(err) {setError(err.message);} finally {setBusy(false);}
  };
  const closeDay = async () => {
    const countedCashCents = parseCash(counted);
    if (countedCashCents === null) {
      setError("Informe o valor em dinheiro contado, com até duas casas decimais."); return;
    }
    if (!await confirmAction(`Confirmar fechamento de ${date}? O registro ficará bloqueado para edição.`)) return;
    setBusy(true); setError("");
    try {
      await api("/cash/closings", {method:"POST", body:{date, countedCashCents, notes}});
      setUpdated(n => n + 1);
      setNotes("");
      onClosed();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const methods = summary?.closing?.methods || summary?.methods || {};
  return <>
  <section className="panel management-panel cash-daily premium-cash-daily" id="caixa-do-dia">
    <div className="panel-heading cash-daily-heading">
      <div><p className="eyebrow">CONFERÊNCIA DIÁRIA</p><h2>{summary?.today && date !== summary.today ? "Caixa da data selecionada" : "Caixa de hoje"}</h2>
        <p className="panel-subtitle">Recebimentos da data selecionada, antes das comissões. A gaveta inclui apenas dinheiro físico, saldo inicial e movimentações.</p></div>
      <input className="input" type="date" aria-label="Data do caixa" value={date}
        max={summary?.today || localDate().slice(0,10)} min={!isOwner ? (summary?.today || localDate().slice(0,10)) : undefined} onChange={e => { if (e.target.value) { setDate(e.target.value); setSummary(null); setNotes(""); } }}/>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    {!summary ? <p className="report-empty">Carregando o caixa...</p> : <>
      <div className="stats-grid finance-stats">
        <StatCard title="Clientes pagaram nesta data" value={money(summary.closing?.expectedTotalCents ?? summary.expectedTotalCents)} note={`${summary.closing?.receiptCount ?? summary.receiptCount} recebimento(s) · todas as formas`} icon={Wallet} tone="green"/>
        <StatCard title="Dinheiro esperado na gaveta" value={money(summary.closing ? summary.closing.openingCashCents + summary.closing.expectedCashCents + (summary.closing.supplyCents || 0) - (summary.closing.withdrawalCents || 0) : summary.expectedDrawerCashCents)} note="Saldo inicial + dinheiro recebido + suprimentos − sangrias" icon={CircleDollarSign} tone="blue"/>
        <StatCard title="Situação" value={summary.cashState === "closed" ? "Fechado" : summary.opening ? "Aberto" : "Não aberto"} note={summary.closing ? `Por ${summary.closing.closedByName}` : summary.opening ? `Por ${summary.opening.openedByName}` : "Registre a abertura"} icon={CheckCheck} tone={summary.cashState === "closed" ? "green" : "orange"}/>
      </div>
      <section className="cash-method-overview" aria-label="Resumo por forma de pagamento">
        <h3>Total por forma de pagamento</h3>
        <div className="cash-method-grid">{Object.entries(paymentNames).map(([key,label])=><div key={key} className="cash-method-tile"><Wallet size={19}/><small>{label}</small><b>{money(methods[key]||0)}</b></div>)}</div>
      </section>
      {summary.opening && <div className="panel" style={{marginTop:16}}>
        <b>Abertura registrada por {summary.opening.openedByName}</b>
        <p className="panel-subtitle">Saldo inicial em espécie: {money(summary.opening.openingCashCents)} · {cashTimestamp(summary.opening.openedAt, summary.timezone)}</p>
        {summary.opening.notes && <p className="panel-subtitle">{summary.opening.notes}</p>}
      </div>}

      <section className="cash-detail-section" id="pagamentos-do-dia">
        <div className="panel-heading"><div><h3>Pagamentos registrados</h3>
          <p className="panel-subtitle">Recebimentos de {dateLabel(date)}.</p></div></div>
        {summary.receipts.length ? <div className="management-list">
          {summary.receipts.map(item => <article className="service-row cash-payment-row" key={item.id}>
            <span className="service-row-icon"><Check size={18}/></span>
            <div className="cash-payment-info"><b>{item.clientName} · {item.serviceName}</b>
              <small>{["product_sale","package_sale"].includes(item.bookingSource)?"Vendedor":"Profissional"}: {item.professionalName}</small>
              <small>{item.bookingSource==="package_sale"?"Venda antecipada de pacote":item.bookingSource==="product_sale"?"Venda de produtos":item.bookingSource === "direct" ? "Registro direto" : `Agendado: ${dateTimeLabel(item.startsAt)}`}{item.completedOn ? ` · Realizado: ${dateLabel(item.completedOn)}` : ""}{item.paidAt ? ` · Recebido: ${cashTimestamp(item.paidAt, summary.timezone)}` : item.paidOn ? ` · Recebido: ${dateLabel(item.paidOn)}` : ""}</small></div>
            <span className="cash-method-chip">{paymentNames[item.paymentMethod] || item.paymentMethod}</span>
            <strong>{money(item.priceCents)}</strong>
          </article>)}
        </div> : <p className="report-empty">Nenhum pagamento registrado nesta data.</p>}
      </section>

      {summary.cashState === "open" && date === summary.today && <div className="panel cash-movement-panel">
        <h3>Movimentação em espécie</h3>
        <p className="panel-subtitle">Sangria é retirada; suprimento é entrada de troco. Nenhum dos dois é faturamento.</p>
        <div className="cash-form-grid">
          <label className="field" htmlFor="cash-movement-type"><span className="field-label">Tipo</span>
          <select className="input" id="cash-movement-type" value={movementType}
            onChange={e=>setMovementType(e.target.value)}>
            <option value="sangria">Sangria — retirada</option>
            <option value="suprimento">Suprimento — entrada</option>
          </select></label>
          <label className="field" htmlFor="cash-movement-amount"><span className="field-label">Valor (R$)</span>
          <input id="cash-movement-amount" className="input" inputMode="decimal"
            value={movementAmount} onChange={e=>setMovementAmount(e.target.value)} placeholder="0,00"/></label>
          <label className="field cash-form-wide" htmlFor="cash-movement-reason"><span className="field-label">Motivo</span>
          <input id="cash-movement-reason" className="input" maxLength={250} value={movementReason}
            onChange={e=>setMovementReason(e.target.value)} placeholder="Ex.: retirada para depósito"/></label>
        </div>
        <Button disabled={busy} onClick={recordMovement}>Registrar movimentação</Button>
      </div>}
      <div className="management-list cash-detail-section">
        <h3>Movimentações registradas</h3>
        <div className="service-row"><b>Suprimentos</b>
          <strong>{money(summary.closing?.supplyCents ?? summary.supplyCents ?? 0)}</strong></div>
        <div className="service-row"><b>Sangrias</b>
          <strong>{money(summary.closing?.withdrawalCents ?? summary.withdrawalCents ?? 0)}</strong></div>
        {(summary.movements || []).map(movement => <article className="service-row" key={movement.id}>
          <div className="min-w-0 flex-1">
            <b>{movement.type === "sangria" ? "Sangria" : "Suprimento"} · {movement.createdByName}</b>
            <small>{movement.reason} · {cashTimestamp(movement.createdAt, summary.timezone)}</small>
          </div>
          <strong>{money(movement.amountCents)}</strong>
        </article>)}
      </div>
      {summary.cashState === "closed" && !summary.closing ? <p className="panel-subtitle">Caixa encerrado. Histórico e PDF exclusivos do administrador.</p> : summary.closing ? <div className="panel" style={{marginTop:16}}>
        <b>Fechado por {summary.closing.closedByName}</b>
        <p className="panel-subtitle">Saldo inicial: {money(summary.closing.openingCashCents)} · Dinheiro recebido: {money(summary.closing.expectedCashCents)}</p>
        {isOwner && <Button variant="secondary" onClick={()=>downloadPdf(summary.closing.id,date)}><Download size={16}/> Baixar PDF deste fechamento</Button>}
        <p className="panel-subtitle">Dinheiro contado: {money(summary.closing.countedCashCents)} · Diferença: {money(summary.closing.differenceCents)}</p>
        {summary.closing.notes && <p className="panel-subtitle">Observação: {summary.closing.notes}</p>}
      </div> : summary.opening ? <>
        <div className="cash-form-grid cash-detail-section premium-cash-close-form">
          <div className="cash-form-wide"><h3>Conferência final do caixa</h3><p className="panel-subtitle">Confira o dinheiro físico antes de encerrar a data. O fechamento bloqueia alterações.</p></div>
          <label className="field" htmlFor="counted-cash"><span className="field-label">Dinheiro contado (R$)</span>
          <input id="counted-cash" className="input" inputMode="decimal"
            value={counted} onChange={e => setCounted(e.target.value)} placeholder="0,00"/></label>
          <label className="field" htmlFor="cash-notes"><span className="field-label">Observações da conferência</span>
          <textarea id="cash-notes" className="input" maxLength={500} value={notes}
            onChange={e => setNotes(e.target.value)} placeholder="Informe uma justificativa se houver diferença no dinheiro contado."/></label>
        </div>
        <Button disabled={busy || date > (summary.today || date)} onClick={closeDay}>
          {busy ? "Fechando..." : "Confirmar fechamento do dia"}
        </Button>
      </> : <p className="panel-subtitle">Abra o caixa do dia para habilitar o fechamento.</p>}
    </>}
  </section>
    {children}
    {isOwner && <section className="panel management-panel finance-ledger" id="historico-do-caixa">
    <div className="panel-heading"><div><h2>Histórico de fechamentos</h2><p className="panel-subtitle">Últimos 60 fechamentos registrados.</p></div></div>
    {closings.length ? <div className="management-list">{closings.map(item =>
      <article className="service-row" key={item.id}>
        <span className="service-row-icon"><Check size={18}/></span>
        <div className="min-w-0 flex-1"><b>{dateLabel(item.cashDate)} · {item.closedByName}</b>
          <small>{item.receiptCount} recebimento(s) · Diferença: {money(item.differenceCents)}</small></div>
        <strong>{money(item.expectedTotalCents)}</strong>
        <Button variant="secondary" onClick={()=>downloadPdf(item.id,item.cashDate)}><Download size={15}/> PDF</Button>
      </article>)}</div> : <p className="report-empty">Ainda não existem fechamentos registrados.</p>}
    <p className="panel-subtitle">Recebimentos antigos sem data registrada não entram automaticamente na conferência diária.</p>
    </section>}
  </>;
}

function FinancialHubPage({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedTab = new URLSearchParams(location.search).get("aba") || "caixa";
  const available = ["caixa", "despesas", "comissoes", "regras", "fechamentos"];
  const tab = requestedTab === "pendentes" ? "pendentes" : user.role === "dono" && available.includes(requestedTab) ? requestedTab : "caixa";
  const tabs = [
    {id:"caixa",title:"Caixa e recebimentos",icon:Wallet},
    {id:"despesas",title:"Despesas e contas a pagar",icon:CircleDollarSign},
    {id:"comissoes",title:"Lançamentos dos profissionais",icon:CircleDollarSign},
    {id:"regras",title:"Regras de comissão",icon:Settings},
    {id:"fechamentos",title:"Fechamentos quinzenais",icon:CalendarDays},
  ];
  return <div className="premium-finance">
    {user.role === "dono" && <>
      <PageTitle eyebrow="CENTRAL FINANCEIRA" title="Gestão financeira"
        description="Caixa, despesas, comissões e fechamentos em um único lugar." />
      <div className="settings-tab-bar premium-finance-tabs" role="tablist" aria-label="Seções da gestão financeira">
        {tabs.map(item => <button key={item.id} type="button" role="tab"
          aria-selected={tab === item.id || (tab === "pendentes" && item.id === "caixa")} className={tab === item.id || (tab === "pendentes" && item.id === "caixa") ? "active" : ""}
          onClick={() => navigate(`/recebimentos?aba=${item.id}`)}>
          <span className="finance-tab-icon"><item.icon size={21}/></span><span>{item.title}</span><ChevronRight size={15} className="finance-tab-arrow"/>
        </button>)}
      </div>
    </>}
    {tab === "caixa" && <ReceivablesPage user={user}/>}
    {tab === "pendentes" && <PendingPaymentsPage user={user}/>}
    {tab === "despesas" && user.role === "dono" && <ExpensesPage/>}
    {tab === "comissoes" && user.role === "dono" && <TeamCommissionsPage user={user}/>}
    {tab === "regras" && user.role === "dono" && <CommissionPoliciesPage/>}
    {tab === "fechamentos" && user.role === "dono" && <SettlementsPage/>}
  </div>;
}

function BenefitActions({appointment,onSaved}){
  const [data,setData]=useState(null),[purchase,setPurchase]=useState(""),[method,setMethod]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{let alive=true;setData(null);if(appointment.clientId&&appointment.serviceId)api("/packages/eligible?clientId="+encodeURIComponent(appointment.clientId)+"&serviceId="+encodeURIComponent(appointment.serviceId)).then(d=>{if(alive)setData(d);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[appointment.clientId,appointment.serviceId]);
  const eligible=data?.loyalty?.enabled&&data.loyalty.balance>=data.loyalty.threshold&&appointment.status==="concluido"&&data.loyalty.discountCents<appointment.priceCents;
  const redeem=async(kind)=>{
    if(busy)return;
    const message=kind==="package"?"Confirma que o serviço foi realizado? Uma sessão será utilizada sem novo recebimento.": "Confirmar recebimento de "+money(appointment.priceCents-data.loyalty.discountCents)+" com desconto de fidelidade?";
    if(!await confirmAction(message))return;
    setBusy(true);setError("");
    try{await api(kind==="package"?"/packages/redeem/appointment/"+appointment.id:"/loyalty/redeem/"+appointment.id,{method:"POST",body:kind==="package"?{purchaseId:purchase}:{paymentMethod:method}});await onSaved();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  if(!data?.purchases?.length&&!eligible&&!error)return null;
  return <div className="booking-share-notice benefit-actions"><b>Benefícios do cliente</b>
    {!!data?.purchases?.length&&<><SelectField label="Utilizar pacote" value={purchase} onChange={e=>setPurchase(e.target.value)}><option value="">Selecione um pacote</option>{data.purchases.map(p=><option value={p.id} key={p.id}>{p.packageName} · {p.items.find(i=>i.serviceId===appointment.serviceId).sessions-p.items.find(i=>i.serviceId===appointment.serviceId).used} restante(s)</option>)}</SelectField><Button type="button" disabled={!purchase||busy} onClick={()=>redeem("package")}>Concluir com pacote</Button></>}
    {eligible&&<><small>Fidelidade: {data.loyalty.balance} pontos · desconto de {money(data.loyalty.discountCents)} · receber {money(appointment.priceCents-data.loyalty.discountCents)}</small><SelectField label="Pagamento com desconto" value={method} onChange={e=>setMethod(e.target.value)}><option value="">Selecione</option>{Object.entries(paymentNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SelectField><Button type="button" disabled={!method||busy} onClick={()=>redeem("loyalty")}>Resgatar e receber</Button></>}
    <ErrorMessage>{error}</ErrorMessage></div>;
}
function PackagesPage({user}){
  const owner=user.role==="dono";
  const [data,setData]=useState(null),[services,setServices]=useState([]),[error,setError]=useState(""),[revision,setRevision]=useState(0),[tab,setTab]=useState("catalogo"),[modal,setModal]=useState(null),[search,setSearch]=useState("");
  const refresh=()=>setRevision(n=>n+1);
  useEffect(()=>{let alive=true;setData(null);setError("");Promise.all([api("/packages"),api("/services")]).then(([d,s])=>{if(alive){setData(d);setServices(s.services);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[revision]);
  const toggle=async p=>{try{await api("/packages/"+p.id+"/status",{method:"POST",body:{active:!p.active}});refresh();}catch(e){setError(e.message);}};
  const active=data?.purchases.filter(p=>p.expiresOn>=data.today&&p.items.some(i=>i.used<i.sessions))||[];
  const match=name=>String(name).toLowerCase().includes(search.toLowerCase());
  return <div className="expenses-page">
    <PageTitle eyebrow="RELACIONAMENTO E RECORRÊNCIA" title="Pacotes e fidelização" description="Venda sessões antecipadas, acompanhe utilizações e recompense clientes." actions={<>{owner&&<Button onClick={()=>setModal({mode:"edit"})}><Plus size={16}/> Criar pacote</Button>}<Button variant="secondary" onClick={refresh}>Atualizar</Button></>}/>
    <ErrorMessage>{error}</ErrorMessage>
    {!data?!error&&<Loading label="Carregando pacotes..."/>:<>
    <section className="stats-grid finance-stats"><StatCard title="Pacotes disponíveis" value={data.packages.filter(p=>p.active).length} icon={Package}/><StatCard title="Pacotes de clientes ativos" value={active.length} icon={Users} tone="green"/><StatCard title="Sessões utilizadas" value={data.redemptions.length} icon={CheckCheck}/><StatCard title="Clientes com recompensa" value={data.loyalty.enabled?data.clients.filter(c=>c.balance>=data.loyalty.threshold).length:0} icon={Sparkles} tone="purple"/></section>
    <div className="settings-tab-bar" role="tablist" aria-label="Pacotes e fidelização">{[["catalogo","Catálogo"],["compras","Pacotes adquiridos"],["historico","Utilizações"],["fidelidade","Fidelidade"]].map(([k,v])=><button key={k} role="tab" type="button" aria-selected={tab===k} className={tab===k?"active":""} onClick={()=>{setTab(k);setSearch("");}}>{v}</button>)}</div>
    <section className="panel expense-list">
      {tab==="catalogo"&&<><div className="panel-heading"><div><h2>Catálogo de pacotes</h2><p className="panel-subtitle">Edições afetam somente vendas futuras.</p></div></div>{data.packages.map(p=><div className="expense-row" key={p.id}><div className="expense-row-details"><b>{p.name}</b><small>{p.items.map(i=>i.sessions+" × "+i.serviceName).join(" · ")}</small><small>{p.validityDays} dias · Valor avulso: {money(p.items.reduce((s,i)=>s+i.referenceCents*i.sessions,0))}</small></div><div className="expense-row-money"><strong>{money(p.priceCents)}</strong><span className={"expense-status "+(p.active?"pago":"cancelado")}>{p.active?"Ativo":"Inativo"}</span></div><div className="expense-row-actions">{p.active&&<Button onClick={()=>setModal({mode:"sale",item:p})}>Vender pacote</Button>}{owner&&<><Button variant="secondary" onClick={()=>setModal({mode:"edit",item:p})}>Editar</Button><Button variant="secondary" onClick={()=>toggle(p)}>{p.active?"Desativar":"Ativar"}</Button></>}</div></div>)}{!data.packages.length&&<EmptyState icon={Package} title="Nenhum pacote cadastrado" description="Crie um pacote para oferecer serviços antecipados."/>}</>}
      {tab==="compras"&&<><h2>Pacotes adquiridos por clientes</h2><Field label="Buscar cliente ou pacote" value={search} onChange={e=>setSearch(e.target.value)}/>{data.purchases.filter(p=>match(p.clientName+" "+p.packageName)).map(p=><div className="expense-row" key={p.id}><div className="expense-row-details"><b>{p.clientName} · {p.packageName}</b><small>Compra: {dateLabel(p.paidOn)} · Validade: {dateLabel(p.expiresOn)}</small>{p.items.map(i=><small key={i.serviceId}>{i.serviceName}: {i.sessions-i.used} sessão(ões) disponível(is) / {i.sessions}</small>)}</div><div className="expense-row-money"><strong>{money(p.priceCents)}</strong><span className={"expense-status "+(p.expiresOn<data.today?"vencido":"pago")}>{p.expiresOn<data.today?"Vencido":p.items.every(i=>i.used===i.sessions)?"Utilizado":"Ativo"}</span></div></div>)}{!data.purchases.length&&<EmptyState icon={Users} title="Nenhuma compra" description="As vendas de pacotes aparecerão aqui."/>}</>}
      {tab==="historico"&&<><h2>Histórico de sessões utilizadas</h2>{data.redemptions.map(r=><div className="expense-row" key={r.appointmentId}><div className="expense-row-details"><b>{r.clientName} · {r.serviceName}</b><small>{r.packageName} · {r.professionalName} · {dateLabel(r.redeemedOn)}</small></div><strong>{money(r.amountCents)}</strong></div>)}{!data.redemptions.length&&<EmptyState icon={CheckCheck} title="Nenhuma sessão utilizada" description="Utilize os pacotes pela agenda ou pagamentos pendentes."/>}</>}
      {tab==="fidelidade"&&<><div className="panel-heading"><div><h2>Programa de fidelidade</h2><p className="panel-subtitle">Um ponto por atendimento concluído e recebido (incluindo sessões de pacotes). O saldo considera o histórico de atendimentos pagos.</p><p className="panel-subtitle">{data.loyalty.enabled?"Ativo":"Desativado"} · {data.loyalty.threshold} pontos = {money(data.loyalty.discountCents)} de desconto</p></div>{owner&&<Button variant="secondary" onClick={()=>setModal({mode:"loyalty",item:data.loyalty})}>Configurar</Button>}</div><Field label="Buscar cliente" value={search} onChange={e=>setSearch(e.target.value)}/>{[...data.clients].sort((a,b)=>b.balance-a.balance).filter(c=>match(c.name)).map(c=><div className="expense-row" key={c.id}><div className="expense-row-details"><b>{c.name}</b><small>{c.earned} acumulados · {c.spent} resgatados</small></div><strong>{c.balance} pontos</strong></div>)}<h3>Histórico de recompensas</h3>{data.rewards.map(r=><div className="expense-row" key={r.appointmentId}><div className="expense-row-details"><b>{r.clientName}</b><small>{dateLabel(r.redeemedOn)} · {r.points} pontos</small></div><strong>{money(r.discountCents)} desconto</strong></div>)}</>}
    </section></>}
    {modal&&data&&<PackageForm {...modal} services={services} clients={data.clients} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);refresh();}}/>}
  </div>;
}
function PackageForm({mode,item,services,clients,onClose,onSaved}){
  const [form,setForm]=useState({name:item?.name||"",price:(item?.priceCents||0)/100,validityDays:item?.validityDays||30,serviceId:"",sessions:1,clientId:"",paymentMethod:"",enabled:!!item?.enabled,threshold:item?.threshold||10,discount:(item?.discountCents||1000)/100});
  const [items,setItems]=useState(item?.items||[]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [requestId]=useState(()=>globalThis.crypto?.randomUUID?.()||Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join(""));
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const add=()=>{const s=services.find(s=>s.id===form.serviceId),n=Number(form.sessions);if(!s||!Number.isSafeInteger(n)||n<1||n>100){setError("Selecione um serviço e de 1 a 100 sessões.");return;}setItems(prev=>[...prev.filter(i=>i.serviceId!==s.id),{serviceId:s.id,serviceName:s.name,sessions:n,referenceCents:s.priceCents}]);setError("");};
  const submit=async e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");try{
    if(mode==="sale")await api("/packages/"+item.id+"/sell",{method:"POST",body:{requestId,clientId:form.clientId,paymentMethod:form.paymentMethod,priceCents:item.priceCents}});
    else if(mode==="loyalty")await api("/loyalty/settings",{method:"PUT",body:{enabled:form.enabled,threshold:Number(form.threshold),discountCents:Math.round(Number(form.discount)*100)}});
    else await api("/packages"+(item?"/"+item.id:""),{method:item?"PATCH":"POST",body:{name:form.name,priceCents:Math.round(Number(form.price)*100),validityDays:Number(form.validityDays),items,active:item?!!item.active:true}});
    onSaved();
  }catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal title={mode==="sale"?"Vender pacote":mode==="loyalty"?"Configurar fidelidade":item?"Editar pacote":"Criar pacote"} onClose={()=>{if(!busy)onClose();}}><form className="expense-form" onSubmit={submit}>
    {mode==="sale"?<><p className="booking-share-notice">{item.name} · {money(item.priceCents)} · {item.validityDays} dias</p><SelectField label="Cliente" required value={form.clientId} onChange={e=>set("clientId",e.target.value)}><option value="">Selecione</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</SelectField><SelectField label="Forma de pagamento" required value={form.paymentMethod} onChange={e=>set("paymentMethod",e.target.value)}><option value="">Selecione</option>{Object.entries(paymentNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SelectField><p className="panel-subtitle">Registre somente após receber o valor integral. As sessões serão baixadas na agenda ou no caixa sem cobrar novamente.</p></>:mode==="loyalty"?<><label className="field"><span><input type="checkbox" checked={form.enabled} onChange={e=>set("enabled",e.target.checked)}/> Habilitar resgate de recompensas</span></label><Field label="Pontos necessários" type="number" required min="1" max="1000" step="1" value={form.threshold} onChange={e=>set("threshold",e.target.value)}/><Field label="Desconto (R$)" type="number" required min=".01" step=".01" value={form.discount} onChange={e=>set("discount",e.target.value)}/><p className="panel-subtitle">O desconto deve ser menor que o valor do atendimento. A comissão considera o valor efetivamente recebido.</p></>:<>
      <Field label="Nome do pacote" required maxLength={120} value={form.name} onChange={e=>set("name",e.target.value)}/><div className="expense-form-grid"><Field label="Preço do pacote (R$)" type="number" min=".01" step=".01" required value={form.price} onChange={e=>set("price",e.target.value)}/><Field label="Validade (dias)" type="number" min="1" max="3650" step="1" required value={form.validityDays} onChange={e=>set("validityDays",e.target.value)}/></div><SelectField label="Serviço incluído" value={form.serviceId} onChange={e=>set("serviceId",e.target.value)}><option value="">Selecione</option>{services.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name} · {money(s.priceCents)}</option>)}</SelectField><div className="expense-form-grid"><Field label="Sessões" type="number" min="1" max="100" step="1" value={form.sessions} onChange={e=>set("sessions",e.target.value)}/><Button type="button" variant="secondary" onClick={add}>Adicionar serviço</Button></div>{items.map(i=><div className="expense-row" key={i.serviceId}><b>{i.sessions} × {i.serviceName}</b><Button type="button" variant="secondary" onClick={()=>setItems(prev=>prev.filter(p=>p.serviceId!==i.serviceId))}>Remover</Button></div>)}<small>Valor avulso: {money(items.reduce((s,i)=>s+i.sessions*i.referenceCents,0))}. A edição não altera pacotes já vendidos.</small>
    </>}<ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy||mode==="edit"&&!items.length}>{busy?"Salvando...":mode==="sale"?"Confirmar venda":"Salvar"}</Button></div></form></Modal>;
}
const inventoryPurposes={venda:"Venda",consumo:"Uso interno",ambos:"Venda e uso interno"};
const inventoryTypes={entrada:"Entrada",saida:"Saída",ajuste:"Ajuste de saldo",consumo:"Consumo interno",venda:"Venda"};
function InventoryPage({user}){
  const owner=user.role==="dono",location=useLocation(),navigate=useNavigate();
  const tab=new URLSearchParams(location.search).get("aba")||"produtos";
  const [month,setMonth]=useState(localDate().slice(0,7)),[data,setData]=useState(null),[error,setError]=useState(""),[rev,setRev]=useState(0),[search,setSearch]=useState(""),[modal,setModal]=useState(null);
  useEffect(()=>{let active=true;setData(null);setError("");api("/inventory?month="+month).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[month,rev]);
  const products=data?.products||[],low=products.filter(p=>p.quantity<=p.minimum);
  return <div className="expenses-page inventory-page">
    <PageTitle eyebrow="GESTÃO DE PRODUTOS" title="Estoque e produtos" description="Controle materiais, vendas e saldos de estoque." actions={<>{owner&&<Button variant="secondary" onClick={()=>setModal({mode:"product"})}><Plus size={16}/> Novo produto</Button>}<Button onClick={()=>setModal({mode:"sale"})}><Package size={16}/> Registrar venda</Button></>}/>
    <div className="panel expense-filters"><Field label="Mês do histórico" type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/><Button variant="secondary" onClick={()=>setRev(n=>n+1)}>Atualizar</Button></div>
    <ErrorMessage>{error}</ErrorMessage>
    {!data?!error&&<Loading label="Carregando estoque..."/>:<>
      <section className="stats-grid finance-stats"><StatCard title="Produtos cadastrados" value={products.length} icon={Package}/><StatCard title="Estoque mínimo" value={low.length} note="Produtos no limite ou abaixo" icon={Clock3} tone="orange"/><StatCard title="Vendas no mês" value={data.sales.length} icon={Wallet} tone="green"/>{owner&&<StatCard title="Margem bruta estimada" value={money(data.summary.marginCents)} icon={CircleDollarSign} note="Receita menos custo dos produtos vendidos"/>}</section>
      <div className="settings-tab-bar" role="tablist" aria-label="Estoque">{[["produtos","Produtos"],["movimentos","Movimentações"],["vendas","Vendas registradas"]].map(([key,label])=><button type="button" role="tab" key={key} aria-selected={tab===key} className={tab===key?"active":""} onClick={()=>navigate("/estoque?aba="+key)}>{label}</button>)}</div>
      {tab==="produtos"&&<section className="panel expense-list"><div className="panel-heading"><div><h2>Catálogo e saldo atual</h2><p className="panel-subtitle">As movimentações de estoque não registram pagamentos a fornecedores; lance essas despesas no financeiro.</p></div></div><Field label="Buscar produto" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome ou categoria"/>
        {products.filter(p=>(p.name+" "+p.category).toLowerCase().includes(search.toLowerCase())).map(p=><div className="expense-row" key={p.id}><div className="expense-row-details"><b>{p.name}</b><small>{p.category||"Sem categoria"} · {inventoryPurposes[p.purpose]}</small><small>Venda: {money(p.priceCents)} por {p.unit}{owner?" · Custo: "+money(p.costCents)+" por "+p.unit:""}</small></div><div className="expense-row-money"><strong>{p.quantity} {p.unit}</strong><span className={p.quantity<=p.minimum?"expense-status vencido":"expense-status pago"}>{p.quantity<=p.minimum?"Estoque baixo":"Disponível"}</span><small>Mínimo: {p.minimum}</small></div><div className="expense-row-actions">{(owner||p.purpose!=="venda")&&<Button onClick={()=>setModal({mode:"movement",product:p})}>Movimentar</Button>}{owner&&<Button variant="secondary" onClick={()=>setModal({mode:"product",product:p})}>Editar</Button>}</div></div>)}
        {!products.length&&<EmptyState icon={Package} title="Nenhum produto cadastrado" description="Cadastre materiais e produtos para iniciar o controle."/>}</section>}
      {tab==="movimentos"&&<section className="panel expense-list"><h2>Histórico de movimentações</h2>{data.movements.map(m=><div className="expense-row" key={m.id}><div className="expense-row-details"><b>{m.productName} · {inventoryTypes[m.type]}</b><small>{dateLabel(m.movedOn)} · {m.actorName} · {m.reason}</small></div><div className="expense-row-money"><strong>{m.delta>0?"+":""}{m.delta} {m.unit}</strong><small>Saldo: {m.balance} {m.unit}</small></div></div>)}{!data.movements.length&&<EmptyState icon={Package} title="Sem movimentações no mês" description="Entradas e saídas aparecerão aqui."/>}</section>}
      {tab==="vendas"&&<section className="panel expense-list"><h2>Vendas registradas</h2><p className="panel-subtitle">Somente vendas efetivamente pagas; não geram comissões de serviços.</p>{data.sales.map(s=><div className="expense-row" key={s.id}><div className="expense-row-details"><b>{s.clientName} · {paymentNames[s.paymentMethod]}</b><small>{s.items.map(i=>i.quantity+" × "+i.name).join(", ")}</small><small>{dateLabel(s.paidOn)} · Registrado por {s.sellerName}</small></div><div className="expense-row-money"><strong>{money(s.totalCents)}</strong>{owner&&<small>Margem: {money(s.totalCents-s.costCents)}</small>}</div></div>)}{!data.sales.length&&<EmptyState icon={Wallet} title="Nenhuma venda no mês" description="Registre uma venda para acompanhar os recebimentos."/>}</section>}
    </>}
    {modal&&<InventoryForm key={modal.mode+String(modal.product?.id)} {...modal} owner={owner} products={products} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);setRev(n=>n+1);}}/>}
  </div>;
}
function InventoryForm({mode,product,owner,products,onClose,onSaved}){
  const [form,setForm]=useState({name:product?.name||"",category:product?.category||"",vendor:product?.vendor||"",purpose:product?.purpose||"ambos",unit:product?.unit||"un",cost:(product?.costCents||0)/100,price:(product?.priceCents||0)/100,minimum:product?.minimum||0,type:owner?"entrada":"consumo",quantity:1,reason:"",clientName:"",paymentMethod:"",productId:""});
  const [cart,setCart]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [requestId]=useState(()=>globalThis.crypto?.randomUUID?.()||Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join(""));
  const set=(k,v)=>setForm(f=>({...f,[k]:v})),close=()=>{if(!busy)onClose();};
  const add=()=>{const p=products.find(p=>p.id===form.productId),n=Number(form.quantity),existing=cart.find(i=>i.productId===p?.id);if(!p||!Number.isSafeInteger(n)||n<=0||n+(existing?.quantity||0)>p.quantity){setError("Confira a quantidade disponível.");return;}setError("");setCart(c=>existing?c.map(i=>i.productId===p.id?{...i,quantity:i.quantity+n}:i):[...c,{productId:p.id,name:p.name,unit:p.unit,priceCents:p.priceCents,quantity:n}]);};
  const total=cart.reduce((s,i)=>s+i.priceCents*i.quantity,0);
  const submit=async e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");try{
    if(mode==="product"){await api("/inventory/products"+(product?"/"+product.id:""),{method:product?"PATCH":"POST",body:{...form,costCents:Math.round(Number(form.cost)*100),priceCents:Math.round(Number(form.price)*100),minimum:Number(form.minimum)}});}
    else if(mode==="movement")await api("/inventory/products/"+product.id+"/movements",{method:"POST",body:{type:form.type,quantity:Number(form.quantity),reason:form.reason}});
    else {if(!cart.length)throw new Error("Adicione pelo menos um produto.");await api("/inventory/sales",{method:"POST",body:{requestId,clientName:form.clientName,paymentMethod:form.paymentMethod,items:cart}});}
    onSaved();
  }catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal title={mode==="sale"?"Registrar venda":mode==="movement"?"Movimentar estoque":product?"Editar produto":"Novo produto"} onClose={close}><form className="expense-form" onSubmit={submit}>
    {mode==="product"?<>
      <Field label="Nome" required maxLength={120} value={form.name} onChange={e=>set("name",e.target.value)}/>
      <Field label="Categoria" maxLength={100} value={form.category} onChange={e=>set("category",e.target.value)}/><Field label="Fornecedor" maxLength={120} value={form.vendor} onChange={e=>set("vendor",e.target.value)}/>
      <div className="expense-form-grid"><SelectField label="Finalidade" value={form.purpose} onChange={e=>set("purpose",e.target.value)}>{Object.entries(inventoryPurposes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SelectField><SelectField label="Unidade" value={form.unit} onChange={e=>set("unit",e.target.value)}><option value="un">Unidade</option><option value="ml">Mililitro</option><option value="g">Grama</option></SelectField></div>
      <div className="expense-form-grid"><Field label={"Custo por "+form.unit+" (R$)"} type="number" required min="0" step=".01" value={form.cost} onChange={e=>set("cost",e.target.value)}/><Field label={"Preço por "+form.unit+" (R$)"} type="number" required min={form.purpose==="consumo"?"0":".01"} step=".01" value={form.price} onChange={e=>set("price",e.target.value)}/></div><Field label="Estoque mínimo" type="number" required min="0" step="1" value={form.minimum} onChange={e=>set("minimum",e.target.value)}/><p className="panel-subtitle">O saldo inicial é registrado por uma entrada após cadastrar o produto.</p>
    </>:mode==="movement"?<>
      <p className="panel-subtitle">{product.name} · Saldo atual: {product.quantity} {product.unit}</p><SelectField label="Tipo de movimentação" value={form.type} onChange={e=>set("type",e.target.value)}>{Object.entries(inventoryTypes).filter(([k])=>k!=="venda"&&(owner||k==="consumo")&&(k!=="consumo"||product.purpose!=="venda")).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SelectField><Field label={form.type==="ajuste"?"Novo saldo contado":"Quantidade"} type="number" min={form.type==="ajuste"?0:1} step="1" required value={form.quantity} onChange={e=>set("quantity",e.target.value)}/><Field label="Motivo ou serviço realizado" required maxLength={250} value={form.reason} onChange={e=>set("reason",e.target.value)}/>
    </>:<>
      <Field label="Cliente (opcional)" maxLength={120} value={form.clientName} onChange={e=>set("clientName",e.target.value)}/>
      <SelectField label="Produto" value={form.productId} onChange={e=>set("productId",e.target.value)}><option value="">Selecione</option>{products.filter(p=>p.purpose!=="consumo"&&p.quantity>0).map(p=><option value={p.id} key={p.id}>{p.name} · {p.quantity} {p.unit} · {money(p.priceCents)}</option>)}</SelectField><div className="expense-form-grid"><Field label="Quantidade" type="number" min="1" step="1" value={form.quantity} onChange={e=>set("quantity",e.target.value)}/><Button variant="secondary" type="button" onClick={add}>Adicionar item</Button></div>
      {cart.map(i=><div className="expense-row" key={i.productId}><div className="expense-row-details"><b>{i.quantity} {i.unit} · {i.name}</b><small>{money(i.priceCents*i.quantity)}</small></div><Button type="button" variant="secondary" onClick={()=>setCart(c=>c.filter(j=>j.productId!==i.productId))}>Remover</Button></div>)}<strong>Total: {money(total)}</strong>
      <SelectField label="Forma de pagamento" value={form.paymentMethod} required onChange={e=>set("paymentMethod",e.target.value)}><option value="">Selecione</option>{Object.entries(paymentNames).map(([k,v])=><option value={k} key={k}>{v}</option>)}</SelectField><p className="panel-subtitle">Confirme somente após receber. O caixa de hoje deve estar aberto.</p>
    </>}
    <ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" onClick={close} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy}>{busy?"Salvando...":mode==="sale"?"Confirmar venda":"Salvar"}</Button></div>
  </form></Modal>;
}
const expenseCategories = {aluguel:"Aluguel",energia:"Energia",agua:"Água",internet:"Internet",materiais:"Materiais",fornecedores:"Fornecedores",manutencao:"Manutenção",marketing:"Marketing",impostos:"Impostos",outros:"Outros"};
const expensePaymentNames = {...paymentNames,dinheiro:"Dinheiro (fora da gaveta)",cash_drawer:"Dinheiro da gaveta",boleto:"Boleto"};
function CashFlowSummary({ flow }) {
  if (!flow) return null;
  return <section className="panel expense-flow"><div className="panel-heading"><div><p className="eyebrow">REGIME DE CAIXA</p><h2>Entradas e saídas registradas no mês</h2><p className="panel-subtitle">Considera a data real de recebimento ou pagamento. Não representa lucro, saldo bancário ou dinheiro na gaveta.</p></div></div>
    <div className="expense-flow-grid">
      <div><small>Recebimentos de clientes</small><strong>{money(flow.receivedCents)}</strong></div>
      <div><small>Despesas pagas</small><strong>{money(flow.expensesCents)}</strong></div>
      <div><small>Repasses pagos aos profissionais</small><strong>{money(flow.payoutsCents)}</strong></div>
      <div className={flow.balanceCents<0?"expense-negative":"expense-balance"}><small>Saldo das movimentações</small><strong>{money(flow.balanceCents)}</strong></div>
    </div><p className="panel-subtitle">Recebimentos menos despesas pagas e repasses confirmados. Contas em aberto, sangrias e suprimentos não entram diretamente neste cálculo.</p>
  </section>;
}
function ExpensesPage() {
  const [month,setMonth]=useState(localDate().slice(0,7)), [filter,setFilter]=useState("pendente");
  const [data,setData]=useState(null), [error,setError]=useState(""), [revision,setRevision]=useState(0);
  const [modal,setModal]=useState(null), [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;setData(null);setError("");
    api("/expenses?month="+encodeURIComponent(month)).then(result=>{if(active)setData(result);}).catch(err=>{if(active)setError(err.message);});
    return ()=>{active=false;};
  },[month,revision]);
  const refresh=()=>setRevision(n=>n+1);
  const cancel=async item=>{
    if(!await confirmAction("Cancelar a conta "+item.description+"? Ela permanecerá no histórico."))return;
    setBusy(true);setError("");
    try{await api("/expenses/"+item.id+"/cancel",{method:"POST"});refresh();}catch(err){setError(err.message);}finally{setBusy(false);}
  };
  const rows=(data?.expenses||[]).filter(row=>filter==="todos"||row.status===filter);
  return <div className="expenses-page">
    <PageTitle title="Despesas e contas a pagar" description="Organize despesas fixas e variáveis, vencimentos e pagamentos efetivos." actions={<Button onClick={()=>setModal({mode:"edit"})}><Plus size={16}/> Nova despesa</Button>}/>
    <div className="panel expense-filters"><Field label="Mês de referência" type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/><SelectField label="Exibir" value={filter} onChange={e=>setFilter(e.target.value)}><option value="pendente">Contas em aberto</option><option value="pago">Pagas</option><option value="cancelado">Canceladas</option><option value="todos">Todas</option></SelectField><Button variant="secondary" onClick={refresh}>Atualizar</Button></div>
    <ErrorMessage>{error}</ErrorMessage>
    {!data ? !error&&<Loading label="Carregando despesas..."/> : <>
      <section className="stats-grid finance-stats">
        <StatCard title="Contas em aberto" value={money(data.pendingCents)} note="Todos os vencimentos" icon={Wallet} tone="orange"/>
        <StatCard title="Contas vencidas" value={money(data.overdueCents)} note="Ainda não pagas" icon={Clock3} tone="orange"/>
        <StatCard title="Despesas pagas no mês" value={money(data.cashFlow.expensesCents)} note="Data efetiva do pagamento" icon={CheckCheck} tone="green"/>
      </section>
      <section className="panel expense-list"><div className="panel-heading"><div><h2>Contas e histórico</h2><p className="panel-subtitle">Todas as pendências, inclusive futuras, e histórico referente ao vencimento ou pagamento no mês escolhido.</p></div><span className="count-chip">{rows.length} registro(s)</span></div>
        {rows.length===0?<EmptyState icon={Wallet} title="Nenhuma conta nesta seleção" description="Cadastre uma despesa ou altere o filtro."/>:rows.map(item=><div className="expense-row" key={item.id}>
          <div className="expense-row-details"><b>{item.description}</b><small>{expenseCategories[item.category]} · {item.expenseType==="fixa"?"Fixa":"Variável"}{item.vendor?" · "+item.vendor:""}</small><small>Vencimento: {dateLabel(item.dueOn)}{item.paidOn?" · Pago em "+dateLabel(item.paidOn)+" · "+expensePaymentNames[item.paymentMethod]:""}</small>{item.notes&&<small>{item.notes}</small>}</div>
          <div className="expense-row-money"><strong>{money(item.amountCents)}</strong><span className={"expense-status "+(item.status==="pendente"&&item.dueOn<data.today?"vencido":item.status)}>{item.status==="pago"?"Pago":item.status==="cancelado"?"Cancelado":item.dueOn<data.today?"Vencido":"Em aberto"}</span></div>
          {item.status==="pendente"&&<div className="expense-row-actions"><Button onClick={()=>setModal({mode:"pay",item})}>Dar baixa</Button><Button variant="secondary" onClick={()=>setModal({mode:"edit",item})}>Editar</Button><Button variant="secondary" disabled={busy} onClick={()=>cancel(item)}>Cancelar</Button></div>}
        </div>)}
      </section>
      <CashFlowSummary flow={data.cashFlow}/>
    </>}
    {modal&&<ExpenseForm key={modal.mode+String(modal.item?.id)} mode={modal.mode} item={modal.item} today={data?.today||localDate()} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);refresh();}}/>}
  </div>;
}
function ExpenseForm({mode,item,today,onClose,onSaved}) {
  const [form,setForm]=useState({description:item?.description||"",category:item?.category||"outros",expenseType:item?.expenseType||"variavel",vendor:item?.vendor||"",notes:item?.notes||"",amount:item?(item.amountCents/100).toFixed(2):"",dueOn:item?.dueOn||today,paidOn:today,paymentMethod:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const set=(key,value)=>setForm(x=>({...x,[key]:value}));
  const close=()=>{if(!busy)onClose();};
  const submit=async e=>{
    e.preventDefault();if(busy)return;setBusy(true);setError("");
    try {
      if(mode==="pay")await api("/expenses/"+item.id+"/pay",{method:"POST",body:{paidOn:form.paidOn,paymentMethod:form.paymentMethod}});
      else {
        const amountCents=Math.round(Number(form.amount)*100);
        if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error("Informe um valor positivo.");
        await api(item?"/expenses/"+item.id:"/expenses",{method:item?"PATCH":"POST",body:{...form,amountCents}});
      }
      onSaved();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  };
  return <Modal title={mode==="pay"?"Registrar pagamento":item?"Editar despesa":"Nova despesa"} onClose={close}>
    <form className="expense-form" onSubmit={submit}>
      {mode==="pay"?<>
        <p className="panel-subtitle">{item.description} · <b>{money(item.amountCents)}</b></p>
        <SelectField label="Forma de pagamento" required value={form.paymentMethod} onChange={e=>{set("paymentMethod",e.target.value);if(e.target.value==="cash_drawer")set("paidOn",today);}}><option value="">Selecione</option>{Object.entries(expensePaymentNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SelectField>
        <Field label="Data efetiva do pagamento" type="date" required max={today} disabled={form.paymentMethod==="cash_drawer"} value={form.paidOn} onChange={e=>set("paidOn",e.target.value)}/>
        <p className="panel-subtitle">{form.paymentMethod==="cash_drawer"?"A baixa registrará uma sangria no caixa aberto de hoje.":"Pagamentos externos não alteram o dinheiro da gaveta."} Confirme somente se o pagamento já ocorreu.</p>
      </>:<>
        <Field label="Descrição" required maxLength={200} value={form.description} onChange={e=>set("description",e.target.value)} />
        <div className="expense-form-grid"><SelectField label="Categoria" value={form.category} onChange={e=>set("category",e.target.value)}>{Object.entries(expenseCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SelectField><SelectField label="Tipo" value={form.expenseType} onChange={e=>set("expenseType",e.target.value)}><option value="fixa">Fixa</option><option value="variavel">Variável</option></SelectField></div>
        <div className="expense-form-grid"><Field label="Valor (R$)" required type="number" min="0.01" max="1000000000" step="0.01" value={form.amount} onChange={e=>set("amount",e.target.value)}/><Field label="Vencimento" required type="date" value={form.dueOn} onChange={e=>set("dueOn",e.target.value)}/></div>
        <Field label="Fornecedor (opcional)" maxLength={200} value={form.vendor} onChange={e=>set("vendor",e.target.value)}/>
        <Field label="Observações (opcional)"><textarea className="input" maxLength={1000} value={form.notes} onChange={e=>set("notes",e.target.value)}/></Field>
      </>}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" disabled={busy}>{busy?"Salvando...":mode==="pay"?"Confirmar pagamento":"Salvar despesa"}</Button></div>
    </form>
  </Modal>;
}

function ReceivablesPage({ user }) {
  const { pending, loaded, error, refresh } = usePendingPayments();
  const [cashRevision, setCashRevision] = useState(0);
  const [direct, setDirect] = useState(false);
  return <>
    <CashOpeningPanel revision={cashRevision} onOpened={() => setCashRevision(n => n + 1)}/>
    <div className="finance-cash-actions"><div><b>Operação do caixa</b><small>Registre serviços e acompanhe os recebimentos.</small></div><div className="expense-row-actions"><Link className="button button-secondary" to="/estoque?aba=vendas"><Package size={16}/> Vender produtos</Link><Button onClick={() => setDirect(true)}><Plus size={16}/> Registrar serviço</Button></div></div>
    {direct && <AppointmentForm direct user={user} onClose={() => setDirect(false)} onSaved={() => { setDirect(false); refresh(); setCashRevision(n => n + 1); }} />}
    {pending.length > 0 && <Link className="cash-pending-summary cash-pending-link" to={pendingPaymentsPath}>
      <Clock3 size={22}/><div><b>{pending.length} pagamento(s) pendente(s)</b>
        <strong>{money(pending.reduce((sum, item) => sum + item.priceCents, 0))} a receber</strong></div>
      <span className="cash-pending-action">Ver pendências <ArrowRight size={17}/></span>
    </Link>}
    <ErrorMessage>{error}</ErrorMessage>
    <nav className="cash-section-nav" aria-label="Seções de caixa">
      <Link to={pendingPaymentsPath}>Pagamentos pendentes{loaded ? ` (${pending.length})` : ""}</Link><a href="#caixa-do-dia">Caixa de hoje</a><a href="#pagamentos-do-dia">Pagamentos registrados</a>
      {user.role === "dono" && <a href="#historico-do-caixa">Histórico de fechamentos</a>}
    </nav>
    <DailyCashClosing revision={cashRevision} user={user} onClosed={() => setCashRevision(n => n + 1)}>
      <UnreconciledCash user={user} onChange={() => setCashRevision(n => n + 1)}/>
    </DailyCashClosing>
  </>;
}

function PendingPaymentsPage({ user }) {
  const { pending, loaded, error: loadError, refresh } = usePendingPayments();
  const [cashRevision, setCashRevision] = useState(0);
  return <>
    <PageTitle title="Pagamentos pendentes" description="Confirme os recebimentos quando o cliente efetuar o pagamento."
      actions={<Link className="button button-secondary" to="/recebimentos"><ArrowLeft size={16}/> Voltar ao caixa</Link>}/>
    <CashOpeningPanel revision={cashRevision} onOpened={() => setCashRevision(n => n + 1)}/>
    <section className="panel management-panel cash-pending" id="pagamentos-pendentes">
      <PendingPaymentsList user={user} pending={pending} loaded={loaded} loadError={loadError} refresh={refresh}/>
    </section>
  </>;
}

function PendingPaymentsList({ user, pending, loaded, loadError, refresh }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [methods, setMethods] = useState({});
  const receive = async (item) => {
    const method = methods[item.id];
    if (busy) return;
    setError(""); setNotice("");
    if (!method) {
      setNotice(`Pagamento de ${item.clientName} mantido em aberto. Nenhum valor foi lançado no caixa.`);
      return;
    }
    if (!await confirmAction(`Confirmar recebimento de ${money(item.priceCents)} de ${item.clientName} por ${paymentNames[method]}?`)) return;
    setBusy(item.id); setError("");
    try {
      await api(`/receivables/${item.id}/pay`, { method: "POST", body: { paymentMethod: method } });
      await refresh();
      setNotice(`Recebimento de ${item.clientName} confirmado.`);
    } catch (reason) { setError(reason.message); } finally { setBusy(""); }
  };
  return <>
      <div className="panel-heading"><div><h2>Pagamentos pendentes</h2>
        <p className="panel-subtitle">Serviços concluídos que ainda aguardam pagamento, inclusive de dias anteriores.</p></div>
        <Button type="button" variant="secondary" onClick={refresh}>Atualizar</Button>
      </div>
      <div className="cash-pending-summary" role="status"><Clock3 size={22}/><div><b>{loaded ? `${pending.length} pagamento(s) pendente(s)` : "Consultando pagamentos..."}</b>
        <strong>{money(pending.reduce((sum, item) => sum + item.priceCents, 0))} a receber</strong></div></div>
      <ErrorMessage>{error || loadError}</ErrorMessage>
      {notice && <p className="success-message" role="status">{notice}</p>}
      {pending.length ? <div className="management-list">{pending.map(item =>
        <article className="service-row cash-payment-row" key={item.id}>
          <span className="service-row-icon"><CircleDollarSign size={18}/></span>
          <div className="cash-payment-info"><b>{item.clientName} · {item.serviceName}</b>
            <small>Profissional: {item.professionalName}</small>
            <small>{item.bookingSource === "direct" ? "Registro direto" : `Agendado: ${dateTimeLabel(item.startsAt)}`}{item.completedOn ? ` · Realizado: ${dateLabel(item.completedOn)}` : ""}</small></div>
          <strong>{money(item.priceCents)}</strong>
          <label className="field cash-payment-method"><span className="field-label">Forma de pagamento</span>
            <select className="input" value={methods[item.id] || ""} onChange={event => setMethods(previous => ({ ...previous, [item.id]: event.target.value }))}>
              <option value="">Em aberto — pagar depois</option>
              {Object.entries(paymentNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select></label>
          <Button variant={methods[item.id] ? "primary" : "secondary"} disabled={Boolean(busy) || user.tenantId === "tenant-salao-demo"}
            onClick={() => receive(item)}>{busy === item.id ? "Registrando..." : methods[item.id] ? "Receber" : "Manter em aberto"}</Button>
          {user.tenantId!=="tenant-salao-demo"&&<BenefitActions appointment={{...item,status:"concluido"}} onSaved={refresh}/>}
        </article>)}</div> :
        loaded && <p className="report-empty">Nenhum pagamento pendente.</p>}
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
  const labels = { criacao: "Criado", servico_avulso: "Serviço registrado", confirmacao: "Confirmado", cancelamento: "Cancelado",
    remarcacao: "Remarcado", conclusao: "Concluído", pagamento: "Pagamento", conciliacao: "Data do pagamento conciliada", status: "Status alterado",
    edicao: "Editado", comissao: "Comissão ajustada" };
  const detail = event => {
    const before = event.before || {}, after = event.after || {};
    const changes = [
      ["Status", "status"], ["Horário", "startsAt"], ["Valor", "priceCents"],
      ["Pagamento", "paymentMethod"], ["Recebido em", "paidOn"], ["Concluído em", "completedOn"], ["Comissão (%)", "commissionPercent"], ["Taxa estabelecimento (%)", "houseSharePercent"]
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

function ReportDailyChart({ daily }) {
  const [selected,setSelected]=useState("");
  const active=daily.find(row=>row.date===selected) || daily.find(row=>row.date===localDate()) || daily.filter(row=>row.receivedCents||row.productionCents).at(-1) || daily[0];
  const maximum=Math.ceil(Math.max(100,...daily.flatMap(row=>[row.receivedCents,row.productionCents]))/4)*4;
  return <section className="panel report-panel report-daily-chart">
    <div className="panel-heading"><div><p className="eyebrow">EVOLUÇÃO DIÁRIA</p><h2>Recebimentos e produção</h2><p className="panel-subtitle">Recebimentos pela data do pagamento; produção pela data da realização.</p></div></div>
    <div className="report-chart-legend"><span><i className="report-dot received"/> Clientes pagaram</span><span><i className="report-dot production"/> Serviços realizados</span></div>
    {active && <div className="report-day-detail" aria-live="polite"><div><small>Dia selecionado</small><b>{dateLabel(active.date)}</b></div><div><small>Recebimentos</small><b>{money(active.receivedCents)}</b></div><div><small>Produção</small><b>{money(active.productionCents)}</b></div><div><small>Atendimentos realizados</small><b>{active.completedCount}</b></div></div>}
    <div className="report-chart-scroll"><div className="report-chart-frame">
      <div className="report-chart-axis">{[1,.75,.5,.25,0].map(fraction=><span key={fraction}>{money(Math.round(maximum*fraction))}</span>)}</div>
      <div className="report-chart-plot"><div className="report-chart-lines" aria-hidden="true">{Array.from({length:5},(_,i)=><span key={i}/>)}</div><div className="report-chart-bars" style={{"--days":daily.length}}>{daily.map(row=><button type="button" key={row.date} className={`report-chart-day ${row.date===active?.date?"selected":""}`} aria-pressed={row.date===active?.date} aria-label={`${dateLabel(row.date)}: recebimentos ${money(row.receivedCents)}, produção ${money(row.productionCents)}`} title={`${dateLabel(row.date)} · Pagaram ${money(row.receivedCents)} · Produção ${money(row.productionCents)}`} onClick={()=>setSelected(row.date)}>
        <span className="report-chart-pair"><i className="report-bar received" style={{height:`${row.receivedCents/maximum*100}%`}}/><i className="report-bar production" style={{height:`${row.productionCents/maximum*100}%`}}/></span><small>{row.date.slice(-2)}</small>
      </button>)}</div></div>
    </div></div>
    <p className="panel-subtitle">Selecione um dia no gráfico para conferir os valores exatos.</p>
  </section>;
}

function ReportSplit({ report }) {
  const production=report.productionCents||0;
  const commission=report.commissionTotalCents||0;
  const share=report.establishmentShareCents||0;
  const percentage=production>0?commission/production*100:0;
  return <section className="panel report-panel report-split">
    <div className="panel-heading"><div><p className="eyebrow">DISTRIBUIÇÃO DA PRODUÇÃO</p><h2>Comissões e estabelecimento</h2><p className="panel-subtitle">Valores calculados sobre serviços concluídos, não sobre o caixa.</p></div></div>
    <div className="report-split-body"><div role="img" aria-label={`Comissões: ${money(commission)}; parcela do estabelecimento: ${money(share)}`} className="report-donut" style={{background:production?"conic-gradient(#8b5cf6 0% "+percentage+"%,#3976ec "+percentage+"% 100%)":"var(--line)"}}><div><small>Produção</small><strong>{money(production)}</strong></div></div>
      <div className="report-split-values"><div><i className="report-dot commission"/><span><small>Comissões geradas</small><b>{money(commission)}</b></span><strong>{production?percentage.toFixed(1).replace(".",","):"0"}%</strong></div><div><i className="report-dot production"/><span><small>Parcela do estabelecimento</small><b>{money(share)}</b></span><strong>{production?(100-percentage).toFixed(1).replace(".",","):"0"}%</strong></div></div></div>
    <p className="panel-subtitle">A parcela da empresa não representa lucro líquido: outras despesas não estão deduzidas.</p>
  </section>;
}

function FinancePage() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active=true;setReport(null);setError("");
    api(`/reports?month=${encodeURIComponent(month)}`).then(result=>{if(active)setReport(result);}).catch(reason=>{if(active)setError(reason.message);});
    return ()=>{active=false;};
  }, [month]);
  const loaded=report?.month===month;
  const downloadBackup = async () => {
    try {
      const blob = await api("/export/backup");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "simplifica-agenda-backup.sqlite"; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason.message); }
  };
  return <div className="premium-reports">
    <PageTitle eyebrow="INTELIGÊNCIA DO NEGÓCIO" title="Financeiro e relatórios" description="Acompanhe desempenho, recebimentos, serviços e comissões com dados reais do estabelecimento."
      actions={<><a className="button button-secondary" href="/api/export/appointments.csv"><Download size={16} /> Exportar todos atendimentos</a><Button onClick={downloadBackup}><ArrowDownToLine size={16} /> Backup do banco</Button></>} />
    <div className="panel report-period-bar"><div><b>Período de análise</b><small>Os indicadores e gráficos de serviços são referentes ao mês selecionado.</small></div><div className="month-filter"><label htmlFor="report-month">Mês de referência</label><input id="report-month" className="input month-input" type="month" value={month} onChange={(e) => {if(e.target.value)setMonth(e.target.value);}} /></div></div>
    <ErrorMessage>{error}</ErrorMessage>
    {!loaded ? !error&&<Loading label="Carregando relatórios..."/> : <>
    <section className="stats-grid finance-stats">
      <StatCard title="Clientes pagaram no mês" value={money(report?.revenueCents)} note="Data do pagamento · antes dos repasses" icon={CircleDollarSign} tone="green" />
      <StatCard title="Clientes devem" value={money(report?.pendingCents)} note="Serviços realizados neste mês e não pagos" icon={Clock3} tone="orange" />
      <StatCard title="Produção do mês" value={money(report?.productionCents)} note="Serviços realizados, pagos ou não" icon={Scissors}/>
      <StatCard title="Comissões dos profissionais" value={money(report?.commissionTotalCents)} note="Geradas pelos serviços do mês" icon={Wallet} tone="purple"/>
      <StatCard title="Parcela do estabelecimento" value={money(report?.establishmentShareCents)} note="Produção menos comissões; não é lucro" icon={Wallet}/>
      <StatCard title="Atendimentos concluídos" value={report?.completedCount ?? "—"} note="Neste mês" icon={CheckCheck} tone="blue" />
      <StatCard title="Tipos de serviço realizados" value={report?.byService?.length ?? "—"} note="Serviços diferentes, não quantidade de atendimentos" icon={Scissors} tone="purple" />
      <StatCard title="Clientes para reativar" value={report?.inactiveClients?.length ?? "—"} note="Sem voltar há 30 dias ou mais" icon={Users} tone="orange" />
    </section>
    <CashFlowSummary flow={report.cashFlow}/>
    <section className="panel expense-flow"><div className="panel-heading"><div><h2>Pacotes vendidos no mês</h2><p className="panel-subtitle">Recebimento antecipado; sessões utilizadas não são cobradas novamente.</p></div><strong>{money(report.packageRevenueCents)}</strong></div></section>
    {report.productSales&&<section className="panel expense-flow"><div className="panel-heading"><div><h2>Venda de produtos</h2><p className="panel-subtitle">Margem bruta estimada: vendas menos custo registrado no momento da venda, sem despesas ou impostos.</p></div></div><div className="expense-flow-grid"><div><small>Receita de produtos</small><strong>{money(report.productSales.revenueCents)}</strong></div><div><small>Custo dos produtos vendidos</small><strong>{money(report.productSales.costCents)}</strong></div><div><small>Margem bruta estimada</small><strong>{money(report.productSales.marginCents)}</strong></div><div><small>Vendas registradas</small><strong>{report.productSales.count}</strong></div></div></section>}
    <ReportDailyChart key={month} daily={report.daily||[]}/>
    <div className="reports-grid">
      <ReportSplit report={report}/>
      <section className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">ENTRADAS NO CAIXA</p><h2>Formas de pagamento</h2><p className="panel-subtitle">Pagamentos efetivamente registrados no mês.</p></div></div>
        {report.paymentBreakdown?.length ? <div className="report-metric-list">{report.paymentBreakdown.map(item=><div className="report-metric" key={item.method}><div><b>{paymentNames[item.method]||item.method}</b><strong>{money(item.cents)}</strong></div><div className="report-progress"><span className="received" style={{width:`${report.revenueCents?item.cents/report.revenueCents*100:0}%`}}/></div><small>{item.count} recebimento(s) · {report.revenueCents?(item.cents/report.revenueCents*100).toFixed(1).replace(".",","):"0"}%</small></div>)}</div>:<EmptyState icon={Wallet} title="Sem pagamentos no período" description="Os recebimentos registrados aparecerão aqui."/>}
      </section>
    </div>
    <div className="reports-grid">
      <section className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">O QUE MAIS SAI</p><h2>Serviços em destaque</h2></div></div>
        {report?.byService?.length ? <div className="report-metric-list">{report.byService.map((item, index) => <div className="report-metric" key={item.id}><div><b>{String(index+1).padStart(2,"0")} · {item.name}</b><strong>{money(item.revenueCents)}</strong></div><div className="report-progress"><span className="production" style={{width:`${item.count/Math.max(1,...report.byService.map(s=>s.count))*100}%`}}/></div><small>{item.count} atendimento(s) · valor dos serviços realizados</small></div>)}
        </div> : <p className="report-empty">Os serviços realizados aparecerão aqui.</p>}
      </section>
      <section className="panel report-panel"><div className="panel-heading"><div><p className="eyebrow">SEU TIME</p><h2>Comissão gerada por profissional</h2><p className="panel-subtitle">Valores registrados nos serviços concluídos; não são repasses confirmados.</p></div></div>
        {report?.byProfessional?.length ? <div className="report-metric-list">{report.byProfessional.map((item) => <div className="report-metric" key={item.id}><div><b>{item.name}</b><strong>{money(item.commissionCents)}</strong></div><div className="report-progress"><span className="commission" style={{width:`${item.commissionCents/Math.max(1,...report.byProfessional.map(p=>p.commissionCents))*100}%`}}/></div><small>{item.count} atendimento(s) · {money(item.revenueCents)} realizados · {money(item.revenueCents-item.commissionCents)} parcela da empresa</small></div>)}
        </div> : <p className="report-empty">As comissões dos atendimentos concluídos aparecerão aqui.</p>}
      </section>
    </div>
    <section className="panel inactive-panel"><div className="panel-heading"><div><p className="eyebrow">RELACIONAMENTO</p><h2>Clientes para reativar</h2><p className="panel-subtitle">Lista atual de clientes sem visita há 30 dias ou mais, independente do mês selecionado.</p></div><span className="count-chip">{report?.inactiveClients?.length ?? 0} clientes</span></div>
      {report?.inactiveClients?.length ? <div className="inactive-list">{report.inactiveClients.map((client) => <div className="inactive-row" key={client.id}><span className="table-avatar">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
        <div className="min-w-0 flex-1"><b>{client.name}</b><small>Última visita em {dateLabel(client.lastVisit.slice(0, 10))}</small></div>
        {client.phone && <a href={whatsappUrl(client.phone, `Oi, ${client.name}! Sentimos sua falta por aqui 💚 Que tal agendar um novo horário?`)} target="_blank" rel="noreferrer" className="button button-whatsapp"><Phone size={15} /> Chamar no WhatsApp</a>}</div>)}</div>
        : <p className="report-empty">Nenhum cliente sumido por enquanto. Seu relacionamento está em dia! 💚</p>}
    </section>
    <AppointmentAuditReport month={month}/>
    </>}
  </div>;
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
  const savedTheme=useRef(null);
  useEffect(() => {
    let active=true;
    api("/settings").then(data => {
      if(!active)return;
      savedTheme.current=data.settings.theme;
      setSettings(data.settings);
      setHours(data.hours);
      setBooking({ ...data.settings, bookingAllowCancellation: Boolean(data.settings.bookingAllowCancellation) });
    }).catch(reason => {if(active)setError(reason.message);});
    return ()=>{active=false;if(savedTheme.current)document.documentElement.classList.toggle("dark",savedTheme.current==="escuro");};
  }, []);
  const updateHour = (weekday, key, value) =>
    setHours(current => current.map(hour => hour.weekday === weekday ? { ...hour, [key]: value } : hour));
  const save = async event => {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      await api("/settings", { method: "PUT", body: { ...settings, hours } });
      savedTheme.current=settings.theme;
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
    if (!await confirmAction("Remover a logo personalizada e voltar à imagem padrão?")) return;
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
  return <div className="premium-settings">
    <PageTitle eyebrow="PERSONALIZAÇÃO E GESTÃO" title="Configurações do estabelecimento"
      description="Organize os dados comerciais, os horários e a segurança da sua conta." />
    <div className="settings-tab-bar premium-settings-tabs" role="tablist" aria-label="Seções das configurações">
      <button type="button" role="tab" aria-selected={tab === "business"} className={tab === "business" ? "active" : ""}
        onClick={() => { setTab("business"); setError(""); setMessage(""); }}><span className="settings-tab-icon"><Settings size={20}/></span><span>Estabelecimento<small>Identidade e contato</small></span></button>
      <button type="button" role="tab" aria-selected={tab === "hours"} className={tab === "hours" ? "active" : ""}
        onClick={() => { setTab("hours"); setError(""); setMessage(""); }}><span className="settings-tab-icon"><Clock3 size={20}/></span><span>Horários<small>Funcionamento</small></span></button>
      <button type="button" role="tab" aria-selected={tab === "booking"} className={tab === "booking" ? "active" : ""}
        onClick={() => { setTab("booking"); setError(""); setMessage(""); }}><span className="settings-tab-icon"><CalendarClock size={20}/></span><span>Agendamento online<small>Regras de reserva</small></span></button>
      <button type="button" role="tab" aria-selected={tab === "account"} className={tab === "account" ? "active" : ""}
        onClick={() => { setTab("account"); setError(""); setMessage(""); }}><span className="settings-tab-icon"><ShieldCheck size={20}/></span><span>Minha conta<small>Perfil e segurança</small></span></button>
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
          <div className="settings-appearance"><div><p className="eyebrow">PREFERÊNCIAS VISUAIS</p><h3>Aparência do sistema</h3><p className="panel-subtitle">Confira a prévia e salve para aplicar a preferência ao estabelecimento.</p></div>
          <SelectField label="Aparência" value={settings.theme} onChange={event => {
            setSettings({ ...settings, theme: event.target.value });
            document.documentElement.classList.toggle("dark", event.target.value === "escuro");
          }}><option value="claro">Modo claro</option><option value="escuro">Modo escuro</option></SelectField></div>
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
            {hour.opensAt && <><input className="input hours-input" aria-label={`Abertura ${weekdays[hour.weekday]}`} type="time" value={hour.opensAt}
              onChange={event => updateHour(hour.weekday, "opensAt", event.target.value)}/>
              <span>às</span><input className="input hours-input" aria-label={`Fechamento ${weekdays[hour.weekday]}`} type="time" value={hour.closesAt}
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
  </div>;
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
  const [copyNotice,setCopyNotice]=useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsRevision, setSlotsRevision] = useState(0);
  const reloadSlots = () => {
    setSlots([]);
    setTime("");
    setLoadingSlots(true);
    setSlotsRevision((revision) => revision + 1);
  };
  useEffect(() => {
    setData(null); setServiceId(""); setProfessionalId(""); setTime(""); setSlots([]); setError("");setMessage("");setManagementToken("");setCopyNotice("");setClient({name:"",phone:""});setWhatsappOptIn(false);
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
    setLoadingSlots(true);
    api(`/public/${encodeURIComponent(slug)}/slots?serviceId=${encodeURIComponent(serviceId)}&professionalId=${encodeURIComponent(professionalId)}&date=${encodeURIComponent(date)}`)
      .then(({ slots: available }) => { if (active) setSlots(available || []); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [slug, serviceId, professionalId, date, slotsRevision]);
  const service = data?.services.find((item) => item.id === serviceId);
  const professionals = data?.professionals ?? [];
  const professional = professionals.find(person => person.id === professionalId);
  const currentStep=!serviceId?1:!professionalId||!date?2:!time?3:4;
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
    } catch (reason) {
      if (reason.status === 409) {
        reloadSlots();
        setError("Este horário ficou indisponível. Escolha outro horário para continuar.");
      } else {
        setError(reason.message);
      }
    } finally { setLoading(false); }
  };
  if (!data && !error) return <div className="public-page"><Loading /></div>;
  if (error && !data) return <div className="public-page"><div className="public-booking-card"><img className="public-logo" src="/assets/simplifica-perfil.svg" alt="Simplifica Agenda"/><h1>Não encontramos esse estabelecimento</h1><p>{error}</p><p>Confira o link recebido do estabelecimento.</p></div></div>;
  return <main className="public-page premium-public">
    <header className="public-topbar"><div className="public-brand"><img src="/assets/simplifica-perfil.svg" alt=""/>Simplifica <span>Agenda</span></div><span className="public-online-pill"><span/> Agendamento online</span></header>
    <section className="public-booking-card">
      <div className="public-business"><img className="public-business-logo" src={data.business.logoUrl || "/assets/simplifica-perfil.svg"} alt={`Logo de ${data.business.businessName}`}/>
        <div><p className="eyebrow">RESERVE SEU MOMENTO</p><h1>{data.business.businessName}</h1><p className="public-business-intro">Escolha seu serviço e solicite um horário em poucos passos.</p>{data.business.address && <p>{data.business.address}</p>}
          {data.business.whatsapp && <a className="text-link" target="_blank" rel="noreferrer"
            href={whatsappUrl(data.business.whatsapp, "Olá! Gostaria de tirar uma dúvida sobre um agendamento.")}>
            <Phone size={14}/> WhatsApp do estabelecimento</a>}</div>
      </div>
      {slug === "studio-bela-vista" && <p className="public-demo-notice"><Info size={16}/> Esta página é demonstrativa. Reservas reais permanecem desativadas.</p>}
      {message ? <div className="booking-success" role="status"><span><Check size={25} /></span><h2>Horário solicitado!</h2><p>{message}</p>
          {managementToken && <><p>Guarde seu comprovante para consultar, remarcar ou cancelar dentro das regras do estabelecimento.</p>
            <Link to={`/acompanhar/${managementToken}`} className="button button-primary">Ver meu comprovante</Link>
            <Button variant="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.origin+`/acompanhar/${managementToken}`);setCopyNotice("Link copiado.");}catch{setCopyNotice("Abra o comprovante e copie o endereço pelo navegador.");}}}><Copy size={15}/> Copiar link do comprovante</Button>
            {copyNotice&&<p role="status">{copyNotice}</p>}
          </>}
          <Button variant="secondary" onClick={() => { reloadSlots(); setMessage(""); setManagementToken(""); setCopyNotice(""); }}>Fazer outro agendamento</Button></div> :
        <form className="public-form" onSubmit={submit}>
          <div className="public-step-progress" aria-label={`Etapa atual: ${currentStep} de 4`}>{["Serviço","Profissional","Horário","Seus dados"].map((label,i)=><div key={label} data-state={currentStep>i+1?"done":currentStep===i+1?"current":"pending"}><span>{currentStep>i+1?<Check size={15}/>:i+1}</span><small>{label}</small></div>)}</div>
          <section className="public-step-section">
          <div className="booking-step"><span>1</span><b>Qual serviço você deseja?</b></div>
          <div className="public-service-grid">{data.services.map((item) => <button key={item.id} type="button" aria-pressed={serviceId === item.id} onClick={() => { setServiceId(item.id); setProfessionalId(""); setTime(""); setError(""); }}
            className={`public-service-card ${serviceId === item.id ? "public-service-selected" : ""}`}><span className="shortcut-icon blue"><Scissors size={18} /></span><span><b>{item.name}</b><small>{item.durationMinutes} min · {money(item.priceCents)}</small></span>{serviceId === item.id && <Check size={16} className="text-blue-600" />}</button>)}</div>
          {!data.services.length && <p className="public-empty-note">Este estabelecimento ainda não possui serviços ativos cadastrados.</p>}
          </section><section className="public-step-section">
          <div className="booking-step"><span>2</span><b>Escolha profissional e data</b></div>
          <div className="form-grid">
            <SelectField label="Profissional" disabled={!serviceId} required value={professionalId} onChange={(e) => { setProfessionalId(e.target.value); setTime("");setSlots([]);setError(""); }}>
              <option value="">Selecione o profissional</option>{professionals.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
            </SelectField>
            <Field label="Data" type="date" min={localDate()} required value={date} onChange={(e) => { setDate(e.target.value);setTime("");setSlots([]);setError(""); }} />
          </div>
          {!professionals.length && <p className="public-empty-note">Nenhum profissional ativo está disponível neste estabelecimento.</p>}
          </section><section className="public-step-section">
          <div className="booking-step"><span>3</span><b>Horários disponíveis</b></div>
          {serviceId && professionalId ? loadingSlots
            ? <p className="public-empty-note" aria-live="polite">Consultando horários disponíveis...</p>
            : <div className="slot-grid">{slots.length ? slots.map((slot) => <button type="button" aria-pressed={time === slot} className={`slot-button ${time === slot ? "slot-selected" : ""}`} onClick={() => { setTime(slot); setError(""); }} key={slot}>{slot}</button>)
            : <p className="public-empty-note">Não há horários disponíveis nesta data. Experimente outro dia.</p>}</div>
            : <p className="public-empty-note">Selecione um serviço e um profissional para consultar horários.</p>}
          </section><section className="public-step-section">
          <div className="booking-step"><span>4</span><b>Seus dados para confirmação</b></div>
          <div className="form-grid"><Field label="Seu nome" required maxLength={120} autoComplete="name" value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
            <Field label="WhatsApp com DDD" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required placeholder="(85) 99999-9999" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} /></div>
          </section>
          {service && professional && time && <div className="public-booking-summary"><b>Confira seu pedido</b>
            <span>{service.name} com {professional.name}</span><span>{dateLabel(date)} às {time} · {money(service.priceCents)}</span></div>}
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <label className="choice-option"><input type="checkbox" checked={whatsappOptIn}
            onChange={e=>setWhatsappOptIn(e.target.checked)}/>
            Aceito receber avisos desta reserva por WhatsApp. O agendamento funciona mesmo sem esta autorização.
          </label>
          <Button className="public-submit" disabled={loading || loadingSlots || !time || !serviceId || !professionalId || !client.name.trim() || !client.phone.trim()}>{loading ? "Solicitando..." : "Solicitar agendamento"} {!loading&&<ArrowRight size={18}/>}</Button>
          <p className="public-privacy"><ShieldCheck size={14} /> Seus dados são utilizados para organizar o atendimento e permitir contato do estabelecimento.</p>
        </form>}
    </section>
    <footer className="public-footer">Agendamento simples, do início ao fim. <span>Feito com carinho por Simplifica</span></footer>
  </main>;
}

function needsManualWhatsApp(appointment, state) {
  return Boolean(appointment.whatsappOptIn && appointment.clientPhone
    && state && !["submitted", "no-consent", "not-applicable"].includes(state));
}

function openAppointmentWhatsApp(appointment) {
  const status = statusNames[appointment.status];
  const business = appointment.businessName ? `Aqui é ${appointment.businessName}. ` : "";
  const message = `Olá, ${appointment.clientName}! ${business}Seu agendamento de ${appointment.serviceName}, com ${appointment.professionalName}, em ${dateTimeLabel(appointment.startsAt)}, está: ${status}.`;
  window.open(whatsappUrl(appointment.clientPhone, message), "_blank", "noopener,noreferrer");
  return api(`/requests/${appointment.id}/whatsapp-opened`, {
    method: "POST", body: { status: appointment.status },
  });
}

function WhatsAppStatusNotice({ appointment, onClose }) {
  const [error, setError] = useState("");
  return <Modal title="Avisar cliente pelo WhatsApp" onClose={onClose}>
    <div className="form-stack">
      <p className="booking-share-notice"><Info size={16}/> O status foi registrado. Você pode abrir o WhatsApp para enviar o aviso manualmente.</p>
      <p className="panel-subtitle">Uma conversa aberta não significa que a mensagem foi enviada.</p>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>Avisar depois</Button>
        <Button onClick={() => openAppointmentWhatsApp(appointment).then(onClose).catch((reason) => setError(reason.message))}>
          <Phone size={16}/> Abrir WhatsApp para enviar
        </Button>
      </div>
    </div>
  </Modal>;
}

function OnlineRequestsPage() {
  const [items,setItems]=useState([]);
  const [filter,setFilter]=useState("agendado");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState(null);
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(true);
  const refresh=useCallback(()=>api("/requests")
    .then(result=>{setItems(result.requests);setError("");})
    .catch(e=>setError(e.message)).finally(()=>setLoading(false)),[]);
  useEffect(()=>{refresh();},[refresh]);
  const act=async(item,action)=>{
    const description=action==="confirm"?"confirmar":"recusar";
    if(!await confirmAction(`Deseja ${description} a solicitação de ${item.clientName}?`))return;
    setBusy(item.id);setError("");
    try{
      const result=await api(`/requests/${item.id}`,{method:"PATCH",body:{action}});
      await refresh();
      if (needsManualWhatsApp(item, result.whatsappState))
        setNotice({...item,status:result.status});
    }
    catch(e){setError(e.message);}finally{setBusy("");}
  };
  const normalizedQuery=query.trim().toLocaleLowerCase("pt-BR");
  const visible=items.filter(item=>(filter==="all" || item.status===filter) && (!normalizedQuery || [item.clientName,item.serviceName,item.professionalName,item.clientPhone].some(value=>String(value||"").toLocaleLowerCase("pt-BR").includes(normalizedQuery))));
  const categories=[{id:"agendado",label:"Aguardando confirmação",icon:Clock3,tone:"orange"},{id:"confirmado",label:"Confirmados",icon:CheckCheck,tone:"green"},{id:"cancelado",label:"Cancelados ou recusados",icon:X,tone:"rose"},{id:"all",label:"Todas as solicitações",icon:ClipboardCheck,tone:"blue"}];
  return <>
    <PageTitle eyebrow="CENTRAL DE AGENDAMENTOS" title="Solicitações online"
      description="Confirme ou recuse pedidos e abra um aviso pronto para envio manual pelo WhatsApp. A confirmação não envia mensagens sozinha." />
    <section className="online-request-summary" aria-label="Resumo das solicitações">
      {categories.map(({id,label,icon:Icon,tone})=><button type="button" className={`request-summary-card ${filter===id?"is-selected":""}`} data-tone={tone} key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}><span className="request-summary-icon"><Icon size={20}/></span><span><small>{label}</small><strong>{loading?"—":id==="all"?items.length:items.filter(item=>item.status===id).length}</strong></span><ChevronRight size={17} className="request-summary-arrow"/></button>)}
    </section>
    <div className="booking-queue-tools premium-request-tools panel">
      <SelectField label="Situação" value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="agendado">Aguardando confirmação</option><option value="confirmado">Confirmados</option>
        <option value="cancelado">Cancelados ou recusados</option><option value="all">Todos</option>
      </SelectField>
      <div className="request-search"><Field label="Buscar solicitação" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cliente, serviço, profissional ou telefone"/></div>
      <Button type="button" variant="secondary" onClick={()=>{setLoading(true);refresh();}} disabled={loading}><RefreshCw size={15}/> {loading?"Atualizando...":"Atualizar lista"}</Button>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <section className="panel management-panel premium-request-panel">
      <div className="panel-heading"><div><p className="eyebrow">PEDIDOS RECEBIDOS</p>
        <h2>{filter==="agendado"?"Aguardando confirmação":"Histórico de solicitações"}</h2></div>
        <span className="count-chip">{visible.length}</span></div>
      {loading && !items.length ? <Loading label="Carregando solicitações..."/> : visible.length? <div className="management-list premium-request-list">{visible.map(item=>
        <article className="premium-request-card" key={item.id} data-status={item.status}>
          <div className="request-card-main"><span className="request-avatar">{item.clientName.slice(0,1).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><b>{item.clientName}</b><small>{item.serviceName}</small></div><span className={`status-badge ${statusStyles[item.status]||""}`}>{statusNames[item.status]||item.status}</span></div>
          <div className="request-card-details"><span><CalendarDays size={16}/> {dateTimeLabel(item.startsAt)}</span><span><UserRound size={16}/> {item.professionalName}</span><span><Phone size={16}/> {item.clientPhone || "Sem telefone"}</span></div>
          <div className="request-card-actions">
          {item.status==="agendado"&&<>
            <Button disabled={busy===item.id} onClick={()=>act(item,"confirm")}>Confirmar</Button>
            <Button variant="secondary" disabled={busy===item.id} onClick={()=>act(item,"reject")}>Recusar</Button>
          </>}
          {Boolean(item.whatsappOptIn && item.clientPhone) && <button type="button" className="button button-secondary" onClick={() =>
            openAppointmentWhatsApp(item).then(refresh).catch((reason) => setError(reason.message))
          }><Phone size={16}/> Abrir WhatsApp ({item.status==="confirmado"?"confirmação":item.status==="cancelado"?"cancelamento":"solicitação"})</button>}
          </div>
          {item.whatsappDeliveryState==="submitted" && <small>Enviado à API do WhatsApp — entrega ainda não verificada</small>}
          {item.whatsappDeliveryState==="failed" && <small>Envio automático não concluído — envie manualmente</small>}
          {Boolean(item.whatsappOptIn && item.whatsappOpenedAt) && <small>Conversa aberta anteriormente — envio manual não verificado</small>}
        </article>)}</div>:
        <EmptyState icon={ClipboardCheck} title="Nenhuma solicitação nesta situação"
          description="Pedidos de clientes pelo link público aparecerão aqui." />}
    </section>
    {notice && <WhatsAppStatusNotice appointment={notice} onClose={() => { setNotice(null); refresh(); }} />}
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
    if(action==="cancel"&&!await confirmAction("Confirma que deseja cancelar este horário?"))return;
    if(action==="reschedule"&&!slot)return;
    setBusy(true);setError("");
    try {
      await api(`/public/manage/${encodeURIComponent(token)}/${action}`,{
        method:"POST",body:action==="reschedule"?{startsAt:`${date}T${slot}:00`}:{},
      });
      await refresh();
    } catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <main className="public-page premium-public"><header className="public-topbar"><div className="public-brand">
    <img src="/assets/simplifica-perfil.svg" alt=""/>Simplifica <span>Agenda</span></div><span>Meu agendamento</span></header>
    <section className="public-booking-card public-manage">
      {!info ? <ErrorMessage>{error||"Consultando agendamento..."}</ErrorMessage> : <>
        <div className="booking-success public-receipt" role="status">
          <span><ClipboardCheck size={26}/></span><p className="eyebrow">COMPROVANTE DIGITAL DE SOLICITAÇÃO</p>
          <h1>{info.businessName}</h1><p>Protocolo: <strong>{info.protocol}</strong></p>
          <div className="public-booking-summary">
            <b className={`status-badge ${statusStyles[info.status] || ""}`}>{info.status==="agendado"?"Aguardando confirmação":statusNames[info.status]||info.status}</b>
            <strong className="receipt-appointment-time">{dateTimeLabel(info.startsAt)}</strong>
            <span>Cliente: {info.clientName}</span>
            <span>{info.serviceName} · {info.professionalName}</span>
            <span>Valor: {money(info.priceCents)}</span>
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
  const [data,setData]=useState({services:[],rules:[],serviceRules:[]});
  const [service,setService]=useState("");
  const [percent,setPercent]=useState("70"),[retention,setRetention]=useState("0");
  const [error,setError]=useState(""),[message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);
  const refresh=useCallback(async()=>{
    try{
      const [srv,rules]=await Promise.all([api("/services"),api("/commission-rules")]);
      setData({services:srv.services,rules:rules.rules,serviceRules:rules.serviceRules||[]});
    }catch(e){setError(e.message);}
  },[]);
  useEffect(()=>{refresh();},[refresh]);
  const selectService=id=>{
    setService(id);setError("");setMessage("");
    const chosen=data.services.find(item=>item.id===id);
    setPercent(String(chosen?.commissionMode==="custom"?chosen.serviceCommissionPercent:70));
    setRetention(String(chosen?.houseSharePercent||0));
  };
  const selectedService=data.services.find(item=>item.id===service);
  const effective=Math.max(0,Number(percent)-Number(retention));
  const professionalCents=Math.round((selectedService?.priceCents||0)*effective/100);
  const save=async e=>{
    e.preventDefault();setError("");setMessage("");setSaving(true);
    try{await api("/commission-rules",{method:"PUT",body:{
      serviceId:service,commissionPercent:Number(percent),houseSharePercent:Number(retention),
    }});setMessage("Regra do serviço salva para todos os profissionais em novos agendamentos e registros.");await refresh();}
    catch(e){setError(e.message);}finally{setSaving(false);}
  };
  const remove=async rule=>{
    if(!await confirmAction("Remover a regra geral deste serviço? Novos lançamentos voltarão a usar regras individuais anteriores, se houver, ou a comissão padrão do profissional."))return;
    try{await api("/commission-rules",{method:"DELETE",body:{serviceId:rule.serviceId}});setMessage("Regra geral removida.");await refresh();if(service===rule.serviceId){setService("");setPercent("70");setRetention("0");}}
    catch(e){setError(e.message);}
  };
  return <>
    <PageTitle eyebrow="POLÍTICAS DE REPASSE" title="Comissões por serviço"
      description="Programe o percentual de cada serviço uma única vez, independentemente de quem o realize."/>
    <section className="panel management-panel finance-rule-guide">
      <h2>Qual regra o sistema utiliza?</h2>
      <div className="finance-rule-steps"><div><span>1</span><b>Comissão do serviço</b><small>Maior prioridade · todos os profissionais</small></div><div><span>2</span><b>Regra individual anterior</b><small>Apenas se o serviço não tiver regra geral</small></div><div><span>3</span><b>Comissão padrão</b><small>Do profissional, quando não há regra</small></div></div>
      <p className="panel-subtitle">A retenção de materiais é descontada em pontos percentuais da comissão. Exemplo: R$ 100,00 × (60% − 10 pontos) = R$ 50,00 para o profissional e R$ 50,00 para o estabelecimento.</p>
      <p className="panel-subtitle">Vale para novos agendamentos internos, online e registros diretos. Serviços anteriores preservam os valores registrados; para atualizar uma comissão ainda não repassada, use Lançamentos dos profissionais → Ajustar comissão → Usar regra de comissão atual.</p>
    </section>
    <form className="panel management-panel settings-single-section finance-rule-form" onSubmit={save}>
      <div className="panel-heading"><div><h2>Configurar comissão do serviço</h2>
        <p className="panel-subtitle">A mesma porcentagem será aplicada a qualquer profissional que realizar o serviço. Não altera registros anteriores.</p></div></div>
      <div className="form-grid">
        <SelectField label="Serviço" value={service} required onChange={e=>selectService(e.target.value)}>
          <option value="">Selecione</option>{data.services.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <Field label="Repasse do serviço ao profissional (%)" type="number" required min="0" max="100" step="any"
          value={percent} onChange={e=>setPercent(e.target.value)}/>
        <Field label="Retenção adicional de materiais (pontos %)" type="number" required min="0" max={percent||0} step="any"
          value={retention} onChange={e=>setRetention(e.target.value)}/>
      </div>
      <p className="booking-share-notice">Repasse efetivo: {effective}% do valor do serviço.
        {selectedService && <> · Profissional: {money(professionalCents)} · Estabelecimento: {money(selectedService.priceCents-professionalCents)}.</>}
        {" "}Para repasse integral, use 100% e retenção 0%.</p>
      <ErrorMessage>{error}</ErrorMessage>{message&&<p className="success-message">{message}</p>}
      <div className="modal-actions"><Button disabled={saving||!service}>{saving?"Salvando...":"Salvar regra"}</Button></div>
    </form>
    <section className="panel management-panel finance-ledger">
      <div className="panel-heading"><div><h2>Regras cadastradas</h2>
        <p className="panel-subtitle">Percentuais por serviço, aplicáveis a todos os profissionais.</p></div></div>
      {data.serviceRules.length?<div className="management-list">{data.serviceRules.map(rule=>
        <article className="service-row request-item" key={rule.serviceId}>
          <span className="service-row-icon"><CircleDollarSign size={18}/></span>
          <div className="min-w-0 flex-1"><b>{rule.serviceName}</b>
            <small>{rule.commissionPercent}% de repasse bruto · {rule.houseSharePercent}% de retenção</small></div>
          <strong>{Math.max(0,rule.commissionPercent-rule.houseSharePercent)}% líquido</strong>
          <Button variant="secondary" type="button" onClick={()=>selectService(rule.serviceId)}>Editar</Button>
          <Button variant="secondary" type="button" onClick={()=>remove(rule)}>Remover</Button>
        </article>)}</div>:<EmptyState icon={Wallet} title="Nenhuma comissão por serviço configurada"
          description="Selecione um serviço para programar o percentual."/>}
      {data.rules.length>0&&<p className="panel-subtitle">Existem {data.rules.length} regra(s) individual(is) anterior(es), preservadas. A regra geral do serviço tem prioridade.</p>}
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
  const [adjusting, setAdjusting] = useState(null);
  const [adjustError, setAdjustError] = useState("");
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const refresh = useCallback(() => api(`/settlements?period=${encodeURIComponent(period)}`)
    .then(result => { setData(result); setError(""); }).catch(err => setError(err.message)), [period]);
  useEffect(() => { refresh(); }, [refresh]);
  const close = async professional => {
    if (!await confirmAction(`Confirma que o valor de ${money(professional.dueCents)} JÁ FOI REALMENTE TRANSFERIDO para ${professional.professionalName}? Esta ação registra pagamento efetivo e não realiza PIX.`)) return;
    setBusy(professional.professionalId); setError(""); setMessage("");
    try {
      const result = await api("/settlements", {method:"POST", body:{period,professionalId:professional.professionalId,expectedTotalCents:professional.dueCents}});
      setMessage(`Repasse confirmado: ${money(result.batch.totalCents)} para ${professional.professionalName}.`);
      await refresh();
    } catch (err) { await refresh(); setError(err.message); }
    finally { setBusy(""); }
  };
  const currentPeriod=data.period===period;
  const due = data.professionals.reduce((sum, item) => sum + item.dueCents, 0);
  const earned = data.professionals.reduce((sum, item) => sum + item.earnedCents, 0);
  const paid=data.professionals.reduce((sum,item)=>sum+item.paidCents,0);
  const gross=data.professionals.reduce((sum,item)=>sum+item.grossCents,0);
  const legacy = data.professionals.reduce((sum, item) => sum + item.legacyUnverified, 0);
  const ended = Boolean(data.period === period && data.end && data.end < today);
  return <>
    <PageTitle eyebrow="GESTÃO FINANCEIRA" title="Saldos e repasses quinzenais"
      description="A empresa recebe os pagamentos dos clientes; a conclusão do serviço gera saldo para o profissional, mas não efetua repasse."/>
    <div className="booking-queue-tools panel finance-filter-bar">
      <div className="month-filter"><label>Mês</label><input type="month" className="input month-input" value={month} onChange={event => setMonth(event.target.value)}/></div>
      <div className="month-filter"><label>Quinzena</label><select className="input" value={half} onChange={event => setHalf(event.target.value)}>
        <option value="1">1ª quinzena (01–15)</option><option value="2">2ª quinzena (16–último dia)</option>
      </select></div>
      <a className="button button-secondary" href={`/api/settlements/export.csv?period=${encodeURIComponent(period)}`}>
        <Download size={16}/> Exportar saldos CSV
      </a>
    </div>
    <section className="stats-grid finance-stats settlement-overview">
      <StatCard title="Produção da quinzena" value={currentPeriod?money(gross):"—"} icon={Scissors} note="Valor bruto dos serviços realizados"/>
      <StatCard title="Comissões geradas" value={currentPeriod?money(earned):"—"} icon={CircleDollarSign} tone="purple" note="Serviços concluídos na quinzena"/>
      <StatCard title="Repasses confirmados" value={currentPeriod?money(paid):"—"} icon={CheckCheck} tone="green" note="Pagamentos aos profissionais"/>
      <StatCard title="Saldo a pagar" value={currentPeriod?money(due):"—"} icon={Wallet} tone="orange" note="Crédito ainda não repassado"/>
    </section>
    <ErrorMessage>{error}</ErrorMessage>
    {message && <p className="success-message">{message}</p>}
    {legacy > 0 && <p className="panel-subtitle">Existem {legacy} lançamento(s) antigos marcados como pagos, mas sem confirmação de transferência. Eles permanecem como saldo pendente para conferência.</p>}
    <section className="panel management-panel finance-ledger">
      <div className="panel-heading"><div><h2>Saldo por profissional</h2>
        <p className="panel-subtitle">Período: {data.start || "—"} até {data.end || "—"}. Confirme o repasse apenas quando o pagamento tiver acontecido fora do sistema.</p></div></div>
      {data.period === period && data.professionals.length ? <div className="management-list">{data.professionals.map(pro =>
        <div key={pro.professionalId} className="settlement-professional-card">
        <article className="service-row request-item settlement-professional-head">
          <span className="settlement-avatar">{pro.professionalName.slice(0,1).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><b>{pro.professionalName}</b>
            <small>{pro.completed} serviço(s) realizados na quinzena</small>
          </div>
          <div className="finance-amount"><small>Valor a repassar</small><strong>{money(pro.dueCents)}</strong></div>
          {pro.pendingServices > 0 && <Button disabled={busy === pro.professionalId || !ended}
            onClick={() => close(pro)}>{busy === pro.professionalId ? "Registrando..." : "Confirmar repasse"}</Button>}
        </article>
        <div className="settlement-breakdown">
          <div><small>Produção</small><b>{money(pro.grossCents)}</b></div>
          <div><small>Clientes pagaram</small><b>{money(pro.receivedCents)}</b></div>
          <div><small>Clientes a pagar</small><b>{money(pro.customerPendingCents)}</b></div>
          <div><small>Comissão gerada</small><b>{money(pro.earnedCents)}</b></div>
          <div><small>Já repassado</small><b>{money(pro.paidCents)}</b></div>
        </div>
        <details>
          <summary className="button button-secondary" style={{width:"fit-content",cursor:"pointer"}}>Conferir {pro.completed} serviço(s)</summary>
          <div className="management-list settlement-detail">
            {(pro.services || []).map(item=><article className="service-row request-item" key={item.id}>
              <div className="min-w-0 flex-1"><b>{item.serviceName} · {item.clientName}</b>
                <small>{dateLabel(item.earnedOn)} · Serviço: {money(item.priceCents)} · Comissão: {Math.max(0,item.commissionPercent-item.houseSharePercent)}%</small>
                <small>Cliente: {item.paymentMethod ? "Pagamento recebido" : "Pagamento pendente"}</small>
              </div>
              <div><small>{item.paid?"Repassado":"A repassar"}</small><br/><strong>{money(item.paid?item.paidCents:item.earnedCents)}</strong></div>
              {item.paid ? <span className="status-badge bg-emerald-50 text-emerald-700">Confirmado</span> :
                <Button variant="secondary" disabled={!!busy} onClick={()=>{setAdjustError("");setAdjusting({...item,reason:""});}}>Ajustar comissão</Button>}
            </article>)}
          </div>
        </details>
        </div>)}</div> : <EmptyState icon={Wallet} title="Nenhum serviço concluído" description="Os saldos dos serviços concluídos na quinzena aparecerão aqui."/>}
      {!ended && <p className="panel-subtitle">A quinzena ainda não terminou. O saldo pode ser consultado, mas o pagamento só poderá ser confirmado após o encerramento do período.</p>}
    </section>
    <section className="panel management-panel finance-ledger">
      <div className="panel-heading"><div><h2>Histórico de repasses confirmados</h2></div></div>
      {data.period === period && data.batches.length ? <div className="management-list">{data.batches.map(batch =>
        <article className="service-row" key={batch.id}><CheckCheck size={18}/>
          <span className="min-w-0 flex-1"><b>{batch.professionalName}</b><small>{batch.paidAt} · protocolo {batch.id.slice(0, 8)}</small></span>
          <strong>{money(batch.totalCents)}</strong>
          <a className="button button-secondary" href={`/api/settlements/${encodeURIComponent(batch.id)}/pdf`} target="_blank" rel="noreferrer">Abrir / imprimir</a>
          <a className="button button-primary" href={`/api/settlements/${encodeURIComponent(batch.id)}/pdf?download=1`}><Download size={16}/> Baixar PDF</a>
        </article>)}</div> :
        <p className="panel-subtitle">Nenhum repasse confirmado nesta quinzena.</p>}
    </section>
    {adjusting && <Modal title="Ajustar comissão do serviço" onClose={()=>{if(!savingAdjustment)setAdjusting(null);}}>
      <form className="form-stack" onSubmit={async e=>{
        e.preventDefault();setSavingAdjustment(true);setAdjustError("");
        try{await api(`/commissions/${adjusting.id}`,{method:"PATCH",body:{commissionPercent:Number(adjusting.commissionPercent),houseSharePercent:Number(adjusting.houseSharePercent||0),reason:adjusting.reason}});
          setAdjusting(null);await refresh();}
        catch(err){setAdjustError(err.message);}finally{setSavingAdjustment(false);}
      }}>
        <p className="panel-subtitle">{adjusting.professionalName} · {adjusting.serviceName} · {adjusting.clientName}</p>
        <Field label="Comissão do profissional (%)" type="number" required min="0" max="100" step="any" value={adjusting.commissionPercent} onChange={e=>setAdjusting(v=>({...v,commissionPercent:e.target.value}))}/>
        <Field label="Retenção de materiais (pontos percentuais)" type="number" required min="0" max="100" step="any" value={adjusting.houseSharePercent} onChange={e=>setAdjusting(v=>({...v,houseSharePercent:e.target.value}))}/>
        <Field label="Motivo do ajuste (opcional)" maxLength={250} value={adjusting.reason} onChange={e=>setAdjusting(v=>({...v,reason:e.target.value}))}/>
        <p className="booking-share-notice">Valor do serviço: {money(adjusting.priceCents)}<br/><b>Valor a repassar: {money(Math.round(adjusting.priceCents*Math.max(0,Number(adjusting.commissionPercent)-Number(adjusting.houseSharePercent))/100))}</b></p>
        <ErrorMessage>{adjustError}</ErrorMessage>
        <div className="modal-actions"><Button type="button" variant="secondary" disabled={savingAdjustment} onClick={()=>setAdjusting(null)}>Cancelar</Button><Button disabled={savingAdjustment}>{savingAdjustment?"Salvando...":"Salvar ajuste"}</Button></div>
      </form>
    </Modal>}
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
    if(!await confirmAction(`Deseja ${status==="suspended"?"suspender":"reativar"} ${item.name}?`))return;
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
  const publicRoute=location.pathname.startsWith("/agendar/")||location.pathname.startsWith("/acompanhar/")||location.pathname==="/central-saas";
  useEffect(() => {
    if (location.pathname.startsWith("/agendar/") || location.pathname.startsWith("/acompanhar/") || location.pathname === "/central-saas") { setLoading(false); return; }
    Promise.all([
      api("/installation/status"),
      api("/auth/me").then(({ user: current }) => current).catch(() => null),
    ]).then(([status, current]) => { setInstallation(status); setUser(current); })
      .catch(() => setUser(null)).finally(() => setLoading(false));
  }, [location.pathname]);
  useEffect(() => {
    let active=true;
    if(!user || publicRoute){document.documentElement.classList.remove("dark");return;}
    api("/settings").then(({ settings }) => {if(active)document.documentElement.classList.toggle("dark", settings?.theme === "escuro");}).catch(() => {});
    return ()=>{active=false;};
  }, [user,publicRoute]);
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
      <Route path="/estoque" element={user.role!=="profissional"&&user.tenantId!=="tenant-salao-demo"?<InventoryPage user={user}/>:<AccessDenied/>}/>
      <Route path="/pacotes" element={user.role!=="profissional"&&user.tenantId!=="tenant-salao-demo"?<PackagesPage user={user}/>:<AccessDenied/>}/>
      <Route path="/equipe" element={user.role === "dono" && user.tenantId !== "tenant-salao-demo" ? <ServicesPage user={user} section="team" /> : <AccessDenied />} />
      <Route path="/meus-atendimentos" element={user.role === "profissional" ? <ProfessionalWorkPage user={user} /> : <AccessDenied />} />
      <Route path="/meus-ganhos" element={user.role === "profissional" ? <ProfessionalEarningsPage/> : <AccessDenied/>}/>
      <Route path="/comissoes" element={user.role === "dono" ? <Navigate to="/recebimentos?aba=comissoes" replace/> : <AccessDenied/>}/>
      <Route path="/regras-comissao" element={user.role === "dono" ? <Navigate to="/recebimentos?aba=regras" replace/> : <AccessDenied/>}/>
      <Route path="/fechamentos" element={user.role === "dono" ? <Navigate to="/recebimentos?aba=fechamentos" replace/> : <AccessDenied/>}/>
      <Route path="/compartilhar" element={<BookingSharePage user={user} />} />
      <Route path="/financeiro" element={user.role === "dono" ? <FinancePage /> : <AccessDenied />} />
      <Route path="/recebimentos" element={["dono", "recepcao"].includes(user.role) && user.tenantId !== "tenant-salao-demo" ? <FinancialHubPage user={user} /> : <AccessDenied />} />
      <Route path="/configuracoes" element={user.role === "dono" && user.tenantId !== "tenant-salao-demo" ? <SettingsPage user={user} onUserUpdated={setUser} /> : <AccessDenied />} />
      <Route path="/minha-conta" element={user.tenantId === "tenant-salao-demo" ? <AccessDenied /> :
        user.role === "dono" ? <Navigate to="/configuracoes" replace /> :
        <AccountPage user={user} onUserUpdated={setUser} />} />
      <Route path="*" element={user.role === "recepcao" ? <ReceptionDashboard user={user}/> : <OverviewPage user={user} />} />
    </Routes>
  </Shell>;
}
