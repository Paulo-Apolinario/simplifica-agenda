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


## Divulgação do agendamento público e acesso administrativo

A agenda interna permanece em `/agenda`. A opção **Link de agendamento** abre uma tela de divulgação em `/compartilhar`, que oferece o endereço público específico do estabelecimento, cópia, abertura e compartilhamento por WhatsApp. O QR Code exibido nesta versão é carregado de um gerador externo (`api.qrserver.com`), recebendo **somente o endereço público** e exigindo internet. Para operação totalmente offline e controle completo, substituir futuramente por geração local com biblioteca dedicada.

Um endereço `localhost` funciona apenas na própria máquina; **não use um QR Code de localhost para clientes**. Para acesso por outros celulares, é necessário um domínio HTTPS ou endereço de rede acessível.

No perfil de demonstração, o menu oculta as áreas de edição exclusiva de conta, recebimentos e configurações. A visualização da agenda, serviços, clientes, relatórios e exemplo de compartilhamento permanece disponível, com as operações de escrita bloqueadas no servidor.

### Aba do navegador e cache

A interface agora declara explicitamente o ícone `simplifica-perfil.svg` como favicon. Ao testar em `localhost:3000` (servidor de build), execute `npm run build` antes de iniciar `npm start`, ou use o Vite `http://localhost:5173` com `npm run dev`. Caso uma versão anterior do PWA ainda apareça, limpe os dados/cache da origem e remova o service worker antigo pelas ferramentas do navegador. Use uma porta/domínio distinto para outros projetos que compartilhem `localhost`.

## Equipe, serviços e registro do profissional

As áreas **Serviços** (`/servicos`) e **Equipe e acessos** (`/equipe`) são separadas no menu. O proprietário gerencia equipe, senhas, horários e vínculos de serviços; o acesso de recepção mantém as permissões já previstas; o profissional tem um menu próprio com **Meus atendimentos** (`/meus-atendimentos`).

Na área do profissional são exibidos apenas os atendimentos atribuídos à própria conta, com filtros por mês, total realizado e valor bruto dos serviços. O profissional pode marcar um atendimento agendado ou confirmado como **concluído** após o início previsto, usando uma API específica; não pode editar preço, pagamento nem serviços de outros profissionais. O caixa continua sob gestão administrativa. O valor bruto exibido **não representa valor recebido nem comissão**.

O formulário administrativo de equipe já cadastra funcionários com e-mail, senha inicial, função, comissão e serviços atribuídos. Cada profissional deve fazer login com suas próprias credenciais. A senha deve ser alterada em **Minha conta**, e o proprietário pode redefini-la em **Equipe e acessos**.

A ação **Sair** ficou visível no perfil lateral e no topo da aplicação. A demonstração mantém seu bloqueio de gravações e oculta ações de edição nas telas de serviços.

### Próximas etapas propostas

1. **Solicitações e notificações:** central para distinguir novos pedidos públicos, confirmações, remarcações e cancelamentos, com estados bem definidos.
2. **Histórico de execução:** observações do serviço, data real, responsável, trilha de auditoria e retificação administrativa.
3. **Financeiro:** recebimentos parciais, estornos auditáveis, fechamento diário e relatórios por funcionário, sem atribuir falsamente pagamentos.
4. **Operação comercial:** backup/restauração ensaiados, instalação por comércio, HTTPS, privacidade de dados e testes em dispositivos reais.


## Acesso por código para profissionais (migração aditiva)

- A tela de login possui **Administração** (e-mail + senha) e **Profissional** (identificador do comércio + código de três dígitos + senha).
- Cada comércio começa no código **001**, seguindo **002, 003, ... 999**, sem reutilizar códigos antigos.
- O código é único **por empresa**, não global. O profissional sempre informa o identificador do comércio para evitar ambiguidades.
- Para novos profissionais, em **Equipe e acessos**, o proprietário cadastra nome, serviços, horários e comissão, sem exigir e-mail nem escolher a senha do funcionário. O sistema informa o código de matrícula e um **token de ativação de uso único válido por 24 horas**; compartilhe-o privadamente.
- No primeiro acesso, o profissional escolhe uma senha de **6 a 8 caracteres contendo letras e números**. A senha fica armazenada em hash bcrypt, nunca em texto simples.
- Profissionais antigos recebem código automaticamente ao iniciar a versão nova; nenhum registro, vínculo ou agendamento é eliminado. Para redefinir a senha deles, o proprietário utiliza **Configurar acesso** na listagem da equipe, gera um token temporário e o profissional usa **Primeiro acesso? Definir minha senha**. Sessões antigas são encerradas quando o administrador solicita essa nova ativação.
- Administração e recepção continuam usando e-mail e senha forte (12 ou mais caracteres). Os antigos logins por e-mail dos profissionais não são mais aceitos.
- As tentativas de login profissional possuem limite por código/comércio e por IP, em memória do processo. São necessários HTTPS e proteção adicional no proxy antes de implantar em rede pública. Senhas curtas têm risco de adivinhação; não as reutilize em outros sistemas.
- Com `DEMO_MODE=true`, o login demonstrativo de administrador permanece ativo. Cada instalação comercial deve usar seu próprio banco/volume e segredos.
- Faça backup do banco SQLite **antes** de atualizar o sistema em um computador com dados existentes. A migração adiciona colunas e atribui códigos, sem recriar as tabelas.


## Painel do profissional: ganhos e bloqueios de agenda

A visão geral do profissional apresenta **atendimentos hoje**, **serviços concluídos hoje**, **saldo total de comissões a receber** (todos os períodos) e **próximo atendimento**, removendo as métricas de clientes ativos e agendamentos mensais desse perfil. O administrador e a recepção mantêm os seus indicadores atuais.

A aba **Meus ganhos** (`/meus-ganhos`) apresenta, para cada mês, serviços concluídos, percentual de comissão capturado quando o serviço foi agendado, valor da comissão, status **A receber/Pago**, e totais de comissões acumuladas, recebidas e pendentes. **Não use preço total do serviço como remuneração do profissional.** Os valores são calculados por serviço, arredondados em centavos.

O proprietário possui a aba **Comissões da equipe** (`/comissoes`) para registrar, após realizar o pagamento, a quitação individual de uma comissão. O registro é persistido em `commission_payments`, não permite pagar duas vezes a mesma comissão e impede alterar atendimentos cuja comissão já foi marcada paga. A operação **não transfere recursos**; apenas registra o pagamento informado pelo proprietário. Para estornos e ajustes, será necessária uma futura rotina auditável; esta versão não faz pagamento parcial.

Na **Agenda**, um profissional pode bloquear e desbloquear **somente seus próprios horários**, informando início, término e observação (por exemplo, almoço ou compromisso). Bloqueios que colidem com atendimentos ativos são recusados; outros funcionários e o calendário da empresa não podem ser bloqueados por esse perfil.

No **agendamento interno**, selecionar cliente é opcional. Se não for selecionado, o sistema cria um registro individual `Cliente não informado` para preservar o relacionamento do banco e não perder o agendamento. A página de reserva pública ainda solicita nome e WhatsApp, como antes.

### Validações antes de usar comercialmente

- Confira com cada profissional se a comissão contratada e os serviços atribuídos estão corretos.
- Teste data/hora, bloqueios e desbloqueios, agendamentos sem cliente e registro administrativo de comissão paga.
- Faça backup do arquivo SQLite antes de atualizar. Esta versão cria a tabela adicional `commission_payments` sem descartar registros existentes.
- O fluxo não calcula salários fixos, adiantamentos, descontos, impostos, folhas de pagamento ou conciliação bancária; esses itens exigem regras próprias.

## Equipe, recepção e comissões ajustáveis (novembro/2026)

- **Login do profissional:** basta informar o código de três dígitos e a senha pessoal. Cada instalação possui uma sequência de códigos **única globalmente entre as empresas do mesmo banco**, iniciando em 001 e avançando até 999. Códigos antigos por empresa continuam preservados internamente, mas a interface mostra o novo código único de login. A migração não remove cadastros, senhas, agendas ou sessões. O administrador pode consultar o novo código na equipe e gerar uma nova ativação, se necessário.
- **Equipe flexível:** o administrador informa um **cargo/função livre** (cabeleireiro, manicure, depiladora, copeira etc.) e separadamente o **perfil de acesso**: profissional, recepção ou funcionário sem acesso. Funcionários sem acesso têm cadastro administrativo em tabela própria, sem credenciais nem permissão para agendar. Para profissionais e recepção, o cargo é independente da permissão RBAC.
- **Recepção:** a página inicial apresenta os atendimentos de hoje, pendentes de confirmação, confirmados, bloqueios, prioridades e atalhos para agenda, clientes e link público. Permissões financeiras e administrativas continuam protegidas.
- **Bloqueios:** a agenda passa a registrar o ID do usuário responsável pelo bloqueio e exibe o nome de quem bloqueou, além do profissional e do motivo. Bloqueios antigos, sem autor gravado, aparecem como “Não identificado”.
- **Visão geral profissional:** substitui o saldo financeiro por **Bloqueios hoje**. A remuneração continua disponível somente na aba Meus ganhos.
- **Comissões:** há uma comissão padrão editável por profissional e uma retenção configurável por serviço, expressa em **pontos percentuais do preço** quando os produtos são fornecidos pelo comércio. Exemplo: serviço R$ 120, comissão 40%, retenção 10 pontos = comissão efetiva de 30%, equivalente a R$ 36. A comissão e a retenção são copiadas para cada novo agendamento, inclusive público, preservando o histórico.
- **Ajuste excepcional de serviço concluído:** o proprietário pode alterar os dois percentuais na aba Comissões da equipe, informando o motivo. A tabela `commission_adjustments` preserva percentuais antes/depois e responsável pelo ajuste. Não é permitido alterar sem estorno auditado se a comissão já estiver marcada como paga.
- **Segurança e instalação:** faça backup do SQLite com o servidor parado antes de atualizar. As migrações só adicionam tabelas/colunas, sem apagar dados. Senhas de 6–8 caracteres com código curto exigem proteção adicional no proxy (HTTPS, tentativas e monitoramento) antes de exposição pública.

## Configurações do estabelecimento e conclusão de serviços

A tela **Configurações do estabelecimento** (`/configuracoes`) já permitia editar nome, telefone, endereço, logo, aparência e expediente. Agora inclui um campo **WhatsApp do estabelecimento** independente do telefone principal; requer DDD e número brasileiro, aceita com ou sem 55 e grava apenas dígitos. O proprietário pode testar o link `wa.me` e o contato aparece na página pública. Essa integração apenas abre uma conversa: **não envia mensagens automaticamente**, nem usa API paga do WhatsApp. A demonstração segue sem permissão de alteração.

Em **Próximos atendimentos** da visão geral, o administrador pode clicar em um atendimento para abrir diretamente o modal **Detalhes do atendimento**, modificar status, data/hora e pagamento conforme suas permissões. A agenda principal mantém seu fluxo próprio.

No perfil profissional, **Meus atendimentos** e **Detalhes do atendimento** disponibilizam **Concluir serviço realizado** para atendimentos agendados ou confirmados atribuídos ao usuário. Caso o horário programado ainda não tenha começado, o sistema exige uma confirmação explícita de que o serviço foi realmente realizado antecipadamente. A conclusão registra o status como `concluido` e **não marca pagamento automaticamente**; o valor fica pendente no Caixa e recebimentos, onde o proprietário pode registrar o recebimento. Profissionais continuam sem acesso a preço, forma de pagamento, financeiro de outros funcionários ou alterações de serviços de terceiros.

Antes de atualizar instalações com dados, **pare o servidor e faça backup do arquivo SQLite**. A migração do campo WhatsApp é aditiva.
