/**
 * Base da API: meta delicatto-api-base.
 * No domínio delicattopersonalizados.com.br o site costuma ser só GitHub Pages: POST em /api/* dá 405.
 * Se a meta estiver vazia OU apontar para o mesmo host do site (Pages), usamos a API no Render.
 * Para API no mesmo domínio com Node de verdade, use subdomínio (ex.: https://api.delicattopersonalizados.com.br).
 */
const API_BASE_RENDER = "https://formulariodelicatto.onrender.com";

function urlApiConsultar() {
  const meta = document.querySelector('meta[name="delicatto-api-base"]');
  let base = (meta?.getAttribute("content") || "").trim().replace(/\/$/, "");
  const host = window.location.hostname;
  const naLoja =
    host === "delicattopersonalizados.com.br" || host === "www.delicattopersonalizados.com.br";

  const metaIgualAoSiteEstatico =
    !base ||
    base === window.location.origin ||
    /^https?:\/\/(www\.)?delicattopersonalizados\.com\.br$/i.test(base);

  if (naLoja && metaIgualAoSiteEstatico) {
    base = API_BASE_RENDER;
  }

  return `${base}/api/rastreio/consultar`;
}

/**
 * Código na URL: `?codigo=888...` ou `?888...` (só o número após ? , sem nome de parâmetro).
 */
function extrairCodigoDaQuery() {
  const raw = window.location.search.replace(/^\?/, "").trim();
  if (!raw) return "";
  if (raw.includes("=")) {
    const p = new URLSearchParams(window.location.search);
    const v = p.get("codigo") || p.get("c") || p.get("q") || p.get("rastreio");
    return String(v || "").trim();
  }
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/** URL amigável para compartilhar: /rastreios/tracking?888... (valor cru após ?). */
function definirUrlCompartilhavel(codigo) {
  const cod = String(codigo || "").trim();
  if (cod.length < 3) return;
  const q = encodeURIComponent(cod);
  const path = "/rastreios/tracking";
  try {
    const url = `${window.location.origin}${path}?${q}`;
    history.replaceState({ rastreio: cod }, "", url);
  } catch {
    /* ignore */
  }
}

const MSG_ERRO_REDE =
  "O navegador não conseguiu falar com o servidor (rede, bloqueador ou cache antigo). " +
  "A API está acessível: teste no Postman ou aguarde ~1 minuto no primeiro acesso (Render gratuito). " +
  "Atualize a página forçando novo carregamento (Ctrl+F5 ou, no telemóvel, “recarregar sem cache”). " +
  "Tente outra rede ou desative VPN/extensões que bloqueiem pedidos.";

const MSG_ERRO_RENDER =
  "Não foi possível mostrar o resultado na página. Tente atualizar o site (Ctrl+F5 ou limpar cache do navegador).";

async function fetchConsultarRastreio(codigo) {
  const url = urlApiConsultar();
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ codigo }),
  };
  let ultimoErro;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      if (tentativa > 0) {
        await new Promise((r) => setTimeout(r, 2500));
      }
      return await fetch(url, init);
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro;
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
const timelineHeader = document.getElementById("timeline-header");
const wrapSteps = document.getElementById("wrap-steps");

const LABEL_STATUS = {
  pending: "Aguardando",
  paid: "Preparando",
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

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmtDataDiaLinha(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.getDate()} ${MESES_CURTOS[d.getMonth()]}`;
  } catch {
    return "—";
  }
}

function fmtDataHoraLinha(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/** Ícone por tipo de evento (timeline estilo PAC, cores do tema). */
function classificarEvento(descricao, detalhe) {
  const d = `${descricao || ""} ${detalhe || ""}`.toLowerCase();
  if (/extravi|extraviad|perdido|roub|devolv|suspenso|danif|atraso crítico/i.test(d)) return "attention";
  if (
    (/entregue|destinatário|destinatario|entrega ao/i.test(d)) &&
    !/undelivered|não entregue|nao entregue/i.test(d)
  )
    return "delivered";
  if (
    /trânsito|transito|encaminhado|roteiriza|em transporte|\btransporte\b|saiu para entrega|transferido para outra unidade/i.test(d)
  )
    return "transit";
  if (/postado|postagem|coleta|transferência|transferencia|chegou na transportadora/i.test(d)) return "posted";
  if (/etiqueta|gerad|paga|pagamento|liberad|cte|adicionado no sistema/i.test(d)) return "label";
  return "default";
}

function svgTimelineIcon(kind) {
  const a = 'aria-hidden="true" focusable="false"';
  switch (kind) {
    case "delivered":
      return `<svg ${a} class="timeline-svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    case "transit":
      return `<svg ${a} class="timeline-svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M1 3h15v13H1V3zm16 8h4l3 4v3h-4M5 18a2 2 0 104 0 2 2 0 00-4 0zm12 0a2 2 0 104 0 2 2 0 00-4 0"/></svg>`;
    case "posted":
      return `<svg ${a} class="timeline-svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`;
    case "label":
      return `<svg ${a} class="timeline-svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>`;
    case "attention":
      return `<svg ${a} class="timeline-svg" viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`;
    default:
      return `<svg ${a} class="timeline-svg" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
  }
}

function svgPin() {
  const a = 'aria-hidden="true" focusable="false"';
  return `<svg ${a} class="timeline-loc-svg" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg>`;
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

  const stepTrackFill = document.getElementById("step-track-fill");

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
    wrapSteps?.classList.add("state-hidden");
    if (stepTrackFill) stepTrackFill.style.width = "0%";
  } else {
    wrapSteps?.classList.remove("state-hidden");
    etapas.forEach((e, i) => {
      const div = document.createElement("div");
      div.className = "step";
      div.setAttribute("role", "listitem");
      if (i < etapa) div.classList.add("done");
      if (i === etapa) div.classList.add("active");
      if (st === "delivered") div.classList.add("done");
      div.textContent = e.label;
      stepsBar.appendChild(div);
    });
    if (st === "delivered") {
      stepsBar.querySelectorAll(".step").forEach((el) => el.classList.add("done"));
    }
    if (stepTrackFill && etapas.length) {
      let pct;
      if (st === "delivered") {
        pct = 100;
      } else if (etapa < 0) {
        pct = 0;
      } else if (etapas.length > 1) {
        // Linha proporcional ao índice da etapa (alinhada ao status normalizado no servidor).
        pct = Math.min(100, (etapa / (etapas.length - 1)) * 100);
        if (pct > 0 && pct < 8) pct = 8;
      } else {
        pct = Math.min(100, ((etapa + 1) / etapas.length) * 100);
      }
      stepTrackFill.style.width = `${pct}%`;
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
    const pair = document.createElement("div");
    pair.className = "meta-pair";
    const dterm = document.createElement("dt");
    dterm.textContent = dt;
    const ddef = document.createElement("dd");
    ddef.textContent = dd;
    pair.appendChild(dterm);
    pair.appendChild(ddef);
    metaGrid.appendChild(pair);
  });

  timeline.innerHTML = "";
  const evs = data.eventos || [];
  timeline.classList.toggle("timeline--pac--no-rail", evs.length === 0);

  if (timelineHeader) {
    timelineHeader.innerHTML = "";
    if (evs.length) {
      timelineHeader.classList.remove("state-hidden");
      const inner = document.createElement("div");
      inner.className = "timeline-ship-head__inner";
      const tit = document.createElement("p");
      tit.className = "timeline-ship-head__title";
      tit.textContent = data.transportadora ? `Envio — ${data.transportadora}` : "Envio";
      const sub = document.createElement("p");
      sub.className = "timeline-ship-head__sub";
      sub.textContent = `Código: ${data.codigoRastreio || "—"}`;
      inner.appendChild(tit);
      inner.appendChild(sub);
      timelineHeader.appendChild(inner);
    } else {
      timelineHeader.classList.add("state-hidden");
    }
  }

  if (!evs.length) {
    const li = document.createElement("li");
    li.className = "timeline-item timeline-item--empty";
    li.textContent = "Nenhum evento detalhado disponível ainda.";
    timeline.appendChild(li);
  } else {
    const evsOrd = [...evs].sort((a, b) => {
      const ta = a.ocorridoEm ? new Date(a.ocorridoEm).getTime() : 0;
      const tb = b.ocorridoEm ? new Date(b.ocorridoEm).getTime() : 0;
      return tb - ta;
    });

    evsOrd.forEach((ev, idx) => {
      const kind = classificarEvento(ev.descricao, ev.detalhe);
      const li = document.createElement("li");
      li.className = `timeline-item timeline-item--${kind}`;
      li.setAttribute("role", "listitem");

      const dateCol = document.createElement("div");
      dateCol.className = "timeline-date";
      const dayEl = document.createElement("span");
      dayEl.className = "timeline-date__day";
      dayEl.textContent = fmtDataDiaLinha(ev.ocorridoEm);
      const timeEl = document.createElement("span");
      timeEl.className = "timeline-date__time";
      timeEl.textContent = fmtDataHoraLinha(ev.ocorridoEm);
      dateCol.appendChild(dayEl);
      dateCol.appendChild(timeEl);

      const node = document.createElement("div");
      node.className = "timeline-node";
      node.innerHTML = svgTimelineIcon(kind);

      const body = document.createElement("div");
      body.className = "timeline-item__body";

      const title = document.createElement("p");
      title.className = "timeline-item__title";
      title.textContent = ev.descricao || "Atualização";
      body.appendChild(title);

      if (ev.detalhe && String(ev.detalhe).trim()) {
        const sub = document.createElement("p");
        sub.className = "timeline-item__detail";
        sub.textContent = String(ev.detalhe).trim();
        body.appendChild(sub);
      }

      if (ev.local && String(ev.local).trim()) {
        const loc = document.createElement("p");
        loc.className = "timeline-item__location";
        loc.insertAdjacentHTML("afterbegin", svgPin());
        const locTxt = document.createElement("span");
        locTxt.textContent = String(ev.local).trim();
        loc.appendChild(locTxt);
        body.appendChild(loc);
      }

      const t = document.createElement("time");
      t.className = "timeline-item__time visually-hidden";
      t.dateTime = ev.ocorridoEm || "";
      t.textContent = fmtData(ev.ocorridoEm);
      body.appendChild(t);

      li.appendChild(dateCol);
      li.appendChild(node);
      li.appendChild(body);
      timeline.appendChild(li);

      if (idx === 0) {
        li.classList.add("timeline-item--latest");
      }
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
    const res = await fetchConsultarRastreio(codigo);

    if (res.status === 405) {
      mostrarErro(
        "Não há API de rastreio neste endereço (HTTP 405). O domínio está a servir só páginas estáticas (ex.: GitHub Pages), que não aceitam POST na API. " +
          "Configure no HTML a meta delicatto-api-base com a URL do servidor Node (onde roda npm start / a API), por exemplo: " +
          '<meta name="delicatto-api-base" content="https://seu-backend.example.com" />. ' +
          "Se o site e a API estão no mesmo servidor Node, deixe a meta vazia."
      );
      return;
    }

    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      const s = raw.trimStart();
      if (s.startsWith("<!DOCTYPE") || s.startsWith("<html")) {
        mostrarErro(
          "O endereço da API devolveu uma página HTML em vez do rastreio (JSON). " +
            "Confira no HTML a meta delicatto-api-base: deve ser a URL do servidor Node (ex.: Render), não o site em GitHub Pages."
        );
        return;
      }
      data = {};
    }

    if (data.ok) {
      try {
        definirUrlCompartilhavel(codigo);
        renderResultado(data);
      } catch (renderErr) {
        console.error("[rastreio] render:", renderErr);
        mostrarErro(MSG_ERRO_RENDER);
      }
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
      if (data.cache) {
        try {
          definirUrlCompartilhavel(codigo);
          renderResultado(data.cache);
        } catch (renderErr) {
          console.error("[rastreio] render cache:", renderErr);
          mostrarErro(MSG_ERRO_RENDER);
        }
      }
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
  } catch (err) {
    console.error("[rastreio] fetch:", err);
    mostrarErro(MSG_ERRO_REDE);
  } finally {
    setLoading(false);
  }
});

(function aplicarCodigoDaUrl() {
  const cod = extrairCodigoDaQuery();
  if (!input || cod.length < 3) return;
  input.value = cod;
  if (form) {
    form.requestSubmit();
  }
})();
