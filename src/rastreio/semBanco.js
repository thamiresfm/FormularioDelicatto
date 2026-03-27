/**
 * Modo sem banco: só consulta pública ao Melhor Envio (sem Prisma / SQLite / Postgres).
 * Ative com RASTREIO_SEM_BANCO=1 no .env (sem DATABASE_URL obrigatório para o rastreio).
 */

function rastreioSemBanco() {
  return process.env.RASTREIO_SEM_BANCO === "1" || process.env.RASTREIO_SEM_BANCO === "true";
}

module.exports = { rastreioSemBanco };
