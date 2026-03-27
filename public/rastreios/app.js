/** Base da API: mesma origem se vazio; ou meta name="delicatto-api-base" (ex.: site estático + API em outro host) */
function urlApiConsultar() {
  const meta = document.querySelector('meta[name="delicatto-api-base"]');
  const base = (meta?.getAttribute("content") || "").trim().replace(/\/$/, "");
  return `${base}/api/rastreio/consultar`;
}

const form = document.getElementById("form-rastreio");
const input = document.getElementById("codigo");
const btn = document.getElementById("btn-consultar");
const stateLoading = document.getElementById("state-loading");
const stateErro = document.getElementById("state-erro");
const painel = document.getElementById("painel-resultado");
const statusPill = document.getElementById("status-pill");
const msgAmigavel = document.getElementById("msg-amigavel");
const stepsBar = document.getElementById("steps-bar");
const metaGrid = document.getElementById("meta-grid");
const timeline = document.getElementById("timeline");
const wrapSteps = document.getElementById("wrap-steps");

const LABEL_STATUS = {
  pending: "Aguardando",
  paid: "Etiqueta paga",
  posted: "Postado",
  in_transit: "Em trânsito",
  delivered: "Entregue",
  canceled: "Cancelado",
  attention: "Atenção",
};

function fmtData(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function setLoading(on) {
  stateLoading.classList.toggle("state-hidden", !on);
  btn.disabled = on;
}

function mostrarErro(texto) {
  stateErro.textContent = texto;
  stateErro.classList.remove("state-hidden");
  painel.classList.add("state-hidden");
}

function limparErro() {
  stateErro.classList.add("state-hidden");
  stateErro.textContent = "";
}

function renderResultado(data) {
  limparErro();
  painel.classList.remove("state-hidden");

  const st = data.status;
  statusPill.textContent = LABEL_STATUS[st] || st;
  statusPill.className = "status-pill ";
  if (st === "delivered") statusPill.className += "ok";
  else if (st === "canceled" || st === "attention") statusPill.className += st === "canceled" ? "err" : "warn";
  else statusPill.className += "neutral";

  msgAmigavel.textContent = data.mensagem || "";

  const etapa = data.etapaProgresso;
  const etapas = data.etapas || [];
  stepsBar.innerHTML = "";
  if (etapa < 0 || st === "attention") {
    wrapSteps.classList.add("state-hidden");
  } else {
    wrapSteps.classList.remove("state-hidden");
    etapas.forEach((e, i) => {
      const div = document.createElement("div");
      div.className = "step";
      if (i < etapa) div.classList.add("done");
      if (i === etapa) div.classList.add("active");
      if (st === "delivered") div.classList.add("done");
      div.textContent = e.label;
      stepsBar.appendChild(div);
    });
    if (st === "delivered") {
      stepsBar.querySelectorAll(".step").forEach((el) => el.classList.add("done"));
    }
  }

  metaGrid.innerHTML = "";
  const rows = [
    ["Código", data.codigoRastreio],
    ["Transportadora", data.transportadora || "—"],
    ["Criação", fmtData(data.dataCriacao)],
    ["Última atualização", fmtData(data.dataAtualizacao)],
    ["Sincronizado em", fmtData(data.ultimaSincronizacao)],
  ];
  if (data.pedido?.codigo) {
    rows.push(["Pedido", data.pedido.codigo]);
  }
  rows.forEach(([dt, dd]) => {
    const dterm = document.createElement("dt");
    dterm.textContent = dt;
    const ddef = document.createElement("dd");
    ddef.textContent = dd;
    metaGrid.appendChild(dterm);
    metaGrid.appendChild(ddef);
  });

  timeline.innerHTML = "";
  const evs = data.eventos || [];
  if (!evs.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum evento detalhado disponível ainda.";
    timeline.appendChild(li);
  } else {
    evs.forEach((ev) => {
      const li = document.createElement("li");
      const t = document.createElement("time");
      t.dateTime = ev.ocorridoEm || "";
      t.textContent = fmtData(ev.ocorridoEm);
      li.appendChild(t);
      li.appendChild(document.createTextNode(ev.descricao || ""));
      timeline.appendChild(li);
    });
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  limparErro();
  painel.classList.add("state-hidden");

  const codigo = String(input.value || "").trim();
  if (codigo.length < 3) {
    mostrarErro("Informe um código de rastreio válido.");
    return;
  }

  setLoading(true);
  try {
    const res = await fetch(urlApiConsultar(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ codigo }),
    });
    const data = await res.json().catch(() => ({}));

    if (data.ok) {
      renderResultado(data);
      return;
    }

    if (data.codigoErro === "nao_encontrado") {
      mostrarErro(data.erro || "Não encontramos um envio com esse código.");
      return;
    }
    if (data.codigoErro === "invalido") {
      mostrarErro(data.erro || "Código inválido.");
      return;
    }
    if (data.codigoErro === "integracao") {
      mostrarErro(data.erro || "Falha na integração.");
      if (data.cache) renderResultado(data.cache);
      return;
    }
    if (data.codigoErro === "servidor") {
      mostrarErro(data.erro || "Erro no servidor.");
      return;
    }

    if (res.status === 404) {
      mostrarErro(
        "Não há API de rastreio neste endereço. Se você usa o site no GitHub Pages, configure no HTML a meta " +
          'delicatto-api-base com a URL do servidor Node (onde rodou npm start). Em testes locais, use npm start e acesse http://localhost:3000/rastreios/'
      );
      return;
    }
    if (!res.ok) {
      mostrarErro(data.erro || "Não foi possível consultar. Tente novamente.");
      return;
    }

    mostrarErro("Resposta inesperada. Tente novamente.");
  } catch {
    mostrarErro("Sem conexão ou servidor indisponível. Tente novamente.");
  } finally {
    setLoading(false);
  }
});
