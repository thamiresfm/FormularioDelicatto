# Formulário Delicatto (Caixa Love)

> Versões antigas falavam em `/docs`, Render e `DELICATO_API_URL`. **Isso não vale mais.**

## O que o projeto faz hoje

- Após **confirmar o pedido**, o cliente usa **um botão** para abrir o **WhatsApp** com o texto do pedido (número da loja no `app.js`).
- **GitHub Pages** publica HTML/CSS/JS na **raiz** do repositório. **Sem** backend obrigatório para o fluxo do formulário.

## Rodar local

```bash
npm install
npm start
```

Abra `http://localhost:3000`. O `server.js` serve a pasta `public/`.

## GitHub Pages (raiz `/`)

**Settings → Pages → Branch: `main`, Folder: `/ (root)`**.

1. Edite **`public/`** (formulários em `public/formulariocaixalove/` etc., rastreio em `public/rastreios/`).
2. `npm run sync-pages` — copia para a raiz do repo o mesmo esquema das caixas **e** a pasta `rastreios/` (página pública + `rastreios/admin/`), para o Pages servir `/rastreios/` como serve `/formulariocaixalove/`.
3. Commit e push na raiz: `index.html`, pastas dos formulários, `rastreios/`, `js/`, `.nojekyll`.

### Rastreio: site estático (Pages) + API no Node

- Com **`npm start`**, a pasta `public/` já inclui `rastreios/`; o servidor entrega **`/rastreios/`** por `express.static`, igual às caixas — não precisa de passo extra.
- No **GitHub Pages** (só HTML), `POST /api/rastreio/consultar` devolve **405** (o Pages não executa Node). No `public/rastreios/index.html`, use a meta **`delicatto-api-base`** com a **URL base onde a API Node está** (Render, Railway, VPS, etc.) — **não** use o mesmo domínio se ele só aponta para o Pages. Ex.:  
  `<meta name="delicatto-api-base" content="https://sua-api.onrender.com" />`  
  (sem barra no fim). **Vazio** = mesma origem (só funciona quando o domínio já aponta para o processo que roda `server.js`).

### OAuth Melhor Envio (`/oauth/melhor-envio/iniciar` → `/oauth/callback`)

O código já lê `ME_CLIENT_ID`, `ME_CLIENT_SECRET` e `ME_OAUTH_REDIRECT_URI` em `process.env` (ver `.env.example`).

**Secrets no GitHub (Environment `github-pages`):** guardar ali **não** coloca essas variáveis no site estático nem no Node por si só. Elas só ficam disponíveis em **GitHub Actions** se o workflow declarar `environment: github-pages` e passar os valores para o deploy (por exemplo, para um serviço que rode `server.js`).

**Para o OAuth funcionar de verdade:** o servidor Node que recebe `GET /oauth/callback?code=...` precisa ter as mesmas três variáveis configuradas no **hosting do Node** (Render, VPS, Railway, etc.) ou no `.env` local — **igual** ao redirect cadastrado no app do Melhor Envio (ex.: `https://delicattopersonalizados.com.br/oauth/callback`, sem barra final). O domínio do callback deve apontar para esse Node, não só para o GitHub Pages.

## Render (Web Service)

- **Build:** `npm install` (o script `postinstall` executa `prisma generate`). O pacote **`prisma` está em `dependencies`** para o Render instalar em produção (antes, só em `devDependencies`, o build falhava ou o serviço não subia).
- **Start:** `npm start` ou `node server.js`.
- **Variáveis:** `ME_CLIENT_ID`, `ME_CLIENT_SECRET`, `ME_OAUTH_REDIRECT_URI`, `ME_API_BASE`, etc. têm de estar no **painel Environment do Render** — secrets do GitHub **não** são aplicados sozinhos.
- **Plano free:** o serviço “dorme”; o primeiro acesso pode levar **~1 minuto** a responder.
- **Teste rápido:** abrir `GET …/api/rastreio/health` (deve devolver JSON com `ok: true`).

## Problemas comuns

| Situação | O que fazer |
|----------|-------------|
| Site desatualizado no ar | `npm run sync-pages`, commit e push. |
| Rastreio: **405** ao consultar | O domínio está a servir só estático (ex.: Pages). Defina **`delicatto-api-base`** no `public/rastreios/index.html` com a URL do backend Node, ou aponte o DNS/proxy para o servidor onde corre `npm start`. |
| **Render** não abre / deploy falhou | Ver **Logs** no painel. Confirme **Build Command** `npm install` e que o build mostra `prisma generate`. Variáveis **`ME_*`** no Render (não `NE_*`). |
| WhatsApp não abre (app interno) | Abrir o site no **Safari** ou **Chrome**. |

---

## OpenAI (opcional, só no `npm start`)

Sugestão de frase via `POST /api/ia/sugestao-frase` — veja `.env.example` e a seção no `server.js`. **Nunca** coloque a chave no frontend.
