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
  const panel = String(process.env.ME_PANEL_ACCESS_TOKEN || "").trim();
  if (panel) return true;
  if (!process.env.ME_CLIENT_ID || !process.env.ME_CLIENT_SECRET) return false;
  if (String(process.env.ME_REFRESH_TOKEN || "").trim()) return true;
  if (rastreioSemBanco() || !prisma) return false;
  const row = await prisma.integrationToken.findUnique({
    where: { id: "melhor_envio" },
    select: { refreshToken: true },
  });
  return Boolean(row?.refreshToken && String(row.refreshToken).trim());
}

/** Escolhe o pedido cuja trilha de rastreio bate com o código digitado; senão o primeiro resultado. */
function escolherPedidoPorCodigoRastreio(pedidos, codigoLimpo) {
  if (!pedidos?.length) return null;
  const alvo = String(codigoLimpo || "")
    .toUpperCase()
    .replace(/\s/g, "");
  const match = pedidos.find((p) => {
    const tr = [p.tracking, p.self_tracking, p.melhorenvio_tracking].filter(Boolean).map(String);
    return tr.some((t) => t.toUpperCase().replace(/\s/g, "") === alvo);
  });
  return match || pedidos[0];
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
 * Retorna null se não achar ou se não houver credenciais ME.
 */
async function consultarPublicoDiretoMelhorEnvio(codigoLimpo) {
  if (process.env.RASTREIO_CONSULTA_ME_SEM_CADASTRO === "0" && !rastreioSemBanco()) {
    return null;
  }
  if (!(await credenciaisMelhorEnvioConfiguradas())) {
    return null;
  }
  try {
    const pedidos = await pesquisarPedidosPorTermo(codigoLimpo);
    const match = escolherPedidoPorCodigoRastreio(pedidos, codigoLimpo);
    if (!match?.id) {
      return null;
    }
    const raw = await buscarEnvioPorId(match.id);
    return montarDtoPublicoDesdePayloadMe(raw, codigoLimpo);
  } catch (e) {
    console.error("[rastreio] consulta direta ME:", e.message);
    return null;
  }
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
};
