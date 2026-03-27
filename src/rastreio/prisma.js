const { rastreioSemBanco } = require("./semBanco");

let prisma = null;
if (!rastreioSemBanco()) {
  const { PrismaClient } = require("@prisma/client");
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

module.exports = { prisma };
