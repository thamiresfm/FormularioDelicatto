const { listarEnviosParaPolling, sincronizarEnvioComMelhorEnvio } = require("./envioService");

let intervalId = null;

function iniciarPollingMelhorEnvio() {
  const minutos = Number(process.env.RASTREIO_POLL_MINUTOS || 0);
  if (!minutos || minutos < 5) {
    console.log(
      "[rastreio] Polling automático desligado (defina RASTREIO_POLL_MINUTOS >= 5 para ativar)."
    );
    return;
  }

  const ms = minutos * 60 * 1000;
  intervalId = setInterval(async () => {
    try {
      const lista = await listarEnviosParaPolling();
      for (const { id } of lista) {
        try {
          await sincronizarEnvioComMelhorEnvio(id);
        } catch (e) {
          console.error(`[rastreio] polling falhou envio ${id}:`, e.message);
        }
      }
    } catch (e) {
      console.error("[rastreio] polling:", e);
    }
  }, ms);

  console.log(`[rastreio] Polling Melhor Envio a cada ${minutos} min.`);
}

function pararPolling() {
  if (intervalId) clearInterval(intervalId);
}

module.exports = { iniciarPollingMelhorEnvio, pararPolling };
