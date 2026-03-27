/**
 * Camada isolada de integração HTTP com a API Melhor Envio.
 *
 * Documentação oficial: https://docs.melhorenvio.com.br/
 *
 * IMPORTANTE — manutenção:
 * - Endpoints podem ser ajustados pela Melhor Envio. Em caso de mudança, altere apenas este arquivo.
 * - Autenticação: apenas JWT do painel ME em ME_PANEL_ACCESS_TOKEN (Permissões de acesso).
 *   Cache em memória conforme expiração do JWT.
 * - Nenhum segredo deve ir para o frontend.
 */

const ME_BASE_DEFAULT = "https://www.melhorenvio.com.br";

/** Cache em memória do JWT do painel (evita reler exp em cada request). */
let accessCache = { token: null, expiresAtMs: 0 };

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

/**
 * ME /orders/search pode devolver:
 * - array direto [...]
 * - paginação estilo Laravel: { current_page, data: [...], total, per_page, last_page, ... }
 */
function listaOrdersSearch(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.orders)) return parsed.orders;
  if (Array.isArray(parsed.results)) return parsed.results;
  if (Array.isArray(parsed.items)) return parsed.items;
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
 * Bearer JWT do painel ME (ME_PANEL_ACCESS_TOKEN). Único modo de autenticação suportado.
 */
async function obterAccessToken() {
  const now = Date.now();
  const panel = String(process.env.ME_PANEL_ACCESS_TOKEN || "").trim();
  if (panel.length === 0) {
    throw new Error(
      "Melhor Envio: defina ME_PANEL_ACCESS_TOKEN (JWT em Permissões de acesso no painel ME)."
    );
  }
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
      const trimmed = normalizarTextoRespostaMe(bodyText);
      if (!trimmed) {
        ultimoErro = `${res.status} corpo vazio`;
        continue;
      }
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
  const trimmed = normalizarTextoRespostaMe(text);
  // GET search: 2xx sem corpo costuma significar “nenhum resultado” (equivale a []).
  if (!trimmed && res.ok) {
    return [];
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

  let eventosBrutos = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.tracking_events)
      ? payload.tracking_events
      : Array.isArray(payload.history)
        ? payload.history
        : [];

  if (eventosBrutos.length === 0) {
    const marcos = [
      { created_at: payload.generated_at, description: "Etiqueta gerada", status: "generated" },
      { created_at: payload.posted_at, description: "Postado", status: "posted" },
      { created_at: payload.delivered_at, description: "Entregue", status: "delivered" },
    ].filter((m) => m.created_at);
    marcos.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    eventosBrutos = marcos;
  }

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
};
