/**
 * Camada isolada de integração HTTP com a API Melhor Envio.
 *
 * Documentação oficial: https://docs.melhorenvio.com.br/
 *
 * IMPORTANTE — manutenção:
 * - Endpoints podem ser ajustados pela Melhor Envio. Em caso de mudança, altere apenas este arquivo.
 * - Autenticação: (1) JWT do painel ME em ME_PANEL_ACCESS_TOKEN — se definido, usado sempre; (2) OAuth2 só se o painel estiver vazio.
 *   Access em cache em memória; refresh rotacionado pela ME também (memória no mesmo processo, útil em RASTREIO_SEM_BANCO).
 * - Nenhum segredo deve ir para o frontend.
 */

const { prisma } = require("./prisma");
const { rastreioSemBanco } = require("./semBanco");

const ME_BASE_DEFAULT = "https://www.melhorenvio.com.br";

/** Cache em memória (rápido). Persistência opcional em IntegrationToken para sobreviver a restart. */
let accessCache = { token: null, expiresAtMs: 0 };

/** Refresh token atual (inclui rotação devolvida pela ME em grant_type=refresh_token). Prioridade sobre ME_REFRESH_TOKEN no .env no mesmo processo. */
let refreshTokenMemory = null;

function getBaseUrl() {
  let base = (process.env.ME_API_BASE || ME_BASE_DEFAULT).replace(/\/$/, "");
  // O apex (sem www) costuma responder com a SPA do site (HTML 200), não com a API JSON.
  if (/^https?:\/\/melhorenvio\.com\.br$/i.test(base)) {
    base = "https://www.melhorenvio.com.br";
  }
  return base;
}

function normalizarTextoRespostaMe(text) {
  return String(text ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function corpoEhPaginaHtml(text) {
  const s = normalizarTextoRespostaMe(text);
  if (!s) return false;
  if (s[0] === "<") return true;
  return /^<!DOCTYPE\s+html/i.test(s) || /^<html[\s>/]/i.test(s);
}

function erroRespostaHtmlEmVezDeJson() {
  return new Error(
    "Melhor Envio: a resposta foi HTML (página do site) em vez de JSON. Defina ME_API_BASE como https://www.melhorenvio.com.br (com www, sem barra no fim). Evite melhorenvio.com.br sem www e confira o path /api/v2/me/…"
  );
}

function jsonOuErroMe(text, contexto) {
  const trimmed = normalizarTextoRespostaMe(text);
  if (!trimmed) {
    throw new Error(`Melhor Envio: resposta vazia (${contexto})`);
  }
  if (corpoEhPaginaHtml(trimmed)) {
    throw erroRespostaHtmlEmVezDeJson();
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed[0] === "<") {
      throw erroRespostaHtmlEmVezDeJson();
    }
    throw new Error(
      `Melhor Envio: corpo não é JSON (${contexto}): ${trimmed.slice(0, 200)}`
    );
  }
}

/** orders/search pode devolver array ou objeto com lista (ex.: { data: [...] }). */
function listaOrdersSearch(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.orders)) return parsed.orders;
    if (Array.isArray(parsed.results)) return parsed.results;
  }
  return [];
}

/**
 * Doc ME: User-Agent obrigatório com nome da aplicação + e-mail de suporte.
 * @see https://docs.melhorenvio.com.br/reference/introducao-api-melhor-envio
 */
function userAgentMelhorEnvio() {
  const custom = String(process.env.ME_USER_AGENT || "").trim();
  if (custom) return custom;
  const email = String(process.env.ME_CONTACT_EMAIL || "").trim();
  if (email) {
    return `Delicatto Personalizados (${email})`;
  }
  return "DelicattoRastreio/1.0 (Node)";
}

/** Refresh token: memória (rotação ME) → `.env` → Prisma. */
async function obterRefreshTokenArmazenado() {
  const mem = refreshTokenMemory != null ? String(refreshTokenMemory).trim() : "";
  if (mem) return mem;
  const envRt = String(process.env.ME_REFRESH_TOKEN || "").trim();
  if (envRt) return envRt;
  if (rastreioSemBanco() || !prisma) return "";
  try {
    const row = await prisma.integrationToken.findUnique({
      where: { id: "melhor_envio" },
      select: { refreshToken: true },
    });
    return row?.refreshToken ? String(row.refreshToken).trim() : "";
  } catch {
    return "";
  }
}

/**
 * URL para o usuário autorizar o app no navegador (redirect para login ME).
 * @see https://docs.melhorenvio.com.br/reference/fluxo-de-autoriza%C3%A7%C3%A3o
 */
function montarUrlAutorizacaoOAuth() {
  const clientId = String(process.env.ME_CLIENT_ID || "").trim();
  if (!clientId) {
    throw new Error("ME_CLIENT_ID não configurado.");
  }
  const redirectUri =
    String(process.env.ME_OAUTH_REDIRECT_URI || "").trim() ||
    "https://delicattopersonalizados.com.br/oauth/callback";
  const scopes =
    String(process.env.ME_OAUTH_SCOPES || "shipping-tracking").trim() || "shipping-tracking";
  const base = getBaseUrl();
  const u = new URL(`${base}/oauth/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes);
  const state = String(process.env.ME_OAUTH_STATE || "").trim();
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

/**
 * Troca o authorization_code (one-shot, expira rápido) por access + refresh tokens.
 */
async function trocarAuthorizationCodePorTokens(code) {
  const clientId = process.env.ME_CLIENT_ID;
  const clientSecret = process.env.ME_CLIENT_SECRET;
  const redirectUri =
    String(process.env.ME_OAUTH_REDIRECT_URI || "").trim() ||
    "https://delicattopersonalizados.com.br/oauth/callback";
  if (!clientId || !clientSecret) {
    throw new Error("ME_CLIENT_ID e ME_CLIENT_SECRET são obrigatórios.");
  }
  const base = getBaseUrl();
  const tokenUrl = `${base}/oauth/token`;
  const codigo = String(code || "").trim();
  const bodyJson = JSON.stringify({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: codigo,
  });

  let res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyJson,
  });

  if (!res.ok) {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: String(clientId),
      client_secret: String(clientSecret),
      redirect_uri: redirectUri,
      code: codigo,
    });
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Melhor Envio OAuth (authorization_code): ${res.status} ${t.slice(0, 400)}`);
  }

  return res.json();
}

/** Persiste access/refresh após authorization_code ou para alinhar cache ao banco. */
async function persistirTokensOAuthResposta(data) {
  const access = data.access_token;
  const refresh = data.refresh_token;
  const expiresIn = Number(data.expires_in || 3600);
  const now = Date.now();
  if (!access) {
    throw new Error("Resposta OAuth sem access_token.");
  }
  accessCache = {
    token: access,
    expiresAtMs: now + expiresIn * 1000,
  };
  if (refresh && rastreioSemBanco()) {
    refreshTokenMemory = String(refresh).trim();
  }
  if (prisma && !rastreioSemBanco()) {
    await prisma.integrationToken.upsert({
      where: { id: "melhor_envio" },
      create: {
        id: "melhor_envio",
        accessToken: access,
        refreshToken: refresh || undefined,
        expiresAt: new Date(accessCache.expiresAtMs),
      },
      update: {
        accessToken: access,
        refreshToken: refresh || undefined,
        expiresAt: new Date(accessCache.expiresAtMs),
      },
    });
  }
}

/** Lê `exp` do JWT (segundos → ms) para cache; retorna null se inválido. */
function jwtExpParaMs(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const payload = JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Obtém access_token válido: se ME_PANEL_ACCESS_TOKEN existir, usa-o sempre (OAuth não é usado).
 * Sem painel: cache OAuth em memória; refresh via grant_type=refresh_token (JSON ou form-urlencoded).
 */
async function obterAccessToken() {
  const now = Date.now();
  const panel = String(process.env.ME_PANEL_ACCESS_TOKEN || "").trim();
  if (panel.length > 0) {
    if (accessCache.token === panel && now < accessCache.expiresAtMs - 90_000) {
      return accessCache.token;
    }
    const expMs = jwtExpParaMs(panel);
    if (expMs != null && expMs <= now) {
      throw new Error(
        "Melhor Envio: ME_PANEL_ACCESS_TOKEN expirou. Gere um novo em Permissões de acesso no painel ME."
      );
    }
    const ate = expMs != null ? expMs : now + 86400 * 1000;
    accessCache = { token: panel, expiresAtMs: ate };
    return panel;
  }

  if (accessCache.token && now < accessCache.expiresAtMs - 90_000) {
    return accessCache.token;
  }

  const clientId = process.env.ME_CLIENT_ID;
  const clientSecret = process.env.ME_CLIENT_SECRET;
  const refreshToken = await obterRefreshTokenArmazenado();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Melhor Envio: configure ME_PANEL_ACCESS_TOKEN (JWT do painel) ou ME_CLIENT_ID + ME_CLIENT_SECRET + ME_REFRESH_TOKEN (ou conclua OAuth em GET /oauth/melhor-envio/iniciar)"
    );
  }

  const base = getBaseUrl();
  const tokenUrl = `${base}/oauth/token`;

  const bodyJson = JSON.stringify({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  let res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyJson,
  });

  if (!res.ok) {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Melhor Envio OAuth falhou (${res.status}): ${t.slice(0, 400)}`);
  }

  const data = await res.json();
  const access = data.access_token;
  const expiresIn = Number(data.expires_in || 3600);
  if (!access) {
    throw new Error("Melhor Envio OAuth: resposta sem access_token");
  }

  accessCache = {
    token: access,
    expiresAtMs: now + expiresIn * 1000,
  };

  const novoRefresh = data.refresh_token ? String(data.refresh_token).trim() : "";
  if (novoRefresh) {
    refreshTokenMemory = novoRefresh;
  }

  if (prisma && !rastreioSemBanco()) {
    try {
      await prisma.integrationToken.upsert({
        where: { id: "melhor_envio" },
        create: {
          id: "melhor_envio",
          accessToken: access,
          refreshToken: novoRefresh || refreshToken,
          expiresAt: new Date(accessCache.expiresAtMs),
        },
        update: {
          accessToken: access,
          refreshToken: novoRefresh || undefined,
          expiresAt: new Date(accessCache.expiresAtMs),
        },
      });
    } catch (_e) {
      /* opcional */
    }
  }

  return access;
}

/**
 * Busca dados da etiqueta no Melhor Envio pelo ID retornado em orders/search.
 *
 * Doc ME: GET /api/v2/me/orders/{id} — id da order correspondente à etiqueta.
 * @see https://docs.melhorenvio.com.br/reference/listar-informacoes-de-uma-etiqueta
 */
async function buscarEnvioPorId(shipmentId) {
  const token = await obterAccessToken();
  const base = getBaseUrl();
  const id = encodeURIComponent(String(shipmentId).trim());

  const candidatos = [
    `${base}/api/v2/me/orders/${id}`,
    `${base}/api/v2/me/shipment/${id}`,
    `${base}/api/v2/me/shipments/${id}`,
  ];

  let ultimoErro = null;
  for (const url of candidatos) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": userAgentMelhorEnvio(),
      },
    });
    const bodyText = await res.text();
    if (res.ok) {
      return jsonOuErroMe(bodyText, `orders/${id}`);
    }
    if (corpoEhPaginaHtml(bodyText)) {
      throw erroRespostaHtmlEmVezDeJson();
    }
    ultimoErro = `${res.status} ${bodyText.slice(0, 200)}`;
  }
  throw new Error(`Melhor Envio: não foi possível buscar envio ${id}. Último: ${ultimoErro}`);
}

/**
 * Pesquisa pedidos/envios pelo termo `q` (documentação: código de rastreio, protocolo, id, etc.).
 * @see https://docs.melhorenvio.com.br/reference/pesquisar-etiqueta
 */
async function pesquisarPedidosPorTermo(q) {
  const termo = String(q || "").trim();
  if (termo.length < 3) {
    return [];
  }
  const token = await obterAccessToken();
  const base = getBaseUrl();
  const url = `${base}/api/v2/me/orders/search?q=${encodeURIComponent(termo)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": userAgentMelhorEnvio(),
    },
  });
  const text = await res.text();
  if (corpoEhPaginaHtml(text)) {
    throw erroRespostaHtmlEmVezDeJson();
  }
  if (!res.ok) {
    throw new Error(`Melhor Envio: pesquisa falhou (${res.status}): ${text.slice(0, 400)}`);
  }
  const parsed = jsonOuErroMe(text, "orders/search");
  return listaOrdersSearch(parsed);
}

/**
 * Normaliza payload diverso da API para um formato estável usado pelo domínio.
 */
function extrairCamposDoPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      statusRaw: null,
      tracking: null,
      transportadora: null,
      dataCriacao: null,
      dataAtualizacao: null,
      eventos: [],
    };
  }

  const statusRaw =
    payload.status ||
    payload.state ||
    payload.situation ||
    (payload.data && payload.data.status) ||
    null;

  const tracking =
    payload.tracking ||
    payload.tracking_code ||
    payload.code ||
    payload.trackingCode ||
    null;

  const transportadora =
    payload.service?.company?.name ||
    payload.company?.name ||
    payload.carrier?.name ||
    payload.service?.name ||
    null;

  let dataCriacao = payload.created_at || payload.createdAt || payload.created || null;
  let dataAtualizacao = payload.updated_at || payload.updatedAt || payload.updated || null;

  const toDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const eventosBrutos = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.tracking_events)
      ? payload.tracking_events
      : Array.isArray(payload.history)
        ? payload.history
        : [];

  const eventos = eventosBrutos.map((ev) => {
    const when = ev.created_at || ev.date || ev.occurred_at || ev.datetime || null;
    const desc =
      ev.description || ev.details || ev.message || ev.status || JSON.stringify(ev).slice(0, 200);
    const st = ev.status || ev.state || null;
    return {
      ocorridoEm: toDate(when),
      descricao: String(desc || "Atualização"),
      statusRaw: st ? String(st) : null,
    };
  });

  return {
    statusRaw: statusRaw ? String(statusRaw) : null,
    tracking: tracking ? String(tracking) : null,
    transportadora: transportadora ? String(transportadora) : null,
    dataCriacao: toDate(dataCriacao),
    dataAtualizacao: toDate(dataAtualizacao),
    eventos,
  };
}

module.exports = {
  obterAccessToken,
  buscarEnvioPorId,
  pesquisarPedidosPorTermo,
  extrairCamposDoPayload,
  getBaseUrl,
  montarUrlAutorizacaoOAuth,
  trocarAuthorizationCodePorTokens,
  persistirTokensOAuthResposta,
};
