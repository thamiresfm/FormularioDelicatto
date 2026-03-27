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
- No **GitHub Pages** (só HTML), `POST /api/rastreio/consultar` devolve **405** (o Pages não executa Node). O `public/rastreios/index.html` já define por defeito a API no **Render** (`delicatto-api-base`); em **localhost** o script na página zera a meta para usar o `npm start` na mesma origem. Ajuste a URL no HTML se o nome do serviço no Render mudar.
- Avisos no **Console** do browser sobre **Vue** ou **MetaMask** costumam vir de **extensões** ou de outro separador — a página de rastreio deste repo não usa Vue.

### Melhor Envio: token do painel (recomendado)

Para integração com a API, o servidor usa **`ME_PANEL_ACCESS_TOKEN`** (JWT em **Permissões de acesso** no painel Melhor Envio) **sempre que estiver definido**; OAuth não é usado nesse caso. Preencha **`ME_API_BASE`** e o JWT no **Environment do Render** (ou `.env` local). Pode deixar vazios `ME_CLIENT_ID`, `ME_CLIENT_SECRET` e `ME_REFRESH_TOKEN`.

Quando o JWT expirar, gere outro no painel e atualize a variável.

### OAuth Melhor Envio (opcional, só sem `ME_PANEL_ACCESS_TOKEN`)

Rotas `/oauth/melhor-envio/iniciar` → `/oauth/callback` — o código lê `ME_CLIENT_ID`, `ME_CLIENT_SECRET` e `ME_OAUTH_REDIRECT_URI` (ver `.env.example`).

**Secrets no GitHub (Environment `github-pages`):** guardar ali **não** coloca essas variáveis no site estático nem no Node por si só. Elas só ficam disponíveis em **GitHub Actions** se o workflow declarar `environment: github-pages` e passar os valores para o deploy (por exemplo, para um serviço que rode `server.js`).

**Para o OAuth funcionar:** o servidor Node que recebe `GET /oauth/callback?code=...` precisa das variáveis OAuth no **hosting do Node**. A **`ME_OAUTH_REDIRECT_URI` tem de ser idêntica** à URL de callback cadastrada no app Melhor Envio (mesmo `https`, domínio, caminho; sem barra extra). Se estiver diferente, a API ME responde **Client invalid** e não autoriza o aplicativo. O domínio do callback deve apontar para esse Node, não só para o GitHub Pages.

## Render (Web Service)

- **Build:** `npm install` (o script `postinstall` executa `prisma generate`). O pacote **`prisma` está em `dependencies`** para o Render instalar em produção (antes, só em `devDependencies`, o build falhava ou o serviço não subia).
- **Start:** `npm start` ou `node server.js`.
- **Variáveis:** no mínimo **`ME_PANEL_ACCESS_TOKEN`** + **`ME_API_BASE`** (modo recomendado). OAuth (`ME_CLIENT_ID`, `ME_CLIENT_SECRET`, `ME_OAUTH_REDIRECT_URI`, `ME_REFRESH_TOKEN`) só se não usar o JWT do painel. Tudo no **Environment do Render** — secrets do GitHub **não** são aplicados sozinhos.
- **Plano free:** o serviço “dorme”; o primeiro acesso pode levar **~1 minuto** a responder.
- **Teste rápido:** abrir `GET …/api/rastreio/health` — devolve `melhorEnvio.credenciaisOk` e `melhorEnvio.env` (flags `temME_*` **sem** expor segredos). Se `temME_PANEL_ACCESS_TOKEN` for `false` no JSON mas no painel do Render parece preenchido, o processo não está a receber a variável (redeploy, nome da chave, ou valor só com espaços).

## Problemas comuns

| Situação | O que fazer |
|----------|-------------|
| Site desatualizado no ar | `npm run sync-pages`, commit e push. |
| Rastreio: **405** ao consultar | O domínio está a servir só estático (ex.: Pages). Defina **`delicatto-api-base`** no `public/rastreios/index.html` com a URL do backend Node, ou aponte o DNS/proxy para o servidor onde corre `npm start`. |
| **Render** não abre / deploy falhou | Ver **Logs** no painel. Confirme **Build Command** `npm install` e que o build mostra `prisma generate`. Variáveis **`ME_*`** no Render (não `NE_*`). |
| OAuth ME: **Client invalid** | `ME_OAUTH_REDIRECT_URI` no servidor tem de coincidir **exatamente** com a URL de callback do app no painel ME (protocolo, domínio, caminho). |
| WhatsApp não abre (app interno) | Abrir o site no **Safari** ou **Chrome**. |

---

## OpenAI (opcional, só no `npm start`)

Sugestão de frase via `POST /api/ia/sugestao-frase` — veja `.env.example` e a seção no `server.js`. **Nunca** coloque a chave no frontend.
