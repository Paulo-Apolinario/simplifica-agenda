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

O comando inicia o servidor Express em `http://localhost:3000` e o Vite em `http://localhost:5173`. O banco SQLite é criado automaticamente no primeiro início. Em desenvolvimento, o projeto mantém os dados demonstrativos por padrão; defina `DEMO_MODE=false` para testar uma instalação limpa.

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

Copie `.env.example` para `.env` para ajustar a porta, o banco, as credenciais do seed e a chave de sessão. O `.env` e os bancos locais são ignorados pelo Git. **Não use credenciais e dados demonstrativos em instalações comerciais.**

## Docker

Configure `.env` na raiz com uma chave de sessão aleatória e, na instalação comercial, um token de instalação diferente:

```env
SESSION_SECRET=gere-uma-chave-aleatoria-com-pelo-menos-32-caracteres
INSTALL_TOKEN=gere-um-segundo-segredo-aleatorio-de-pelo-menos-32-caracteres
DEMO_MODE=false
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

## Instalação comercial e modo de demonstração (versão em preparação)

**Mantenha o modo demonstrativo para apresentações**, mas execute-o em um banco/volume e endereço separados dos clientes reais.

- **Comércio real:** configure `NODE_ENV=production`, `DEMO_MODE=false`, `SESSION_SECRET` e `INSTALL_TOKEN` distintos e aleatórios, com pelo menos 32 caracteres. Na primeira visita, a tela "Configure seu comércio" solicita o código `INSTALL_TOKEN` e cadastra empresa, identificador e dono. Depois da criação, a configuração inicial é bloqueada automaticamente. Defina os serviços, horários e profissionais após entrar.
- **Demonstração:** use `DEMO_MODE=true` apenas em uma instalação **separada**. O cadastro de demonstração é mantido e o login informa as credenciais demo. O modo demo não substitui a criação de um administrador comercial.
- **Ambiente local de desenvolvimento:** mantém o seed demonstrativo por padrão. Para testar o primeiro acesso sem demo, defina `DEMO_MODE=false` e utilize um banco SQLite vazio.
- **Persistência:** `docker compose down` conserva o volume. Um banco já existente não é limpo ao alternar `DEMO_MODE`; para iniciar uma nova instalação use um volume novo, preservando backups antes de qualquer operação de exclusão.
- **Segurança:** não reutilize `INSTALL_TOKEN` entre clientes; não versionar `.env`; não exponha a porta 3000 diretamente à internet. Para acesso remoto, configure um proxy HTTPS e `COOKIE_SECURE=true`. Em uma rede local via HTTP, `COOKIE_SECURE=false` pode ser necessário, mas a rede deve ser confiável.
- **Aviso:** ainda são necessários testes de ponta a ponta, limitação de tentativas de autenticação, proteção de rotas de agendamento público, backup por empresa e homologação antes de instalar em produção.

## Testes comerciais com a demonstração ativa

Para criar um **comércio de testes** ao lado do salão demonstrativo, em uma base **local de desenvolvimento**, configure o arquivo `.env`:

```env
DEMO_MODE=true
NODE_ENV=development
```

No PowerShell, execute na raiz do repositório (substitua os valores pelos dados que foram fornecidos fora do código):

```powershell
$env:TEST_ACCOUNT_EMAIL="seu-email-de-teste"
$env:TEST_ACCOUNT_PASSWORD="sua-senha-forte-temporaria"
npm run provision:test -w server
npm run dev
```

O script cria a empresa `Comércio Teste`, identificador `comercio-teste`, um administrador comercial e um profissional com serviço de exemplo. Ele não grava senhas em arquivos e não funciona com `NODE_ENV=production`. Se executado novamente, atualiza a senha do administrador de teste, encerra suas sessões e evita duplicar os dados. **Não executar em banco real de cliente.**

- **Login demo:** `admin@simplifica.local` / `Agenda123!`, identificador `studio-bela-vista` (apenas quando `DEMO_MODE=true` e o seed tiver sido executado).
- **Login comercial de teste:** e-mail e senha informados em `TEST_ACCOUNT_EMAIL` e `TEST_ACCOUNT_PASSWORD`, identificador `comercio-teste`.

### Restrições do ambiente demonstrativo

O salão de demonstração pode ser visitado para apresentação da interface e consulta de dados de exemplo. As restrições são verificadas no backend, inclusive quando alguém chama a API diretamente.

| Recurso | Demonstração | Conta comercial |
| --- | --- | --- |
| Entrar e navegar nas telas | Sim | Sim |
| Consultar clientes, serviços, agenda e relatórios conforme perfil | Sim | Sim |
| Criar/editar clientes, funcionários, serviços, agenda e configurações | Não | Sim, conforme perfil |
| Registrar recebimentos ou modificar dados de conta | Não | Sim, conforme perfil |
| Fazer reserva real na página pública demonstrativa | Não | Sim na página própria |
| Exportar CSV | Não | Sim, conforme perfil |
| Backup pelo painel | Não | Sim, **somente em banco de uma única empresa** |

**Atenção:** se a demonstração e o comércio de testes compartilham o mesmo SQLite, o backup completo pelo painel permanece bloqueado para impedir exposição dos dados de outras empresas. Use um banco separado para testar backup/restauração. Instalações comerciais independentes continuam recomendadas.

### Caixa e recebimentos (etapa 2 inicial)

Um atendimento `concluido` sem `payment_method` fica em **A receber**. O sistema não supõe pagamento em dinheiro. Na nova tela `Caixa e recebimentos`, o proprietário registra a forma de pagamento, e o valor passa para **Recebido**. O registro evita cobrança duplicada via mesma rota. Ainda faltam histórico/auditoria de estornos, parcelas e integração com meios de pagamento; não trate a tela como conciliação bancária ou comprovante fiscal.

