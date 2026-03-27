# Sistema de rastreamento Delicatto + Melhor Envio

## 1. Arquitetura

```
[Cliente — navegador]
       │  HTTPS
       ▼
[Express — server.js]
       ├── Arquivos estáticos (public/), incluindo /rastreios/
       ├── POST /api/rastreio/consultar     → rate limit, Prisma, Melhor Envio
       ├── /api/rastreio/admin/*            → token RASTREIO_ADMIN_TOKEN
       ├── POST /api/rastreio/webhook/melhor-envio → corpo raw, assinatura opcional
       └── Polling opcional (RASTREIO_POLL_MINUTOS)

[Prisma ORM] ──► SQLite (dev) ou PostgreSQL (produção)

[Melhor Envio API] ◄── JWT do painel (ME_PANEL_ACCESS_TOKEN, somente backend)
       documentação: https://docs.melhorenvio.com.br/
```

- **Frontend** (`public/rastreios/`): HTML/CSS/JS vanilla; chama apenas rotas `/api/rastreio/*` no mesmo domínio.
- **Backend**: toda chamada à API Melhor Envio fica em `src/rastreio/melhorEnvioClient.js` (fácil ajustar endpoints).
- **Segredos**: `ME_PANEL_ACCESS_TOKEN`, `ME_API_BASE`, `RASTREIO_ADMIN_TOKEN`, `ME_WEBHOOK_SECRET` apenas no `.env` (nunca no Git).

## 2. Modelagem de dados (Prisma)

| Modelo             | Função |
|--------------------|--------|
| `Cliente`          | Nome, e-mail, telefone |
| `Pedido`           | Código interno único, título, vínculo opcional com cliente |
| `Envio`            | `codigoRastreio` (público), `melhorEnvioShipmentId` (UUID ME), status, transportadora, datas |
| `TrackingEvent`    | Histórico de eventos (sync API ou webhook) |
| `IntegrationToken` | Legado (cache de token); o fluxo atual usa só `ME_PANEL_ACCESS_TOKEN` |
| `WebhookLog`       | Auditoria de POSTs recebidos |

Ver `prisma/schema.prisma`.

## 3. Estrutura de pastas (novo)

```
prisma/
  schema.prisma
  dev.db                    # gerado localmente (gitignored)
src/rastreio/
  prisma.js                 # cliente Prisma
  statusMap.js              # status de negócio + mensagens
  melhorEnvioClient.js      # OAuth + GET envio (AJUSTAR URL SE A API MUDAR)
  envioService.js           # regras, sync, DTO público
  apiRoutes.js              # rotas Express
  rateLimit.js
  adminAuth.js
  syncScheduler.js
public/rastreios/
  index.html                # “Acompanhe seu pedido”
  styles.css
  app.js
  admin/
    index.html              # painel equipe
    app.js
docs/
  RASTREIO-MELHOR-ENVIO.md  # este arquivo
```

## 4. Fluxo Melhor Envio

1. No painel Melhor Envio, em **Permissões de acesso**, gere um **JWT** e copie para `ME_PANEL_ACCESS_TOKEN` no `.env` (junto com `ME_API_BASE`).
2. Quando o JWT expirar, gere outro no painel e atualize a variável.
3. No painel `/rastreios/admin/`, cadastre **pedido** e **envio** com:
   - `codigoRastreio`: o que o cliente digita.
   - `melhorEnvioShipmentId`: ID do envio no ME (necessário para `buscarEnvioPorId` em `melhorEnvioClient.js`).
4. Consulta pública: o backend busca o envio local, chama a API ME, atualiza banco e devolve JSON para a página.

**Endpoints HTTP Melhor Envio** estão centralizados em `melhorEnvioClient.js` (inclui URLs candidatas). Se a documentação oficial indicar outro path, altere só esse arquivo.

## 5. Webhook

- URL sugerida: `POST https://SEU-DOMINIO/api/rastreio/webhook/melhor-envio`
- Corpo: JSON (configuração depende do Melhor Envio).
- Se `ME_WEBHOOK_SECRET` estiver definido e o header de assinatura (`x-me-signature` / `x-signature`) for enviado, validação HMAC-SHA256 do corpo bruto é aplicada.
- Ajuste o formato em `aplicarPayloadWebhook` (`envioService.js`) conforme o payload real do ME.

## 6. Variáveis de ambiente

Ver `.env.example`.

## 7. Rodar localmente

```bash
cp .env.example .env
# Edite DATABASE_URL, RASTREIO_ADMIN_TOKEN e credenciais ME (para sync real)

npm install
npm run db:push
npm start
```

- Página pública: http://localhost:3000/rastreios/
- Painel: http://localhost:3000/rastreios/admin/ (informe o token no topo).

Sem credenciais ME, a consulta ainda **lista** envios cadastrados, mas a **sincronização** com a API falhará até configurar o `.env`.

## 8. Deploy (sugestões)

- **Node + PM2** ou **Docker** na VPS; **HTTPS obrigatório** (Let’s Encrypt).
- **PostgreSQL** gerenciado; altere `provider` em `schema.prisma` e `DATABASE_URL`.
- Configure **webhook** no painel Melhor Envio apontando para sua URL pública.
- **Não** publique apenas GitHub Pages para esta funcionalidade: a API e o banco precisam do servidor Node.

## 9. Segurança

- Rate limit na rota pública (`express-rate-limit`).
- Token admin longo e rotação periódica.
- `app.set("trust proxy", 1)` para IP correto atrás de proxy reverso.
- Sanitização do código de rastreio (caracteres permitidos + maiúsculas).
- Nunca expor `ME_*` no frontend.

## 10. GitHub Pages / site estático

Os formulários podem continuar em Pages; a área **/rastreios/** exige backend. Opções:

- Hospedar o mesmo repositório em um serviço Node (Render, Railway, VPS) no domínio principal, **ou**
- Usar subdomínio `api.dominio.com` só para APIs e `rastreios` com CORS + mesma marca (exige ajuste CORS e URLs absolutas no `app.js`).

Para o mesmo domínio e cookies, o ideal é um único host servindo `public/` + API.
