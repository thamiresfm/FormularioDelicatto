const express = require("express");
const crypto = require("crypto");
const { prisma } = require("./prisma");
const { consultaPublica } = require("./rateLimit");
const { middlewareAdmin } = require("./adminAuth");
const {
  sanitizarCodigoRastreio,
  buscarEnvioPorCodigoPublico,
  sincronizarEnvioComMelhorEnvio,
  montarDtoPublico,
  consultarPublicoDiretoMelhorEnvio,
  aplicarPayloadWebhook,
  listarEnviosParaPolling,
} = require("./envioService");

async function handleWebhookMelhorEnvio(req, res) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  let payloadStr = "";
  let payloadObj = null;

  try {
    if (Buffer.isBuffer(req.body)) {
      payloadStr = req.body.toString("utf8");
    } else if (typeof req.body === "string") {
      payloadStr = req.body;
    } else {
      payloadStr = JSON.stringify(req.body || {});
    }
    payloadObj = JSON.parse(payloadStr);
  } catch (_e) {
    payloadStr = String(req.body || "");
    try {
      payloadObj = JSON.parse(payloadStr);
    } catch (_e2) {
      payloadObj = {};
    }
  }

  const secret = process.env.ME_WEBHOOK_SECRET;
  const sigHeader = req.headers["x-me-signature"] || req.headers["x-signature"] || "";

  if (secret && sigHeader) {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payloadStr);
    const esperado = hmac.digest("hex");
    if (sigHeader !== esperado && !sigHeader.includes(esperado)) {
      await prisma.webhookLog.create({
        data: {
          payload: payloadStr.slice(0, 20_000),
          headers: JSON.stringify(req.headers),
          ip: String(ip),
          sucesso: false,
          mensagem: "Assinatura inválida",
        },
      });
      return res.status(401).send("invalid signature");
    }
  }

  try {
    const aplicado = await aplicarPayloadWebhook(payloadObj || {});
    await prisma.webhookLog.create({
      data: {
        payload: payloadStr.slice(0, 20_000),
        headers: JSON.stringify(req.headers),
        ip: String(ip),
        sucesso: aplicado.ok,
        mensagem: aplicado.reason || "ok",
      },
    });
    return res.status(200).json({ ok: true, ...aplicado });
  } catch (err) {
    console.error("[rastreio] webhook:", err);
    await prisma.webhookLog.create({
      data: {
        payload: payloadStr.slice(0, 20_000),
        headers: JSON.stringify(req.headers),
        ip: String(ip),
        sucesso: false,
        mensagem: err.message,
      },
    });
    return res.status(500).json({ ok: false });
  }
}

function registrarWebhookMelhorEnvio(app) {
  app.post(
    "/api/rastreio/webhook/melhor-envio",
    express.raw({ type: "*/*", limit: "256kb" }),
    handleWebhookMelhorEnvio
  );
}

function registrarRotasRastreio(app) {
  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ ok: true, servico: "rastreio", ts: new Date().toISOString() });
  });

  /** Consulta pública — erros de negócio com HTTP 200 + ok:false (evita “404” no DevTools). */
  api.post("/consultar", consultaPublica, async (req, res) => {
    try {
      const codigo = sanitizarCodigoRastreio(req.body?.codigo);
      if (codigo.length < 3) {
        return res.status(200).json({
          ok: false,
          codigoErro: "invalido",
          erro: "Informe um código de rastreio válido.",
        });
      }

      let envio = await buscarEnvioPorCodigoPublico(codigo);
      if (!envio) {
        const diretoMe = await consultarPublicoDiretoMelhorEnvio(codigo);
        if (diretoMe) {
          return res.json(diretoMe);
        }
        return res.status(200).json({
          ok: false,
          codigoErro: "nao_encontrado",
          erro: "Não encontramos um envio com esse código. Confira o código ou fale com a loja.",
        });
      }

      try {
        envio = await sincronizarEnvioComMelhorEnvio(envio.id);
      } catch (syncErr) {
        console.error("[rastreio] Falha ao sincronizar com Melhor Envio:", syncErr.message);
        return res.status(200).json({
          ok: false,
          codigoErro: "integracao",
          erro:
            "Não foi possível atualizar o status no momento. Tente novamente em instantes ou fale com a loja.",
          detalhe: process.env.NODE_ENV === "development" ? syncErr.message : undefined,
          cache: montarDtoPublico(envio),
        });
      }

      return res.json(montarDtoPublico(envio));
    } catch (err) {
      console.error("[rastreio] consultar:", err);
      return res.status(500).json({
        ok: false,
        codigoErro: "servidor",
        erro: "Erro interno. Tente novamente.",
      });
    }
  });

  const admin = express.Router();
  admin.use(middlewareAdmin);

  admin.get("/envios", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();

      const where = {};
      if (status) {
        where.statusNormalizado = status;
      }
      if (q) {
        where.OR = [
          { codigoRastreio: { contains: q } },
          { melhorEnvioShipmentId: { contains: q } },
          { pedido: { codigo: { contains: q } } },
          { pedido: { cliente: { nome: { contains: q } } } },
        ];
      }

      const rows = await prisma.envio.findMany({
        where,
        include: {
          pedido: { include: { cliente: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
      });

      return res.json({ ok: true, envios: rows });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, erro: err.message });
    }
  });

  admin.post("/clientes", async (req, res) => {
    try {
      const nome = String(req.body?.nome || "").trim();
      if (nome.length < 2) {
        return res.status(400).json({ ok: false, erro: "Nome do cliente obrigatório." });
      }
      const c = await prisma.cliente.create({
        data: {
          nome,
          email: req.body?.email ? String(req.body.email).trim().slice(0, 200) : null,
          telefone: req.body?.telefone ? String(req.body.telefone).trim().slice(0, 40) : null,
        },
      });
      return res.json({ ok: true, cliente: c });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, erro: err.message });
    }
  });

  admin.post("/pedidos", async (req, res) => {
    try {
      const codigo = String(req.body?.codigo || "").trim();
      if (codigo.length < 2) {
        return res.status(400).json({ ok: false, erro: "Código do pedido obrigatório." });
      }
      const pedido = await prisma.pedido.create({
        data: {
          codigo,
          titulo: req.body?.titulo ? String(req.body.titulo).slice(0, 300) : null,
          clienteId: req.body?.clienteId || null,
        },
      });
      return res.json({ ok: true, pedido });
    } catch (err) {
      if (err.code === "P2002") {
        return res.status(409).json({ ok: false, erro: "Já existe pedido com esse código." });
      }
      console.error(err);
      return res.status(500).json({ ok: false, erro: err.message });
    }
  });

  admin.post("/envios", async (req, res) => {
    try {
      const codigoRastreio = String(req.body?.codigoRastreio || "").trim();
      const melhorEnvioShipmentId = req.body?.melhorEnvioShipmentId
        ? String(req.body.melhorEnvioShipmentId).trim()
        : null;
      if (codigoRastreio.length < 3) {
        return res.status(400).json({ ok: false, erro: "Código de rastreio inválido." });
      }

      const { pedidoId } = req.body;
      const envio = await prisma.envio.create({
        data: {
          codigoRastreio: codigoRastreio.toUpperCase(),
          pedidoId: pedidoId || null,
          melhorEnvioShipmentId,
          statusRaw: "pending",
          statusNormalizado: "pending",
        },
      });
      return res.json({ ok: true, envio });
    } catch (err) {
      if (err.code === "P2002") {
        return res.status(409).json({ ok: false, erro: "Código de rastreio já cadastrado." });
      }
      console.error(err);
      return res.status(500).json({ ok: false, erro: err.message });
    }
  });

  admin.post("/envios/:id/sincronizar", async (req, res) => {
    try {
      const atualizado = await sincronizarEnvioComMelhorEnvio(req.params.id);
      return res.json({ ok: true, envio: atualizado });
    } catch (err) {
      console.error(err);
      return res.status(400).json({ ok: false, erro: err.message });
    }
  });

  admin.post("/sincronizar-todos", async (_req, res) => {
    try {
      const lista = await listarEnviosParaPolling();
      const resultados = [];
      for (const { id } of lista) {
        try {
          await sincronizarEnvioComMelhorEnvio(id);
          resultados.push({ id, ok: true });
        } catch (e) {
          resultados.push({ id, ok: false, erro: e.message });
        }
      }
      return res.json({ ok: true, total: lista.length, resultados });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, erro: err.message });
    }
  });

  api.use("/admin", admin);

  app.use("/api/rastreio", api);
}

module.exports = { registrarWebhookMelhorEnvio, registrarRotasRastreio };
