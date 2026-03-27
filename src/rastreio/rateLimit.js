const rateLimit = require("express-rate-limit");

const consultaPublica = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RASTREIO_RATE_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, erro: "Muitas consultas. Tente novamente em alguns minutos." },
});

module.exports = { consultaPublica };
