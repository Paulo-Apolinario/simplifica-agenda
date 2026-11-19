# Backup e recuperação — Simplifica Agenda

## Operação

Na Central SaaS, entre com uma conta individual de operador e abra **Backup e segurança**.
Crie a cópia, valide sua integridade e faça o download. A chave de recuperação não
autoriza download de backups completos. O proprietário de um estabelecimento
pode exportar seus próprios dados em Configurações > Segurança e dados.

## Configuração local do servidor

- `BACKUP_DIR`: caminho de armazenamento privado, fora da aplicação pública e do repositório.
  Por padrão, a subpasta `backups` do diretório do banco.
- `BACKUP_INTERVAL_HOURS`: intervalo de 1 a 168 horas entre cópias. Em produção,
  padrão de 24 horas. Localmente, padrão 0 (desativado).
- A rotina depende do processo do servidor estar em execução, verifica a necessidade
  de cópia na inicialização e depois a cada minuto. Não apaga backups antigos automaticamente.

Cada backup tem um arquivo SQLite e um manifesto JSON contendo data, tamanho
e SHA-256. A cópia passa por verificação SQLite e de integridade referencial.
As sessões de usuário e de operador e os convites de ativação são removidos do backup,
sem alterar o banco ativo. O backup ainda contém dados pessoais e hashes de senhas:
proteja o armazenamento com permissões restritas e criptografia de disco.
Mantenha uma segunda cópia criptografada fora do servidor. Não envie backups ao GitHub.

## Recuperação

1. Confirme a identidade do operador e valide o arquivo e o manifesto.
2. Copie o backup para uma pasta privada separada e teste a aplicação com
   `DATABASE_PATH` apontando exclusivamente para essa cópia, sem acesso público
   e sem integrações externas habilitadas.
3. Confira estabelecimentos, usuários, agenda, caixa, estoque e relatórios.
4. Se uma recuperação do ambiente real for necessária, obtenha aprovação para a
   janela de manutenção, desligue o servidor e preserve o banco ativo **e seus
   arquivos WAL/SHM**. Somente depois um operador autorizado deverá realizar
   a substituição offline e reiniciar a aplicação.
5. Confira a integridade e o funcionamento antes de reabrir o acesso.
   As sessões antigas não serão restauradas; os usuários devem entrar novamente.

Não há botão de restauração que sobrescreva o banco ativo. A exportação JSON
por estabelecimento é destinada à portabilidade/consulta e não constitui
uma cópia SQLite restaurável.
