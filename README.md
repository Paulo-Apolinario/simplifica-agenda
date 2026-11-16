# Simplifica Agenda

Sistema local de agendamentos para pequenos negócios, com interface em português, agenda web responsiva e página pública de reservas.

## Requisitos

- Node.js 22 ou superior (para instalação local, Node.js 20.19+ também funciona).
- npm.
- Docker e Docker Compose, caso prefira executar em contêiner.

## Instalação e execução local

Na raiz do projeto:

```bash
npm install
npm run dev
```

O comando inicia o servidor Express em `http://localhost:3000` e o Vite em `http://localhost:5173`. O banco SQLite e os dados de demonstração são criados automaticamente no primeiro início, em `server/data/simplifica-agenda.sqlite`.

Para criar ou completar os dados de demonstração manualmente:

```bash
npm run seed
```

O seed é idempotente: pode ser executado novamente sem duplicar os registros. Por padrão, o acesso de demonstração é:

- **Dono:** `admin@simplifica.local` / `Agenda123!`
- **Profissional:** `ana@simplifica.local` / `Agenda123!`
- **Profissional:** `luiza@simplifica.local` / `Agenda123!`
- **Recepção:** `recepcao@simplifica.local` / `Agenda123!`
- **Página de agendamento:** `http://localhost:5173/agendar/studio-bela-vista`

Copie `.env.example` para `.env` para ajustar a porta, o banco, as credenciais do seed e a chave de sessão. O `.env` e os bancos locais são ignorados pelo Git. Troque as credenciais de demonstração antes de usar o sistema com dados reais.

## Docker

Configure `.env` na raiz com, no mínimo, uma chave de sessão aleatória:

```env
SESSION_SECRET=gere-uma-chave-aleatoria-com-pelo-menos-32-caracteres
```

Para gerar uma chave localmente:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Inicie o contêiner:

```bash
docker compose up --build -d
```

A aplicação fica em `http://localhost:3000`; outros dispositivos na rede local podem acessá-la pelo IP do computador que executa o Docker. Os dados SQLite persistem no volume Docker `simplifica-data`. Para acompanhar os logs, use `docker compose logs -f`; para parar sem apagar o banco, use `docker compose down`. Não encaminhe essa porta diretamente para a internet.

## Comandos

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia API e interface em desenvolvimento |
| `npm run build` | Gera a interface de produção em `web/dist` |
| `npm start` | Inicia o servidor; serve o build do Vite quando disponível |
| `npm test` | Executa os testes de regras de agenda |
| `npm run seed` | Insere dados demonstrativos de forma idempotente |

## Funcionalidades

- Login com sessão persistida no SQLite, cookie `HttpOnly`/`SameSite=Lax` e senhas com bcrypt.
- Perfis de dono, profissional e recepção; permissões por ação e separação dos dados por empresa.
- Cadastro e busca de clientes, observações e histórico de atendimentos.
- Serviços com duração, preço e profissionais associados; comissão e horários individuais da equipe.
- Agenda em visualização diária e semanal, com conflitos bloqueados, confirmação, conclusão, cancelamento, registro de falta, remarcação e bloqueio de horários.
- Página pública `/agendar/:slug`, com escolha de serviço, profissional, data e horário disponível.
- Links `wa.me` com texto pronto para lembrete, confirmação e retorno de clientes. A mensagem é aberta no WhatsApp para revisão; o sistema não envia mensagens automaticamente.
- Financeiro e relatórios mensais: faturamento concluído, formas de pagamento, comissão, serviços em destaque e clientes sem retornar há 30 dias ou mais.
- Exportação CSV de clientes e atendimentos e download de backup SQLite consistente.
- Aplicação instalável como PWA, incluindo ícone para iPhone e funcionamento offline do shell da interface.
- Tema claro/escuro, marca em `/assets/simplifica-perfil.svg` e layout adaptado para celular e desktop.

## Dados e isolamento

O banco é inicializado em `server/src/database.js`. Todas as entidades operacionais carregam `tenant_id`; as consultas da API filtram pela empresa da sessão. As principais tabelas são:

- `tenants`, `users`, `business_settings` e `sessions` para empresa, contas, configurações e sessões;
- `clients`, `services`, `professional_services`, `business_hours` e `professional_hours` para cadastro e disponibilidade;
- `appointments` e `blocked_slots` para agenda, status, preço, pagamento e comissão.

As senhas são armazenadas como hashes bcrypt. As datas da agenda são gravadas como horário local do negócio (`America/Sao_Paulo` por padrão); o horário comercial e o expediente individual precisam permitir o período antes da reserva. Atendimentos cancelados e faltas não bloqueiam novos horários.

## Segurança e armazenamento

- Defina `SESSION_SECRET` com pelo menos 32 caracteres em produção.
- O Compose desativa o atributo `Secure` do cookie porque serve HTTP apenas em `localhost`. Em uma implantação atrás de HTTPS, remova `COOKIE_SECURE: "false"` do Compose ou defina `COOKIE_SECURE=true`.
- O Compose disponibiliza a porta na rede local para o acesso pelo celular; mantenha a autenticação e não encaminhe a porta diretamente para a internet.
- A interface se adapta a celulares. Para instalar como PWA no iPhone, abra a página em uma origem HTTPS confiável no Safari e use **Compartilhar → Adicionar à Tela de Início**; o HTTP local continua disponível para desenvolvimento e uso na rede confiável.
- O arquivo SQLite, seus arquivos auxiliares e `.env` não devem ser versionados.
- O backup baixado contém os dados completos do banco. Armazene-o em local protegido.

## Testes

```bash
npm test
```

Os testes cobrem sobreposição de intervalos, encaixes contíguos, atendimentos cancelados e bloqueios de agenda.
