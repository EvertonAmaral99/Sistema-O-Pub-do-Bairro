# O Pub do Bairro — Sistema de Gestão

Sistema web para operação interna do bar, desenvolvido com Next.js, TypeScript e PostgreSQL. A aplicação foi preparada para uso no computador do caixa e publicação pela Railway.

## Recursos da primeira versão

- login com perfis de Administrador, Gerente, Caixa e Cozinha;
- comandas numeradas vinculadas às mesas;
- cadastro de produtos, categorias, preços, setor e saldo;
- baixa automática do estoque ao lançar um item;
- devolução automática ao estoque ao remover um item;
- envio de pedidos para cozinha e bar por botão;
- painel de produção com Aguardando, Em preparo, Pronto e Entregue;
- abertura e fechamento diário do caixa;
- pagamentos em dinheiro, Pix, débito e crédito;
- divisão do pagamento entre métodos;
- desconto, taxa de serviço, valor recebido e troco;
- notinha da venda em página separada;
- impressão em térmica de 58 mm, 80 mm ou folha A4;
- relatório de fechamento do caixa;
- relatórios por período e produtos mais vendidos;
- cancelamento de venda por Administrador ou Gerente, com retorno dos itens ao estoque.

## Ambiente local

Requer Node.js 22 ou superior e PostgreSQL.

1. Copie `.env.example` para `.env.local`.
2. Preencha `DATABASE_URL` e crie uma chave longa em `SETUP_KEY`.
3. Instale as dependências com `npm install`.
4. Execute `npm run db:migrate`.
5. Inicie com `npm run railway:dev`.
6. Acesse `http://localhost:3000`.

No primeiro acesso, informe a `SETUP_KEY` para criar a conta de Administrador. Depois disso, novos funcionários podem ser cadastrados em Configurações.

## Publicação na Railway pelo GitHub

1. Crie um repositório no GitHub e envie estes arquivos.
2. Na Railway, crie um projeto usando **Deploy from GitHub repo**.
3. Adicione um serviço PostgreSQL ao mesmo projeto.
4. No serviço da aplicação, defina:
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `SETUP_KEY` com uma chave longa e reservada
   - `DATABASE_SSL=false`
5. A Railway lerá `railway.json`, executará a migração e iniciará a aplicação.
6. Em **Settings → Networking**, selecione **Generate Domain**.
7. Abra o endereço gerado e crie o primeiro Administrador.

O endereço da aplicação pode ser público, mas todas as telas operacionais ficam protegidas pelo login.

## Comandos

- `npm run railway:dev` — ambiente de desenvolvimento;
- `npm run railway:build` — compilação de produção;
- `npm run railway:start` — inicia a versão compilada;
- `npm run db:migrate` — aplica as migrações do banco.

## Segurança

- senhas armazenadas com hash `scrypt` e salt individual;
- sessões em cookies `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- permissões verificadas no servidor;
- cancelamentos limitados aos perfis autorizados;
- valores monetários armazenados em centavos;
- alterações de estoque registradas em histórico.
