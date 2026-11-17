import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown,
  ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Download, ExternalLink, LayoutDashboard,
  LogOut, Menu, Moon, MoreHorizontal, Plus, Search, Settings, ShieldCheck, Sun, Users,
  Wallet, X, Scissors, UserRound, CalendarClock, CalendarX2, Phone, Mail, Sparkles,
} from "lucide-react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";

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
  const [values, setValues] = useState({ email: demoEnabled ? "admin@simplifica.local" : "", password: demoEnabled ? "Agenda123!" : "", slug: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { user } = await api("/auth/login", { method: "POST", body: values });
      onLogin(user);
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
        <form className="space-y-4" onSubmit={submit}>
          <Field label="E-mail" type="email" autoComplete="username" required value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })} />
          <Field label="Senha" type="password" autoComplete="current-password" required value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })} />
          <Field label="Identificador do negócio (opcional)" placeholder="Ex.: studio-bela-vista"
            value={values.slug} onChange={(e) => setValues({ ...values, slug: e.target.value })} />
          <ErrorMessage>{error}</ErrorMessage>
          <Button className="w-full justify-center" type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar na minha agenda"}
          </Button>
        </form>
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

function CalendarCheckDecoration() {
  return <span className="deco-calendar"><CalendarDays size={23} /><Check size={12} /></span>;
}

const navItems = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/servicos", label: "Serviços e equipe", icon: Scissors },
  { to: "/financeiro", label: "Financeiro e relatórios", icon: Wallet },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function Shell({ user, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const [businessName, setBusinessName] = useState("Simplifica Agenda");
  const visibleNavItems = navItems.filter((item) =>
    user.role === "dono" || !["/financeiro", "/configuracoes"].includes(item.to));
  useEffect(() => {
    api("/settings").then(({ settings }) => settings?.businessName && setBusinessName(settings.businessName)).catch(() => {});
  }, [location.pathname]);
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
          <span className="business-avatar">{businessName.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><b>{businessName}</b><small>Plano demonstração</small></span>
          <ChevronDown size={15} className="text-slate-400" />
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <span className="nav-caption">MENU PRINCIPAL</span>
          {visibleNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link className="public-link" to="/agendar/studio-bela-vista" target="_blank">
            <ExternalLink size={16} /><span><b>Agendamento online</b><small>Veja a página pública</small></span>
            <ArrowRight size={15} />
          </Link>
          <div className="profile-card">
            <span className="profile-avatar">{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
            <div className="min-w-0 flex-1"><b>{user.name}</b><small>{user.role === "dono" ? "Proprietária" : user.role === "recepcao" ? "Recepção" : "Profissional"}</small></div>
            <button className="icon-button compact" onClick={onLogout} aria-label="Sair"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button>
          <div className="topbar-breadcrumb"><span>Studio</span><ChevronRight size={14} /><b>{pageName}</b></div>
          <div className="topbar-right">
            <span className="today-pill"><span /> Sistema funcionando</span>
            <span className="topbar-date">{dateLabel(localDate(), { weekday: "short", day: "2-digit", month: "short" })}</span>
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

function OverviewPage({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => api("/overview").then(setData).catch((reason) => setError(reason.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const navigate = useNavigate();
  if (!data && !error) return <Loading />;
  return <>
    <PageTitle eyebrow={`RESUMO DO NEGÓCIO · ${dateLabel(localDate(), { weekday: "long" }).toUpperCase()}`} title={`Olá, ${user.name.split(" ")[0]} 👋`}
      description="Aqui está um resumo do seu negócio. Tenha um ótimo dia!"
      actions={<Button onClick={() => navigate("/agenda")}><Plus size={17} /> Novo agendamento</Button>} />
    <ErrorMessage>{error}</ErrorMessage>
    <section className="stats-grid">
      <StatCard title="Atendimentos hoje" value={data?.todayCount ?? "—"} note="Na agenda de hoje" icon={CalendarDays} />
      <StatCard title={user.role === "dono" ? "Faturamento do mês" : "Agendamentos no mês"}
        value={user.role === "dono" ? money(data?.monthRevenueCents) : data?.monthCount ?? "—"}
        note={user.role === "dono" ? `${data?.monthCount ?? 0} atendimentos agendados` : "Na agenda do negócio"}
        icon={CircleDollarSign} tone="green" />
      <StatCard title="Clientes ativos" value={data?.activeClients ?? "—"} note="Com horário neste mês" icon={Users} tone="purple" />
      <StatCard title="Próximo atendimento" value={data?.upcoming?.[0] ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.upcoming[0].startsAt)) : "Livre"}
        note={data?.upcoming?.[0]?.clientName ?? "Sem próximos horários"} icon={Clock3} tone="orange" />
    </section>
    <section className="overview-grid">
      <div className="panel upcoming-panel">
        <div className="panel-heading"><div><p className="eyebrow">AGENDA DO DIA</p><h2>Próximos atendimentos</h2></div><Link to="/agenda" className="text-link">Ver agenda <ArrowRight size={14} /></Link></div>
        {data?.upcoming?.length ? <div className="appointments-list">{data.upcoming.slice(0, 5).map((appointment) =>
          <AppointmentCard key={appointment.id} appointment={appointment} compact onOpen={() => navigate("/agenda")} />)}</div>
          : <EmptyState icon={CalendarDays} title="Sua agenda está livre" description="Aproveite para organizar seus próximos horários." action={<Button variant="secondary" onClick={() => navigate("/agenda")}><Plus size={15} /> Criar agendamento</Button>} />}
      </div>
      <div className="panel shortcut-panel">
        <div className="panel-heading"><div><p className="eyebrow">ACESSO RÁPIDO</p><h2>O que você precisa?</h2></div></div>
        <div className="shortcuts">
          <Link to="/agenda" className="shortcut-item"><span className="shortcut-icon blue"><CalendarDays size={18} /></span><span><b>Organizar agenda</b><small>Visualize sua semana</small></span><ArrowRight size={15} /></Link>
          <Link to="/clientes" className="shortcut-item"><span className="shortcut-icon green"><Users size={18} /></span><span><b>Cadastrar cliente</b><small>Guarde os detalhes</small></span><ArrowRight size={15} /></Link>
          <Link to="/servicos" className="shortcut-item"><span className="shortcut-icon violet"><Scissors size={18} /></span><span><b>Gerenciar serviços</b><small>Equipe, preços e duração</small></span><ArrowRight size={15} /></Link>
          {user.role === "dono" && <Link to="/financeiro" className="shortcut-item"><span className="shortcut-icon amber"><Wallet size={18} /></span><span><b>Conferir resultados</b><small>Receitas e comissões</small></span><ArrowRight size={15} /></Link>}
        </div>
        <div className="quick-tip"><Sparkles size={17} /><span><b>Dica para o seu dia</b><small>Confirme seus atendimentos pelo WhatsApp e evite faltas.</small></span></div>
      </div>
    </section>
    <footer className="page-footer">Feito para deixar sua rotina mais leve <span>♥</span></footer>
  </>;
}

function EmptyState({ icon: Icon = CalendarDays, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><b>{title}</b><p>{description}</p>{action}</div>;
}

function AppointmentForm({ onClose, onSaved, initialDate, user }) {
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [values, setValues] = useState({ clientId: "", serviceId: "", professionalId: user.role === "profissional" ? user.id : "", startsAt: `${initialDate}T09:00`, notes: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([api("/clients"), api("/services"), api("/professionals")]).then(([c, s, p]) => {
      setClients(c.clients); setServices(s.services.filter((item) => item.active)); setProfessionals(p.professionals.filter((item) => item.active));
    }).catch((reason) => setError(reason.message));
  }, []);
  const selectedService = services.find((service) => service.id === values.serviceId);
  const options = professionals.filter((professional) =>
    (user.role !== "profissional" || professional.id === user.id)
    && (!selectedService || professional.serviceIds.includes(selectedService.id)));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await api("/appointments", { method: "POST", body: values });
      onSaved();
    } catch (reason) { setError(reason.message); } finally { setSaving(false); }
  };
  return <Modal title="Novo agendamento" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <SelectField label="Cliente" required value={values.clientId} onChange={(e) => setValues({ ...values, clientId: e.target.value })}>
        <option value="">Selecione um cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}
      </SelectField>
      <div className="form-grid">
        <SelectField label="Serviço" required value={values.serviceId}         onChange={(e) => setValues({ ...values, serviceId: e.target.value, professionalId: user.role === "profissional" ? user.id : "" })}>
          <option value="">Selecione</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {money(service.priceCents)}</option>)}
        </SelectField>
        <SelectField label="Profissional" required value={values.professionalId} onChange={(e) => setValues({ ...values, professionalId: e.target.value })}>
          <option value="">Selecione</option>{options.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </SelectField>
      </div>
      <Field label="Data e horário" type="datetime-local" required value={values.startsAt}
        onChange={(e) => setValues({ ...values, startsAt: e.target.value })} />
      <Field label="Observações" placeholder="Algum detalhe importante?" value={values.notes}
        onChange={(e) => setValues({ ...values, notes: e.target.value })} />
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={saving}>{saving ? "Salvando..." : "Salvar agendamento"}</Button></div>
    </form>
  </Modal>;
}

function BlockForm({ onClose, onSaved, initialDate }) {
  const [professionals, setProfessionals] = useState([]);
  const [values, setValues] = useState({ professionalId: "", startsAt: `${initialDate}T12:00`, endsAt: `${initialDate}T13:00`, reason: "" });
  const [error, setError] = useState("");
  useEffect(() => { api("/professionals").then(({ professionals: people }) => setProfessionals(people)); }, []);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try { await api("/blocked-slots", { method: "POST", body: values }); onSaved(); }
    catch (reason) { setError(reason.message); }
  };
  return <Modal title="Bloquear horário" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <SelectField label="Profissional" value={values.professionalId} onChange={(e) => setValues({ ...values, professionalId: e.target.value })}>
        <option value="">Toda a equipe</option>{professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </SelectField>
      <Field label="Início" type="datetime-local" required value={values.startsAt} onChange={(e) => setValues({ ...values, startsAt: e.target.value })} />
      <Field label="Fim" type="datetime-local" required value={values.endsAt} onChange={(e) => setValues({ ...values, endsAt: e.target.value })} />
      <Field label="Motivo" placeholder="Ex.: almoço, compromisso..." value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} />
      <ErrorMessage>{error}</ErrorMessage>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Bloquear horário</Button></div>
    </form>
  </Modal>;
}

function AppointmentDetails({ appointment, onClose, onUpdated }) {
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
  const message = `Olá, ${appointment.clientName}! Passando para confirmar seu horário de ${appointment.serviceName} no dia ${dateTimeLabel(appointment.startsAt)} com ${appointment.professionalName}. Podemos confirmar?`;
  const whatsApp = whatsappUrl(appointment.clientPhone, message);
  return <Modal title="Detalhes do atendimento" onClose={onClose}>
    <div className="detail-person"><span className="profile-avatar large">{appointment.clientName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span><div><h3>{appointment.clientName}</h3><span>{appointment.clientPhone || "Sem telefone cadastrado"}</span></div></div>
    <div className="detail-summary">
      <div><span>Serviço</span><b>{appointment.serviceName}</b></div>
      <div><span>Profissional</span><b>{appointment.professionalName}</b></div>
    </div>
    <div className="form-stack mt-5">
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
        <Button disabled={saving} onClick={() => save({ status, paymentMethod: method, priceCents: price, startsAt })}>{saving ? "Salvando..." : "Salvar alterações"}</Button>
      </div>
    </div>
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
      actions={<>{user.role !== "profissional" && <Button variant="secondary" onClick={() => setModal("block")}><CalendarX2 size={16} /> Bloquear horário</Button>}<Button onClick={() => setModal("new")}><Plus size={17} /> Novo agendamento</Button></>} />
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
            {Array.from({ length: 12 }, (_, i) => <button key={i} className="calendar-hour" onClick={() => { setDate(day); setModal("new"); }} aria-label={`Novo agendamento às ${i + 8}:00`} />)}
            {events.map((item) => {
              const start = new Date(item.startsAt);
              const mins = start.getHours() * 60 + start.getMinutes() - 8 * 60;
              if (mins < 0 || mins > 720) return null;
              const height = Math.max(50, (item.durationMinutes / 60) * 64);
              return <button key={item.id} className={`calendar-event event-${item.status}`} style={{ top: `${mins / 60 * 64 + 6}px`, height: `${height}px` }} onClick={() => setSelected(item)}>
                <b>{item.clientName}</b><span>{dateTimeLabel(item.startsAt).split(" ")[1]} · {item.serviceName}</span>
              </button>;
            })}
            {blocks.map((block) => <div key={block.id} className="calendar-block" style={{ top: `${((new Date(block.startsAt).getHours() - 8) * 60 + new Date(block.startsAt).getMinutes()) / 60 * 64 + 4}px` }}>Bloqueado · {block.reason}</div>)}
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
          {blocks.map((block) => <div className="block-row" key={block.id}><CalendarX2 size={16} /> Bloqueado · {block.reason || "Horário indisponível"}
            <span>{dateTimeLabel(block.startsAt)} — {dateTimeLabel(block.endsAt)}</span><button className="icon-button compact" onClick={() => api(`/blocked-slots/${block.id}`, { method: "DELETE" }).then(refresh)} aria-label="Remover bloqueio"><X size={15} /></button></div>)}
        </div>;
      })}
    </div>
    {modal === "new" && <AppointmentForm initialDate={date} user={user} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {modal === "block" && <BlockForm initialDate={date} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {selected && <AppointmentDetails appointment={selected} onClose={() => setSelected(null)} onUpdated={() => { setSelected(null); refresh(); }} />}
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

function ClientsPage({ user }) {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => api(`/clients?search=${encodeURIComponent(search)}`).then(({ clients: list }) => setClients(list)).catch((reason) => setError(reason.message)), [search]);
  useEffect(() => { refresh(); }, [refresh]);
  const showHistory = async (client) => {
    try { const result = await api(`/clients/${client.id}/history`); setHistory({ client, appointments: result.history }); }
    catch (reason) { setError(reason.message); }
  };
  return <>
    <PageTitle eyebrow="RELACIONAMENTO QUE FIDELIZA" title="Clientes" description="Conheça melhor quem confia no seu trabalho."
      actions={user.role !== "profissional" && <Button onClick={() => setModal({})}><Plus size={17} /> Novo cliente</Button>} />
    <ErrorMessage>{error}</ErrorMessage>
    <section className="panel clients-panel">
      <div className="table-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <span className="count-chip">{clients.length} clientes</span>{user.role !== "profissional" && <a className="button button-secondary export-button" href="/api/export/clients.csv"><Download size={15} /> Exportar CSV</a>}</div>
      {clients.length ? <div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>CONTATO</th><th>ATENDIMENTOS</th><th>ÚLTIMA VISITA</th><th> </th></tr></thead>
        <tbody>{clients.map((client) => <tr key={client.id}>
          <td><div className="table-person"><span className="table-avatar">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><b>{client.name}</b><small>{client.email || client.notes || "Cliente Simplifica"}</small></div></div></td>
          <td>{client.phone || "—"}</td><td><span className="count-chip">{client.appointmentCount}</span></td>
          <td>{client.lastVisit ? dateTimeLabel(client.lastVisit) : "Ainda sem visita"}</td>
          <td><div className="row-actions"><button className="text-link" onClick={() => showHistory(client)}>Histórico</button>
            {user.role !== "profissional" && <button className="icon-button compact" onClick={() => setModal(client)} aria-label="Editar cliente"><MoreHorizontal size={18} /></button>}
            {client.phone && <a className="icon-button compact" aria-label="Enviar mensagem" href={whatsappUrl(client.phone, `Olá, ${client.name}! Tudo bem?`) } target="_blank" rel="noreferrer"><Phone size={15} /></a>}</div></td>
        </tr>)}</tbody></table></div>
        : <EmptyState icon={Users} title="Sua lista começa aqui" description="Cadastre seus clientes e acompanhe cada visita." action={user.role !== "profissional" && <Button onClick={() => setModal({})}><Plus size={15} /> Cadastrar cliente</Button>} />}
    </section>
    {modal && <ClientForm client={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
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
    priceCents: service?.priceCents ?? 0, professionalIds: service?.professionalIds ?? [],
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
      <div className="field"><span className="field-label">Profissionais que realizam</span><div className="choice-list">
        {professionals.map((person) => <label key={person.id} className="choice-option"><input type="checkbox" checked={values.professionalIds.includes(person.id)}
          onChange={(event) => setValues({ ...values, professionalIds: event.target.checked ? [...values.professionalIds, person.id] : values.professionalIds.filter((id) => id !== person.id) })} />{person.name}</label>)}
      </div></div>
      <ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Salvar serviço</Button></div>
    </form>
  </Modal>;
}

function TeamMemberForm({ services, onClose, onSaved }) {
  const [values, setValues] = useState({ name: "", email: "", password: "", phone: "", role: "profissional", commissionPercent: 40, serviceIds: [] });
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try { await api("/team-members", { method: "POST", body: { ...values, commissionPercent: Number(values.commissionPercent) } }); onSaved(); }
    catch (reason) { setError(reason.message); }
  };
  return <Modal title="Adicionar à equipe" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Nome" required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
      <Field label="E-mail de acesso" type="email" required value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
      <Field label="Senha inicial" type="password" minLength="8" required value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
      <SelectField label="Perfil de acesso" value={values.role} onChange={(e) => setValues({ ...values, role: e.target.value })}>
        <option value="profissional">Profissional</option><option value="recepcao">Recepção</option>
      </SelectField>
      <div className="form-grid"><Field label="Telefone / WhatsApp" type="tel" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
        {values.role === "profissional" && <Field label="Comissão (%)" type="number" min="0" max="100" value={values.commissionPercent} onChange={(e) => setValues({ ...values, commissionPercent: e.target.value })} />}</div>
      {values.role === "profissional" && <div className="field"><span className="field-label">Serviços realizados</span><div className="choice-list">{services.map((service) =>
        <label key={service.id} className="choice-option"><input type="checkbox" checked={values.serviceIds.includes(service.id)}
          onChange={(event) => setValues({ ...values, serviceIds: event.target.checked ? [...values.serviceIds, service.id] : values.serviceIds.filter((id) => id !== service.id) })} />{service.name}</label>)}</div></div>}
      <ErrorMessage>{error}</ErrorMessage><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button>Cadastrar {values.role === "recepcao" ? "pessoa da recepção" : "profissional"}</Button></div>
    </form>
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

function ServicesPage({ user }) {
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [team, setTeam] = useState([]);
  const [modal, setModal] = useState("");
  const [hoursFor, setHoursFor] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => Promise.all([
    api("/services"),
    api("/professionals"),
    user.role === "dono" ? api("/team-members") : Promise.resolve(null),
  ])
    .then(([s, p, people]) => { setServices(s.services); setProfessionals(p.professionals); setTeam(people?.team ?? p.professionals); })
    .catch((reason) => setError(reason.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  return <>
    <PageTitle eyebrow="SEU NEGÓCIO, DO SEU JEITO" title="Serviços e equipe" description="Organize o que você oferece e quem faz acontecer."
      actions={user.role === "dono" && <><Button variant="secondary" onClick={() => setModal("team")}><UserRound size={16} /> Adicionar à equipe</Button><Button onClick={() => setModal("service")}><Plus size={16} /> Novo serviço</Button></>} />
    <ErrorMessage>{error}</ErrorMessage>
    <div className="management-grid">
      <section className="panel management-panel"><div className="panel-heading"><div><p className="eyebrow">CARDÁPIO DE CUIDADOS</p><h2>Serviços</h2></div><span className="count-chip">{services.length}</span></div>
        {services.length ? <div className="management-list">{services.map((service) => <article className="service-row" key={service.id}>
          <span className="service-row-icon"><Scissors size={18} /></span><div className="min-w-0 flex-1"><b>{service.name}</b><small>{service.durationMinutes} min · {service.professionalNames || "Sem profissional"}</small></div>
          <strong>{money(service.priceCents)}</strong>{user.role === "dono" && <button className="icon-button compact" onClick={() => setModal(service)} aria-label="Editar serviço"><MoreHorizontal size={18} /></button>}
        </article>)}</div> : <EmptyState icon={Scissors} title="Nenhum serviço cadastrado" description="Adicione seu primeiro serviço." />}</section>
      <section className="panel management-panel"><div className="panel-heading"><div><p className="eyebrow">QUEM FAZ ACONTECER</p><h2>Equipe</h2></div><span className="count-chip">{team.filter((person) => person.active).length} ativos</span></div>
        {team.length ? <div className="management-list">{team.map((person) => <article className="professional-row" key={person.id}>
          <span className="table-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
          <div className="min-w-0 flex-1"><b>{person.name}</b><small>{person.email} · {person.role === "profissional" ? `Comissão ${person.commissionPercent}%` : "Recepção"}</small></div>
          {person.active ? <span className="status-badge bg-emerald-50 text-emerald-700">Ativa</span> : <span className="status-badge bg-slate-100 text-slate-500">Inativa</span>}
          {user.role === "dono" && person.role === "profissional" && <button className="button button-quiet" onClick={() => setHoursFor(person)}>Horários</button>}
          {user.role === "dono" && <button className="icon-button compact" onClick={async () => {
            try { await api(`/team-members/${person.id}`, { method: "PATCH", body: { name: person.name, phone: person.phone, commissionPercent: person.commissionPercent, active: !person.active } }); refresh(); }
            catch (reason) { setError(reason.message); }
          }} aria-label={person.active ? "Desativar pessoa da equipe" : "Ativar pessoa da equipe"}><ShieldCheck size={16} /></button>}
        </article>)}</div> : <EmptyState icon={UserRound} title="Só você por enquanto" description="Adicione profissionais para compartilhar a agenda." />}</section>
    </div>
    {modal === "team" && <TeamMemberForm services={services} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {(modal === "service" || modal?.id) && <ServiceForm service={modal?.id ? modal : null} professionals={professionals} onClose={() => setModal("")} onSaved={() => { setModal(""); refresh(); }} />}
    {hoursFor && <TeamHours professional={hoursFor} onClose={() => { setHoursFor(null); refresh(); }} />}
  </>;
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
      <StatCard title="Faturamento recebido" value={money(report?.revenueCents)} note="Atendimentos concluídos" icon={CircleDollarSign} tone="green" />
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
  </>;
}

const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [hours, setHours] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { api("/settings").then((data) => { setSettings(data.settings); setHours(data.hours); }).catch((reason) => setError(reason.message)); }, []);
  const updateHour = (weekday, key, value) => setHours((current) => current.map((hour) => hour.weekday === weekday ? { ...hour, [key]: value } : hour));
  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage("");
    try { await api("/settings", { method: "PUT", body: { ...settings, hours } }); setMessage("Configurações salvas com sucesso."); }
    catch (reason) { setError(reason.message); }
  };
  if (!settings) return <Loading />;
  return <>
    <PageTitle eyebrow="O SEU ESPAÇO, DO SEU JEITO" title="Configurações" description="Mantenha as informações do seu negócio sempre atualizadas." />
    <form onSubmit={submit} className="settings-layout">
      <section className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">IDENTIDADE DO NEGÓCIO</p><h2>Seu espaço</h2></div><ShieldCheck size={20} className="text-emerald-500" /></div>
        <div className="settings-logo-row"><img src={settings.logoUrl || "/assets/simplifica-perfil.svg"} alt="" /><span><b>Logo do negócio</b><small>Adicione uma URL de imagem para personalizar seu perfil público.</small></span></div>
        <div className="form-stack mt-5">
          <Field label="Nome do negócio" required value={settings.businessName} onChange={(e) => setSettings({ ...settings, businessName: e.target.value })} />
          <Field label="Endereço da logo (opcional)" placeholder="/assets/simplifica-perfil.svg" value={settings.logoUrl} onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value })} />
          <Field label="Telefone / WhatsApp" type="tel" value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} />
          <Field label="Endereço" value={settings.address} onChange={(e) => setSettings({ ...settings, address: e.target.value })} />
          <SelectField label="Aparência" value={settings.theme} onChange={(e) => { setSettings({ ...settings, theme: e.target.value }); document.documentElement.classList.toggle("dark", e.target.value === "escuro"); }}>
            <option value="claro">Modo claro</option><option value="escuro">Modo escuro</option>
          </SelectField>
        </div>
      </section>
      <section className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">HORÁRIOS DE FUNCIONAMENTO</p><h2>Quando você atende</h2></div><Clock3 size={20} className="text-blue-500" /></div>
        <p className="panel-subtitle">Os clientes poderão agendar dentro destes horários.</p>
        <div className="business-hours-list">{hours.map((hour) => <div className="hours-row" key={hour.weekday}><b>{weekdays[hour.weekday]}</b>
          <label className="hours-check"><input type="checkbox" checked={!!hour.opensAt && !!hour.closesAt} onChange={(e) => {
            updateHour(hour.weekday, "opensAt", e.target.checked ? "09:00" : ""); updateHour(hour.weekday, "closesAt", e.target.checked ? "18:00" : "");
          }} /> Aberto</label>
          {hour.opensAt && <><input className="input hours-input" type="time" value={hour.opensAt} onChange={(e) => updateHour(hour.weekday, "opensAt", e.target.value)} />
            <span>às</span><input className="input hours-input" type="time" value={hour.closesAt} onChange={(e) => updateHour(hour.weekday, "closesAt", e.target.value)} /></>}
        </div>)}</div>
        <div className="public-url-card"><span className="shortcut-icon blue"><ExternalLink size={17} /></span><span><b>Sua página de agendamento</b><small>simplifica.local/agendar/studio-bela-vista</small></span><Link to="/agendar/studio-bela-vista" target="_blank" className="text-link"><ArrowRight size={16} /></Link></div>
      </section>
      <div className="settings-save"><ErrorMessage>{error}</ErrorMessage><span className="success-message">{message}</span><Button><Check size={16} /> Salvar configurações</Button></div>
    </form>
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { api(`/public/${slug}`).then(setData).catch((reason) => setError(reason.message)); }, [slug]);
  useEffect(() => {
    setSlots([]); setTime("");
    if (!serviceId || !professionalId || !date) return;
    api(`/public/${slug}/slots?serviceId=${serviceId}&professionalId=${professionalId}&date=${date}`)
      .then(({ slots: available }) => setSlots(available)).catch((reason) => setError(reason.message));
  }, [slug, serviceId, professionalId, date]);
  const service = data?.services.find((item) => item.id === serviceId);
  const professionals = data?.professionals.filter((person) => !serviceId || person.serviceIds.includes(serviceId)) ?? [];
  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage(""); setLoading(true);
    try {
      const result = await api(`/public/${slug}/appointments`, { method: "POST", body: {
        ...client, serviceId, professionalId, startsAt: `${date}T${time}:00`,
      } });
      setMessage(result.message);
      setTime("");
      setClient({ name: "", phone: "" });
    } catch (reason) { setError(reason.message); } finally { setLoading(false); }
  };
  if (!data && !error) return <div className="public-page"><Loading /></div>;
  if (error && !data) return <div className="public-page"><div className="public-booking-card"><img className="public-logo" src="/assets/simplifica-perfil.svg" /><h1>Não encontramos esse negócio</h1><p>{error}</p></div></div>;
  return <main className="public-page">
    <header className="public-topbar"><Link to="/" className="public-brand"><img src="/assets/simplifica-perfil.svg" />Simplifica <span>Agenda</span></Link><span>Agendamento online</span></header>
    <section className="public-booking-card">
      <div className="public-business"><img className="public-business-logo" src={data.business.logoUrl || "/assets/simplifica-perfil.svg"} alt="" />
        <div><p className="eyebrow">AGENDE SEU HORÁRIO</p><h1>{data.business.businessName}</h1><p>{data.business.address}</p></div>
      </div>
      {message ? <div className="booking-success"><span><Check size={25} /></span><h2>Horário solicitado!</h2><p>{message}</p><Button variant="secondary" onClick={() => setMessage("")}>Fazer outro agendamento</Button></div> :
        <form className="public-form" onSubmit={submit}>
          <div className="booking-step"><span>1</span><b>Escolha seu serviço</b></div>
          <div className="public-service-grid">{data.services.map((item) => <button key={item.id} type="button" onClick={() => { setServiceId(item.id); setProfessionalId(""); }}
            className={`public-service-card ${serviceId === item.id ? "public-service-selected" : ""}`}><span className="shortcut-icon blue"><Scissors size={18} /></span><span><b>{item.name}</b><small>{item.durationMinutes} min · {money(item.priceCents)}</small></span>{serviceId === item.id && <Check size={16} className="text-blue-600" />}</button>)}</div>
          <div className="booking-step"><span>2</span><b>Escolha profissional e data</b></div>
          <div className="form-grid">
            <SelectField label="Profissional" required value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Selecione</option>{professionals.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
            </SelectField>
            <Field label="Data" type="date" min={localDate()} required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="booking-step"><span>3</span><b>Horários disponíveis</b></div>
          {serviceId && professionalId ? <div className="slot-grid">{slots.length ? slots.map((slot) => <button type="button" className={`slot-button ${time === slot ? "slot-selected" : ""}`} onClick={() => setTime(slot)} key={slot}>{slot}</button>)
            : <p className="text-sm text-slate-500">Não há horários disponíveis nesta data.</p>}</div> : <p className="text-sm text-slate-400">Selecione o serviço e o profissional para ver os horários.</p>}
          <div className="booking-step"><span>4</span><b>Seus dados</b></div>
          <div className="form-grid"><Field label="Seu nome" required value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
            <Field label="WhatsApp" type="tel" required value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} /></div>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <Button className="w-full justify-center" disabled={loading || !time || !serviceId || !professionalId}>{loading ? "Solicitando..." : "Solicitar agendamento"}</Button>
          <p className="public-privacy"><ShieldCheck size={14} /> Seus dados são usados somente para organizar seu atendimento.</p>
        </form>}
    </section>
    <footer className="public-footer">Agendamento simples, do início ao fim. <span>Feito com carinho por Simplifica</span></footer>
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
    if (location.pathname.startsWith("/agendar/")) { setLoading(false); return; }
    Promise.all([
      api("/installation/status"),
      api("/auth/me").then(({ user: current }) => current).catch(() => null),
    ]).then(([status, current]) => { setInstallation(status); setUser(current); })
      .catch(() => setUser(null)).finally(() => setLoading(false));
  }, [location.pathname]);
  useEffect(() => {
    api("/settings").then(({ settings }) => document.documentElement.classList.toggle("dark", settings?.theme === "escuro")).catch(() => {});
  }, [user]);
  if (location.pathname.startsWith("/agendar/")) {
    const slug = decodeURIComponent(location.pathname.slice("/agendar/".length).split("/")[0]);
    return <PublicBooking slug={slug} />;
  }
  if (loading) return <div className="app-loading"><img src="/assets/simplifica-perfil.svg" alt="" /><Loading /></div>;
  if (installation?.needsSetup) return <InstallationSetup onReady={() => { setInstallation({ needsSetup: false, demoEnabled: false }); setUser(null); }} />;
  if (!user) return <Login key={String(installation?.demoEnabled)} onLogin={setUser} demoEnabled={installation?.demoEnabled} />;
  const logout = async () => { await api("/auth/logout", { method: "POST" }); setUser(null); };
  return <Shell user={user} onLogout={logout}>
    <Routes>
      <Route path="/" element={<OverviewPage user={user} />} />
      <Route path="/agenda" element={<AgendaPage user={user} />} />
      <Route path="/clientes" element={<ClientsPage user={user} />} />
      <Route path="/servicos" element={<ServicesPage user={user} />} />
      <Route path="/financeiro" element={user.role === "dono" ? <FinancePage /> : <AccessDenied />} />
      <Route path="/configuracoes" element={user.role === "dono" ? <SettingsPage /> : <AccessDenied />} />
      <Route path="*" element={<OverviewPage user={user} />} />
    </Routes>
  </Shell>;
}
