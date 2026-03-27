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
- No **GitHub Pages** (só HTML), a consulta chama `POST /api/rastreio/consultar`. Esse endpoint **não existe** no Pages; precisa de um backend Node noutro host (ou o mesmo domínio a apontar para esse servidor). No `public/rastreios/index.html`, use a meta **`delicatto-api-base`** com a URL base da API, por exemplo:  
  `<meta name="delicatto-api-base" content="https://delicattopersonalizados.com.br" />`  
  (sem barra no fim). Vazio = mesma origem (ideal quando o HTML e o Node são o mesmo site).

### OAuth Melhor Envio (`/oauth/melhor-envio/iniciar` → `/oauth/callback`)

O código já lê `ME_CLIENT_ID`, `ME_CLIENT_SECRET` e `ME_OAUTH_REDIRECT_URI` em `process.env` (ver `.env.example`).

**Secrets no GitHub (Environment `github-pages`):** guardar ali **não** coloca essas variáveis no site estático nem no Node por si só. Elas só ficam disponíveis em **GitHub Actions** se o workflow declarar `environment: github-pages` e passar os valores para o deploy (por exemplo, para um serviço que rode `server.js`).

**Para o OAuth funcionar de verdade:** o servidor Node que recebe `GET /oauth/callback?code=...` precisa ter as mesmas três variáveis configuradas no **hosting do Node** (Render, VPS, Railway, etc.) ou no `.env` local — **igual** ao redirect cadastrado no app do Melhor Envio (ex.: `https://delicattopersonalizados.com.br/oauth/callback`, sem barra final). O domínio do callback deve apontar para esse Node, não só para o GitHub Pages.

## Problemas comuns

| Situação | O que fazer |
|----------|-------------|
| Site desatualizado no ar | `npm run sync-pages`, commit e push. |
| WhatsApp não abre (app interno) | Abrir o site no **Safari** ou **Chrome**. |

---

## OpenAI (opcional, só no `npm start`)

Sugestão de frase via `POST /api/ia/sugestao-frase` — veja `.env.example` e a seção no `server.js`. **Nunca** coloque a chave no frontend.
