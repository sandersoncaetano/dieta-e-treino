# Dieta e Treino

App pessoal de dieta e treino. É a mesma página que rodava como artefato no claude.ai, agora com serviços próprios:

| Antes (claude.ai) | Agora |
|---|---|
| Banco do artefato | Supabase (tabela `docs`, tempo real) |
| Fotos | Supabase Storage (bucket `fotos`) |
| Cálculo por IA | `/api/ia` → API da Anthropic |
| Conector do Strava | `/api/strava` → API oficial do Strava |
| Abrir pelo claude.ai | PWA: ícone na tela inicial |

A troca acontece em `public/plataforma.js`, que recria o `window.claude.use(...)` que o app já usava. O código do app em `public/index.html` ficou praticamente igual.

## Estrutura

```
public/index.html          o app
public/plataforma.js       login, banco, fotos, IA e Strava
public/sw.js               cache para abrir rápido e com sinal fraco
public/manifest.webmanifest + icons/   instalação como app
api/config.js              entrega à página o endereço e a chave pública do Supabase
api/ia.js                  chama a Anthropic com a chave guardada no servidor
api/strava*.js             conexão OAuth e leitura das atividades
supabase/schema.sql        tabelas, regras de acesso e bucket de fotos
scripts/importar-backup.mjs  importa o backup do artefato
```

## Passo a passo

### 1. Supabase
1. Crie um projeto em supabase.com (região São Paulo).
2. Em **SQL Editor**, rode `supabase/schema.sql`.
3. Em **Authentication > Users**, clique em **Add user** e crie o seu, com o seu e-mail.
4. Em **Authentication > Sign In / Providers**, deixe o login por e-mail ligado e **desligue "Allow new users to sign up"**. Assim ninguém mais cria conta.
5. Em **Authentication > URL Configuration**, coloque o endereço do app (passo 3) em **Site URL**.
6. Em **Project Settings > API Keys**, a chave em **Secret keys** (começa com `sb_secret_`) é a `SUPABASE_SERVICE_ROLE_KEY`. A chave pública (`SUPABASE_ANON_KEY`) é a anon legada, em **View legacy API keys**.

### 2. Anthropic
1. Em console.anthropic.com, crie uma chave de API.
2. Defina um **limite de gasto mensal** (Billing > Limits). Recomendo começar com um valor baixo.

### 3. GitHub e Vercel
1. Crie um repositório privado no GitHub e envie esta pasta.
2. Em vercel.com, **Add New > Project**, escolha o repositório. Framework: **Other**. Não precisa de build.
3. Em **Settings > Environment Variables**, cadastre tudo de `.env.example`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `EMAILS_PERMITIDOS` (seu e-mail), `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `APP_URL` (ex.: `https://dieta-e-treino.vercel.app`).
4. Faça o deploy de novo depois de cadastrar as variáveis.

### 4. Strava
1. Em strava.com/settings/api, crie um aplicativo.
2. **Authorization Callback Domain**: o domínio do app, sem `https://` (ex.: `dieta-e-treino.vercel.app`).
3. Copie Client ID e Client Secret para o Vercel.
4. No app, abra **Conta > Conectar ou reconectar Strava** (canto inferior esquerdo).

### 5. Dados
1. Pegue o último backup em `backup/dieta-e-treino-dados.json` (projeto "Saúde e bem Estar").
2. Descubra o seu `USER_ID` em Supabase > Authentication > Users.
3. Rode:
   ```
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... node scripts/importar-backup.mjs dieta-e-treino-dados.json
   ```
4. **Fotos:** as fotos antigas apontam para o claude.ai e não abrem fora dele. A cópia delas para o Supabase é um passo separado, feito com o Claude.

### 6. Instalar no celular
Abra o endereço no Chrome do Android, entre com o link do e-mail e use **Adicionar à tela inicial**.

## Segurança
- A chave da Anthropic, a chave de serviço do Supabase e os tokens do Strava ficam só no servidor.
- O banco só deixa cada usuário ler e gravar os próprios registros (RLS).
- As rotas `/api/ia` e `/api/strava` exigem login e e-mail em `EMAILS_PERMITIDOS`, para ninguém gastar a sua cota.
- As fotos ficam num bucket público com nomes aleatórios. Quem não tem o endereço exato não encontra.

## Pontos em aberto
- Custo da IA por uso: acompanhar no primeiro mês em console.anthropic.com.
- Termos da API do Strava sobre uso de dados com IA: confirmar antes de usar a análise das atividades com dados do Strava.
- A lista do Strava não traz clima (temperatura e umidade), que o conector trazia. A análise segue sem esse dado.
