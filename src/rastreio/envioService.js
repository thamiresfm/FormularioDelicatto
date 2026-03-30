const { prisma } = require("./prisma");
const { rastreioSemBanco } = require("./semBanco");
const {
  buscarEnvioPorId,
  extrairCamposDoPayload,
  pesquisarPedidosPorTermo,
} = require("./melhorEnvioClient");
const {
  normalizarStatus,
  mensagemAmigavel,
  indiceEtapaProgresso,
  NEGOCIO,
} = require("./statusMap");

const MAX_CODIGO = 80;

/** Lê env com trim e sem BOM (evita “vazio” invisível no Render / copy-paste). */
function envStr(key) {
  return String(process.env[key] ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

/** Erros que não são Error (AggregateError, string) ou com message vazia — evita mensagem genérica sem causa. */
function erroParaTextoSeguro(e) {
  if (e instanceof Error && String(e.message || "").trim()) {
    return String(e.message);
  }
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object") {
    const msg = e.message ?? e.reason ?? e.cause?.message;
    if (msg && String(msg).trim()) return String(msg);
    if (Array.isArray(e.errors) && e.errors.length) {
      return e.errors.map((x) => erroParaTextoSeguro(x)).filter(Boolean).join(" | ") || "AggregateError";
    }
  }
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}") return s.slice(0, 500);
  } catch {
    /* ignore */
  }
  return "Erro desconhecido na integração (sem mensagem). Verifique logs do servidor.";
}

/**
 * Sanitiza o código digitado pelo cliente (somente caracteres seguros para rastreio).
 */
function sanitizarCodigoRastreio(codigo) {
  const limpo = String(codigo || "")
    .trim()
    .slice(0, MAX_CODIGO)
    .replace(/[^a-zA-Z0-9\-_/]/g, "");
  return limpo.toUpperCase();
}

async function buscarEnvioPorCodigoPublicoCompat(codigoLimpo) {
  if (!codigoLimpo || codigoLimpo.length < 3) return null;
  if (rastreioSemBanco() || !prisma) return null;
  return prisma.envio.findFirst({
    where: { codigoRastreio: codigoLimpo },
    include: {
      pedido: { include: { cliente: true } },
      eventos: { orderBy: [{ ocorridoEm: "desc" }, { createdAt: "desc" }] },
    },
  });
}

async function credenciaisMelhorEnvioConfiguradas() {
  return envStr("ME_PANEL_ACCESS_TOKEN").length > 0;
}

/** Só para diagnóstico (GET /health): indica se cada chave ME_* tem valor não vazio, sem revelar segredos. */
function flagsEnvMelhorEnvioPublico() {
  return {
    temME_PANEL_ACCESS_TOKEN: envStr("ME_PANEL_ACCESS_TOKEN").length > 0,
  };
}

/**
 * UUID do pedido/etiqueta na ME (GET /api/v2/me/orders/{id}).
 * Doc: https://docs.melhorenvio.com.br/reference/listar-informacoes-de-uma-etiqueta
 */
function pareceUuidPedidoMe(s) {
  const t = String(s || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

/** Normaliza valores do pedido ME para comparar com o que o cliente digitou. */
function valoresRastreioComparaveis(p) {
  return [
    p.id,
    p.protocol,
    p.authorization_code != null ? String(p.authorization_code) : null,
    p.tracking,
    p.self_tracking,
    p.melhorenvio_tracking,
  ]
    .filter(Boolean)
    .map((x) => String(x).toUpperCase().replace(/\s/g, ""));
}

/**
 * Escolhe o pedido cujo id, protocolo, autorização ou tracking bate com o código;
 * senão o primeiro resultado da pesquisa (comportamento anterior).
 */
function escolherPedidoPorCodigoRastreio(pedidos, codigoLimpo) {
  if (!pedidos?.length) return null;
  const alvo = String(codigoLimpo || "")
    .toUpperCase()
    .replace(/\s/g, "");
  const exato = pedidos.find((p) => valoresRastreioComparaveis(p).some((v) => v === alvo));
  return exato || pedidos[0];
}

function montarDtoPublicoDesdePayloadMe(raw, codigoRastreioExibicao) {
  const campos = extrairCamposDoPayload(raw);
  const statusNormalizado = normalizarStatus(campos.statusRaw);
  const etapa = indiceEtapaProgresso(statusNormalizado);
  const codigoDisplay = String(codigoRastreioExibicao || campos.tracking || "").trim() || "—";
  return {
    ok: true,
    codigoRastreio: codigoDisplay,
    status: statusNormalizado,
    statusRaw: campos.statusRaw,
    mensagem: mensagemAmigavel(statusNormalizado),
    transportadora: campos.transportadora,
    dataCriacao: campos.dataCriacao,
    dataAtualizacao: campos.dataAtualizacao,
    ultimaSincronizacao: null,
    etapaProgresso: etapa,
    etapas: [
      { id: NEGOCIO.PENDING, label: "Preparando" },
      { id: NEGOCIO.PAID, label: "Etiqueta paga" },
      { id: NEGOCIO.POSTED, label: "Postado" },
      { id: NEGOCIO.IN_TRANSIT, label: "Em trânsito" },
      { id: NEGOCIO.DELIVERED, label: "Entregue" },
    ],
    eventos: (campos.eventos || []).map((e) => ({
      ocorridoEm: e.ocorridoEm,
      descricao: e.descricao,
      statusRaw: e.statusRaw,
    })),
    pedido: null,
    fonte: "melhor_envio",
  };
}

/**
 * Tenta localizar o envio na API ME pelo código (GET /orders/search) e montar o DTO público.
 * Retorno estruturado para distinguir credenciais em falta / erro ME de “código não encontrado”.
 */
async function consultarPublicoDiretoMelhorEnvio(codigoLimpo) {
  if (process.env.RASTREIO_CONSULTA_ME_SEM_CADASTRO === "0" && !rastreioSemBanco()) {
    return { resultado: "consulta_desligada" };
  }
  if (!(await credenciaisMelhorEnvioConfiguradas())) {
    return { resultado: "sem_credenciais" };
  }
  try {
    if (pareceUuidPedidoMe(codigoLimpo)) {
      try {
        const rawPorId = await buscarEnvioPorId(codigoLimpo);
        return { resultado: "ok", dto: montarDtoPublicoDesdePayloadMe(rawPorId, codigoLimpo) };
      } catch (errId) {
        console.warn("[rastreio] GET /orders/:id falhou, tentando search:", erroParaTextoSeguro(errId));
      }
    }

    const pedidos = await pesquisarPedidosPorTermo(codigoLimpo);
    const match = escolherPedidoPorCodigoRastreio(pedidos, codigoLimpo);
    if (!match?.id) {
      return { resultado: "nao_encontrado" };
    }
    // A doc ME: orders/search já devolve o mesmo payload de GET /api/v2/me/orders/{id}.
    const raw = match;
    return { resultado: "ok", dto: montarDtoPublicoDesdePayloadMe(raw, codigoLimpo) };
  } catch (e) {
    const mensagem = erroParaTextoSeguro(e);
    console.error("[rastreio] consulta direta ME:", mensagem, e);
    return { resultado: "erro_me", mensagem };
  }
}

/**
 * Traduz erro interno da API ME para texto seguro ao cliente (sem expor tokens).
 */
function mensagemPublicaErroIntegracaoMe(mensagemInterna) {
  const m = String(mensagemInterna || "");
  if (/HTML \(página do site\)|foi HTML \(página do site\)/i.test(m)) {
    return (
      "O Melhor Envio devolveu a página do site em vez da API (JSON). No servidor, defina ME_API_BASE como https://www.melhorenvio.com.br (com www, sem barra no fim). " +
      "Evite usar só melhorenvio.com.br sem www."
    );
  }
  if (m.includes("ME_PANEL_ACCESS_TOKEN expirou")) {
    return "O JWT do painel Melhor Envio expirou. Gere um novo em Permissões de acesso no painel ME e atualize ME_PANEL_ACCESS_TOKEN no Render.";
  }
  if (/\(401\)|\b401\b|Unauthorized/i.test(m)) {
    return "O Melhor Envio recusou o token (401). Gere um novo JWT em Permissões de acesso no painel ME e atualize ME_PANEL_ACCESS_TOKEN no servidor; confira ME_API_BASE (produção vs sandbox).";
  }
  if (/\(403\)|\b403\b|Forbidden/i.test(m)) {
    return "Acesso negado pela API Melhor Envio (403). Confira escopos do aplicativo e se ME_API_BASE é o mesmo ambiente da conta (produção vs sandbox).";
  }
  if (/\(429\)|\b429\b|rate|too many/i.test(m)) {
    return "Limite de consultas no Melhor Envio. Aguarde um minuto e tente de novo.";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|getaddrinfo/i.test(m)) {
    return "Sem ligação ao Melhor Envio. Tente de novo em instantes.";
  }
  if (/pesquisa falhou/i.test(m)) {
    return "A pesquisa no Melhor Envio falhou. Verifique ME_API_BASE e se o token ainda é válido.";
  }
  if (/não foi possível buscar envio|buscar envio/i.test(m)) {
    if (/\(404\)|\b404\b|not found/i.test(m)) {
      return "O Melhor Envio não encontrou os detalhes desse envio (404). Confira o código ou tente de novo; se persistir, fale com a loja.";
    }
    return "Não foi possível obter os detalhes do envio no Melhor Envio. Tente de novo em instantes ou fale com a loja.";
  }
  if (/resposta vazia/i.test(m)) {
    return "O Melhor Envio devolveu resposta vazia. Verifique ME_API_BASE, token e tente de novo; se persistir, veja os logs do servidor.";
  }
  if (/corpo não é JSON/i.test(m)) {
    return (
      "A API do Melhor Envio devolveu texto que não é JSON (pode ser HTML ou erro em outro formato). " +
      "Confira ME_API_BASE (https://www.melhorenvio.com.br com www), ME_PANEL_ACCESS_TOKEN e RASTREIO_DEBUG_ME=1 para ver o detalhe técnico."
    );
  }
  if (/defina ME_PANEL_ACCESS_TOKEN|configure ME_PANEL_ACCESS_TOKEN/i.test(m)) {
    return "Integração Melhor Envio não configurada no servidor. Defina ME_PANEL_ACCESS_TOKEN (JWT em Permissões de acesso no painel ME) no Render.";
  }
  if (/\(5\d\d\)|\b502\b|\b503\b|Bad Gateway|Service Unavailable/i.test(m)) {
    return "O Melhor Envio está temporariamente indisponível. Tente de novo em alguns minutos.";
  }
  if (!m.trim()) {
    return "Falha na integração sem detalhe visível. No Render, confira ME_PANEL_ACCESS_TOKEN, ME_API_BASE e os logs do serviço.";
  }
  if (/certificate|SSL|TLS|UNABLE_TO_VERIFY|certifica/i.test(m)) {
    return "Erro de certificado ou ligação segura ao Melhor Envio. Verifique rede/firewall ou tente mais tarde.";
  }
  if (/\(400\)|\b400\b|Bad Request/i.test(m)) {
    return "O Melhor Envio recusou o pedido (400). Confira se o código de rastreio está correto e se o token tem escopo de pedidos.";
  }
  if (/\(422\)|\b422\b|Unprocessable/i.test(m)) {
    return "O Melhor Envio não aceitou os dados enviados (422). Confira o código de rastreio ou tente outro formato.";
  }
  if (/Melhor Envio:/i.test(m)) {
    const st = m.match(/\((\d{3})\)/);
    if (st) {
      const code = st[1];
      if (code === "401") {
        return "O Melhor Envio recusou o token (401). Atualize ME_PANEL_ACCESS_TOKEN (novo JWT em Permissões de acesso) e confira ME_API_BASE.";
      }
      if (code === "403") {
        return "Acesso negado pelo Melhor Envio (403). Confira escopos do JWT e se ME_API_BASE é produção ou sandbox conforme a conta.";
      }
      if (code === "404") {
        return "Recurso não encontrado na API Melhor Envio (404). Confira ME_API_BASE e o código consultado.";
      }
      return `O Melhor Envio respondeu com erro HTTP ${code}. Verifique token, ME_API_BASE (https://www.melhorenvio.com.br) e os logs do servidor.`;
    }
    return "Falha ao comunicar com o Melhor Envio. Confira ME_API_BASE, ME_PANEL_ACCESS_TOKEN e os logs do servidor.";
  }
  return "Não foi possível consultar o Melhor Envio no momento. Tente de novo em instantes ou fale com a loja.";
}

/**
 * Sincroniza um envio com o Melhor Envio e persiste eventos.
 */
async function sincronizarEnvioComMelhorEnvio(envioId) {
  let envio = await prisma.envio.findUnique({ where: { id: envioId } });
  if (!envio) {
    throw new Error("Envio não encontrado");
  }
  if (!envio.melhorEnvioShipmentId) {
    if (!(await credenciaisMelhorEnvioConfiguradas())) {
      throw new Error(
        "Este envio ainda não está vinculado ao Melhor Envio. Associe o ID da etiqueta no painel administrativo."
      );
    }
    const pedidos = await pesquisarPedidosPorTermo(envio.codigoRastreio);
    const match = escolherPedidoPorCodigoRastreio(pedidos, envio.codigoRastreio);
    if (!match?.id) {
      throw new Error(
        "Não encontramos este código no Melhor Envio. Confira o rastreio ou informe o ID da etiqueta no painel."
      );
    }
    await prisma.envio.update({
      where: { id: envioId },
      data: { melhorEnvioShipmentId: match.id },
    });
    envio = await prisma.envio.findUnique({ where: { id: envioId } });
  }

  const raw = await buscarEnvioPorId(envio.melhorEnvioShipmentId);
  const campos = extrairCamposDoPayload(raw);
  const statusNormalizado = normalizarStatus(campos.statusRaw);

  const snapshot = JSON.stringify(raw);
  const payloadSnapshot = snapshot.length > 50_000 ? snapshot.slice(0, 50_000) : snapshot;

  await prisma.$transaction(async (tx) => {
    await tx.trackingEvent.deleteMany({ where: { envioId } });
    for (const ev of campos.eventos) {
      await tx.trackingEvent.create({
        data: {
          envioId,
          ocorridoEm: ev.ocorridoEm,
          descricao: ev.descricao,
          statusRaw: ev.statusRaw,
        },
      });
    }
    await tx.envio.update({
      where: { id: envioId },
      data: {
        statusRaw: campos.statusRaw,
        statusNormalizado,
        transportadora: campos.transportadora,
        dataCriacao: campos.dataCriacao,
        dataAtualizacao: campos.dataAtualizacao,
        ultimaSincronizacao: new Date(),
        payloadSnapshot,
      },
    });
  });

  return prisma.envio.findUnique({
    where: { id: envioId },
    include: {
      pedido: { include: { cliente: true } },
      eventos: { orderBy: [{ ocorridoEm: "desc" }, { createdAt: "desc" }] },
    },
  });
}

function montarDtoPublico(envio) {
  const etapa = indiceEtapaProgresso(envio.statusNormalizado);
  return {
    ok: true,
    codigoRastreio: envio.codigoRastreio,
    status: envio.statusNormalizado,
    statusRaw: envio.statusRaw,
    mensagem: mensagemAmigavel(envio.statusNormalizado),
    transportadora: envio.transportadora,
    dataCriacao: envio.dataCriacao,
    dataAtualizacao: envio.dataAtualizacao,
    ultimaSincronizacao: envio.ultimaSincronizacao,
    etapaProgresso: etapa,
    etapas: [
      { id: NEGOCIO.PENDING, label: "Preparando" },
      { id: NEGOCIO.PAID, label: "Etiqueta paga" },
      { id: NEGOCIO.POSTED, label: "Postado" },
      { id: NEGOCIO.IN_TRANSIT, label: "Em trânsito" },
      { id: NEGOCIO.DELIVERED, label: "Entregue" },
    ],
    eventos: (envio.eventos || []).map((e) => ({
      ocorridoEm: e.ocorridoEm,
      descricao: e.descricao,
      statusRaw: e.statusRaw,
    })),
    pedido: envio.pedido
      ? {
          codigo: envio.pedido.codigo,
          titulo: envio.pedido.titulo,
        }
      : null,
  };
}

/**
 * Atualiza envio a partir de payload de webhook (estrutura flexível).
 */
async function aplicarPayloadWebhook(payloadObj) {
  const p = payloadObj?.data || payloadObj?.shipment || payloadObj;
  const meId =
    p?.id ||
    payloadObj?.shipment_id ||
    payloadObj?.resource_id ||
    payloadObj?.id;
  if (!meId) {
    return { ok: false, reason: "Payload sem ID de envio" };
  }

  const envio = await prisma.envio.findFirst({
    where: { melhorEnvioShipmentId: String(meId) },
  });
  if (!envio) {
    return { ok: false, reason: "Envio não cadastrado localmente" };
  }

  const campos = extrairCamposDoPayload(p);
  const statusNormalizado = normalizarStatus(campos.statusRaw);

  await prisma.$transaction(async (tx) => {
    await tx.trackingEvent.create({
      data: {
        envioId: envio.id,
        ocorridoEm: campos.dataAtualizacao || new Date(),
        descricao: "Atualização recebida via webhook",
        statusRaw: campos.statusRaw,
      },
    });
    await tx.envio.update({
      where: { id: envio.id },
      data: {
        statusRaw: campos.statusRaw,
        statusNormalizado,
        transportadora: campos.transportadora ?? envio.transportadora,
        dataCriacao: campos.dataCriacao ?? envio.dataCriacao,
        dataAtualizacao: campos.dataAtualizacao ?? new Date(),
        ultimaSincronizacao: new Date(),
      },
    });
  });

  return { ok: true, envioId: envio.id };
}

/** Lista envios para sincronização periódica (não entregues nem cancelados). */
async function listarEnviosParaPolling() {
  return prisma.envio.findMany({
    where: {
      melhorEnvioShipmentId: { not: null },
      statusNormalizado: {
        notIn: [NEGOCIO.DELIVERED, NEGOCIO.CANCELED],
      },
    },
    select: { id: true },
  });
}

module.exports = {
  sanitizarCodigoRastreio,
  buscarEnvioPorCodigoPublico: buscarEnvioPorCodigoPublicoCompat,
  sincronizarEnvioComMelhorEnvio,
  montarDtoPublico,
  consultarPublicoDiretoMelhorEnvio,
  aplicarPayloadWebhook,
  listarEnviosParaPolling,
  credenciaisMelhorEnvioConfiguradas,
  flagsEnvMelhorEnvioPublico,
  mensagemPublicaErroIntegracaoMe,
};
