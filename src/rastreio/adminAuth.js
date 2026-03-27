/**
 * Proteção simples dos endpoints administrativos.
 * Em produção, prefira JWT de curta duração + HTTPS obrigatório.
 */

function middlewareAdmin(req, res, next) {
  const token = process.env.RASTREIO_ADMIN_TOKEN;
  if (!token || token.length < 16) {
    console.error(
      "[rastreio] RASTREIO_ADMIN_TOKEN não configurado ou inválido — admin desativado."
    );
    return res.status(503).json({
      ok: false,
      erro: "Painel administrativo não configurado no servidor.",
    });
  }

  const sent =
    req.headers["x-rastreio-admin-token"] ||
    (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ""));

  if (!sent || sent !== token) {
    return res.status(401).json({ ok: false, erro: "Não autorizado." });
  }

  next();
}

module.exports = { middlewareAdmin };
