/**
 * Mapeia status brutos do Melhor Envio (e variações) para o fluxo de negócio da Delicatto.
 * Ajuste aqui se a API retornar novos valores — a camada HTTP está em melhorEnvioClient.js.
 */

const NEGOCIO = {
  PENDING: "pending",
  PAID: "paid",
  POSTED: "posted",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  CANCELED: "canceled",
  ATTENTION: "attention",
};

const MENSAGENS = {
  pending: "Seu envio foi preparado e está aguardando postagem.",
  paid: "A etiqueta foi paga. Em breve sua caixa seguirá para postagem.",
  posted: "Sua caixa já foi postada nos Correios ou transportadora.",
  in_transit: "Sua caixa já foi enviada e está a caminho.",
  delivered: "Seu pedido foi entregue com sucesso.",
  canceled: "Este envio foi cancelado. Em caso de dúvida, fale com a loja.",
  attention:
    "Houve uma atualização importante no seu envio. Entre em contato com nossa equipe se precisar.",
};

/**
 * @param {string} raw Status retornado pela API (minúsculas recomendado)
 * @returns {keyof typeof NEGOCIO values}
 */
function normalizarStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");

  if (!s) return NEGOCIO.PENDING;

  const posted = ["posted", "released", "generated", "printed"];
  const transit = [
    "in_transit",
    "in transit",
    "on_carriage",
    "on_carriage",
    "carried",
    "awaiting_shipment",
    "shipped",
  ];
  const delivered = ["delivered", "completed"];
  const canceled = ["canceled", "cancelled"];
  const paid = ["paid", "purchased", "ready"];
  const attention = ["paused", "suspended", "undelivered", "returned", "stolen", "lost"];

  // “undelivered” contém a substring “delivered” — tratar antes de entregue.
  if (attention.some((x) => s === x || s.includes(x))) return NEGOCIO.ATTENTION;
  if (delivered.some((x) => s === x || (s.includes(x) && !s.includes("undeliver"))))
    return NEGOCIO.DELIVERED;
  if (canceled.some((x) => s.includes(x) || s === x)) return NEGOCIO.CANCELED;
  if (transit.some((x) => s.includes(x) || s === x)) return NEGOCIO.IN_TRANSIT;
  if (posted.some((x) => s === x || s.includes(x))) return NEGOCIO.POSTED;
  if (paid.some((x) => s === x || s.includes(x))) return NEGOCIO.PAID;
  if (s === "pending" || s === "created" || s === "draft") return NEGOCIO.PENDING;

  return NEGOCIO.PENDING;
}

function mensagemAmigavel(statusNormalizado) {
  return MENSAGENS[statusNormalizado] || MENSAGENS.pending;
}

/** Etapas para a barra de progresso (0–4 índice exibido como “ativa” conforme status). */
function indiceEtapaProgresso(statusNormalizado) {
  const ordem = [
    NEGOCIO.PENDING,
    NEGOCIO.PAID,
    NEGOCIO.POSTED,
    NEGOCIO.IN_TRANSIT,
    NEGOCIO.DELIVERED,
  ];
  if (statusNormalizado === NEGOCIO.CANCELED || statusNormalizado === NEGOCIO.ATTENTION) return -1;
  const i = ordem.indexOf(statusNormalizado);
  if (i >= 0) return i;
  return 1;
}

module.exports = {
  NEGOCIO,
  MENSAGENS,
  normalizarStatus,
  mensagemAmigavel,
  indiceEtapaProgresso,
};
