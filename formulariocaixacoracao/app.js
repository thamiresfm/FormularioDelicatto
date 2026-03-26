import {
  limparTodasPreviewsFotos,
  wireFotoPreviewListeners,
} from "../js/foto-preview.js";

/** WhatsApp da loja (E.164, sem +): +55 21 99672-8473 */
const WHATSAPP_LOJA_E164 = "5521996728473";
const WA_TEXTO_MAX = 3500;
const NUM_FOTOS = 6;
const MIN_FOTO_BYTES = 15 * 1024;
const MAX_FRASE_LATERAL = 35;
const MAX_FRASE_CORACAO = 20;

const OPCOES_CAIXA_LABEL = {
  "caixa-completa": "Caixa completa",
  "so-led-palha": "Caixa com led e palha",
  "so-chocolate": "Caixa com chocolate",
};

const form = document.getElementById("pedido-form");
const tipoOpcaoInputs = form.querySelectorAll('input[name="opcaoCaixa"]');
const secPerso = document.getElementById("sec-personalizacao");
const secFotos = document.getElementById("sec-fotos");
const secEndereco = document.getElementById("sec-endereco");
const secCliente = document.getElementById("sec-cliente");
const actionsPrimary = document.getElementById("actions-primary");
const bannerCompleta = document.getElementById("banner-completa");
const bannerLedPalha = document.getElementById("banner-led-palha");
const bannerChocolate = document.getElementById("banner-chocolate");
const btnResumo = document.getElementById("btn-resumo");
const panelResumo = document.getElementById("panel-resumo");
const resumoConteudo = document.getElementById("resumo-conteudo");
const btnVoltar = document.getElementById("btn-voltar");
const btnEnviar = document.getElementById("btn-enviar");
const toast = document.getElementById("toast");
const cepInput = document.getElementById("cep");
const ufInput = document.getElementById("uf");
const cpfInput = document.getElementById("cpf");

let resumoAberto = false;
let ultimoTextoWhatsapp = "";
let ultimoFotosShare = null;

function showToast(message, isError) {
  toast.textContent = message;
  toast.classList.toggle("error", !!isError);
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 5200);
}

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function formatCep(v) {
  const d = onlyDigits(v).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function formatCpf(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatDateBR(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

function cpfValido(digits) {
  const s = onlyDigits(digits);
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(s[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(s[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(s[10], 10);
}

let ultimoCepPreenchidoViaApi = "";
let cepDebounceTimer = null;

async function buscarEnderecoPorCep(digits) {
  const ruaEl = document.getElementById("rua");
  const bairroEl = document.getElementById("bairro");
  const cidadeEl = document.getElementById("cidade");
  const ufEl = document.getElementById("uf");
  cepInput.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (data.erro) {
      ultimoCepPreenchidoViaApi = "";
      showToast("CEP não encontrado. Confira os números ou preencha o endereço manualmente.", true);
      return;
    }
    ultimoCepPreenchidoViaApi = digits;
    if (data.logradouro) ruaEl.value = data.logradouro;
    if (data.bairro) bairroEl.value = data.bairro;
    if (data.localidade) cidadeEl.value = data.localidade;
    if (data.uf) ufEl.value = String(data.uf).toUpperCase().slice(0, 2);
    clearFieldErrors();
  } catch (_e) {
    ultimoCepPreenchidoViaApi = "";
    showToast("Não foi possível consultar o CEP. Preencha o endereço manualmente.", true);
  } finally {
    cepInput.removeAttribute("aria-busy");
  }
}

cepInput.addEventListener("input", () => {
  cepInput.value = formatCep(cepInput.value);
  const d = onlyDigits(cepInput.value);
  clearTimeout(cepDebounceTimer);
  if (d.length !== 8) {
    ultimoCepPreenchidoViaApi = "";
    return;
  }
  cepDebounceTimer = setTimeout(() => {
    if (d === ultimoCepPreenchidoViaApi) return;
    buscarEnderecoPorCep(d);
  }, 450);
});

ufInput.addEventListener("input", () => {
  ufInput.value = ufInput.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
});

cpfInput.addEventListener("input", () => {
  cpfInput.value = formatCpf(cpfInput.value);
});

function getOpcaoCaixa() {
  const el = form.querySelector('input[name="opcaoCaixa"]:checked');
  const v = el ? el.value.trim() : "";
  return v && Object.prototype.hasOwnProperty.call(OPCOES_CAIXA_LABEL, v) ? v : null;
}

function textoOpcaoLegivel() {
  const k = getOpcaoCaixa();
  return k ? OPCOES_CAIXA_LABEL[k] : "—";
}

function getFotoPrincipalNumero() {
  const el = form.querySelector('input[name="fotoPrincipal"]:checked');
  return el ? el.value : null;
}

function montarLinhaEnderecoCompleto() {
  const rua = document.getElementById("rua").value.trim();
  const numero = document.getElementById("numero").value.trim();
  const cidade = document.getElementById("cidade").value.trim();
  const uf = document.getElementById("uf").value.trim().toUpperCase();
  const ref = document.getElementById("referencia").value.trim();
  let linha = `${rua}, ${numero} — ${cidade}/${uf}`;
  if (ref) linha += ` — Ref.: ${ref}`;
  return linha;
}

function textoFotoPrincipalParaWhatsapp() {
  const n = getFotoPrincipalNumero();
  if (!n) return "—";
  const f = document.getElementById(`foto${n}`)?.files?.[0];
  const nome = f ? f.name : "(arquivo não selecionado)";
  return `Foto ${n} — ${nome}`;
}

function atualizarVisibilidadeProduto() {
  const tipo = getOpcaoCaixa();
  const mostrar = !!tipo;
  const estavaOculto = secPerso && secPerso.classList.contains("hidden");
  [secPerso, secFotos, secEndereco, secCliente, actionsPrimary].forEach((el) => {
    el.classList.toggle("hidden", !mostrar);
  });

  if (bannerCompleta) bannerCompleta.classList.toggle("hidden", !mostrar || tipo !== "caixa-completa");
  if (bannerLedPalha) bannerLedPalha.classList.toggle("hidden", !mostrar || tipo !== "so-led-palha");
  if (bannerChocolate) bannerChocolate.classList.toggle("hidden", !mostrar || tipo !== "so-chocolate");

  if (tipo && estavaOculto && secPerso) {
    requestAnimationFrame(() => secPerso.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

tipoOpcaoInputs.forEach((input) => {
  input.addEventListener("change", atualizarVisibilidadeProduto);
});

function clearFieldErrors() {
  form.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
}

function markError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("field-error");
}

function markFieldsetPrincipalError() {
  const fs = document.getElementById("fieldset-principal");
  if (fs) fs.classList.add("field-error");
}

function validar() {
  clearFieldErrors();
  document.getElementById("fieldset-principal")?.classList.remove("field-error");
  const erros = [];

  if (!getOpcaoCaixa()) {
    erros.push("Selecione a opção da caixa.");
    return erros;
  }

  const fraseLateral = document.getElementById("fraseLateral").value.trim();
  if (fraseLateral.length < 1) {
    erros.push("Informe a frase pequena para lateral da caixa.");
    markError("fraseLateral");
  } else if (fraseLateral.length > MAX_FRASE_LATERAL) {
    erros.push(`A frase da lateral pode ter no máximo ${MAX_FRASE_LATERAL} caracteres.`);
    markError("fraseLateral");
  }

  const fraseCoracao = document.getElementById("fraseCoracao").value.trim();
  if (fraseCoracao.length < 1) {
    erros.push("Informe a frase para coração da caixa.");
    markError("fraseCoracao");
  } else if (fraseCoracao.length > MAX_FRASE_CORACAO) {
    erros.push(`A frase do coração pode ter no máximo ${MAX_FRASE_CORACAO} caracteres.`);
    markError("fraseCoracao");
  }

  const dataDestaque = document.getElementById("dataDestaque").value;
  if (!dataDestaque) {
    erros.push("Informe a data que deseja colocar.");
    markError("dataDestaque");
  }

  const fotos = [];
  for (let i = 1; i <= NUM_FOTOS; i++) {
    fotos.push(document.getElementById(`foto${i}`).files[0]);
  }
  if (fotos.some((f) => !f)) {
    erros.push("Envie as 6 fotos.");
    for (let i = 1; i <= NUM_FOTOS; i++) markError(`foto${i}`);
  } else {
    fotos.forEach((f, i) => {
      if (f.size < MIN_FOTO_BYTES) {
        erros.push(`A foto ${i + 1} parece muito pequena; prefira arquivo HD ou original.`);
        markError(`foto${i + 1}`);
      }
    });
  }

  const principal = getFotoPrincipalNumero();
  if (!principal) {
    erros.push("Indique qual é a foto principal.");
    markFieldsetPrincipalError();
  }

  const rua = document.getElementById("rua").value.trim();
  if (rua.length < 2) {
    erros.push("Informe a rua.");
    markError("rua");
  }

  const numero = document.getElementById("numero").value.trim();
  if (!numero) {
    erros.push("Informe o número.");
    markError("numero");
  }

  const bairro = document.getElementById("bairro").value.trim();
  if (bairro.length < 2) {
    erros.push("Informe o bairro.");
    markError("bairro");
  }

  const cidade = document.getElementById("cidade").value.trim();
  if (cidade.length < 2) {
    erros.push("Informe a cidade.");
    markError("cidade");
  }

  const uf = document.getElementById("uf").value.trim();
  if (uf.length !== 2) {
    erros.push("Informe a UF com 2 letras.");
    markError("uf");
  }

  const cep = onlyDigits(document.getElementById("cep").value);
  if (cep.length !== 8) {
    erros.push("CEP inválido.");
    markError("cep");
  }

  const nome = document.getElementById("nomeCompleto").value.trim();
  if (nome.split(/\s+/).filter(Boolean).length < 2) {
    erros.push("Informe o nome completo.");
    markError("nomeCompleto");
  }

  const cpf = document.getElementById("cpf").value;
  if (!cpfValido(cpf)) {
    erros.push("CPF inválido.");
    markError("cpf");
  }

  return erros;
}

function montarTextoWhatsappPedido() {
  const cepFmt = formatCep(document.getElementById("cep").value);
  const dataFmt = formatDateBR(document.getElementById("dataDestaque").value);
  const linhas = [];
  linhas.push("Caixa surpresa coração");
  linhas.push(textoOpcaoLegivel());
  linhas.push("Pagamento confirmado ✅");
  linhas.push("");
  linhas.push(`Frase pequena para lateral da caixa: ${document.getElementById("fraseLateral").value.trim()}`);
  linhas.push("");
  linhas.push(`Frase para coração da caixa: ${document.getElementById("fraseCoracao").value.trim()}`);
  linhas.push("");
  linhas.push(`Data que deseja colocar: ${dataFmt}`);
  linhas.push("");
  linhas.push("Fotos: 6 anexos");
  linhas.push(`Foto principal: ${textoFotoPrincipalParaWhatsapp()}`);
  linhas.push("");
  linhas.push(`Endereço completo: ${montarLinhaEnderecoCompleto()}`);
  linhas.push(`CEP: ${cepFmt}`);
  linhas.push(`Bairro: ${document.getElementById("bairro").value.trim()}`);
  linhas.push(`Nome completo: ${document.getElementById("nomeCompleto").value.trim()}`);
  linhas.push(`CPF: ${formatCpf(document.getElementById("cpf").value)}`);
  return linhas.join("\n");
}

function isMobileDispositivo() {
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgentData &&
    typeof navigator.userAgentData.mobile === "boolean"
  ) {
    return navigator.userAgentData.mobile;
  }
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  if (/Android/i.test(ua)) return true;
  if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

function abrirUrlWhatsappComTexto(texto) {
  let corpo = texto;
  if (corpo.length > WA_TEXTO_MAX) {
    corpo = `${corpo.slice(0, WA_TEXTO_MAX)}\n…(texto truncado)`;
  }
  const encoded = encodeURIComponent(corpo);
  const phone = WHATSAPP_LOJA_E164;
  const base = isMobileDispositivo() ? "https://api.whatsapp.com/send" : "https://web.whatsapp.com/send";
  let url = `${base}?phone=${phone}&text=${encoded}`;
  if (url.length > 8000) {
    url = `${base}?phone=${phone}`;
  }
  return url;
}

function abrirWhatsappUrl(url) {
  if (isMobileDispositivo()) {
    window.location.assign(url);
    return;
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win) return;
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function coletarArquivosFotosOrdenados() {
  const out = [];
  for (let i = 1; i <= NUM_FOTOS; i++) {
    out.push(document.getElementById(`foto${i}`).files[0]);
  }
  return out.every(Boolean) ? out : null;
}

function finalizarPedidoAposEnvio() {
  resumoAberto = false;
  panelResumo.classList.add("hidden");
  form.reset();
  limparTodasPreviewsFotos(NUM_FOTOS);
  ultimoCepPreenchidoViaApi = "";
  atualizarVisibilidadeProduto();
  ultimoTextoWhatsapp = "";
  ultimoFotosShare = null;
}

/**
 * O 2º navigator.share() precisa de novo gesto do usuário (requisito dos navegadores).
 * Abre modal com botão que dispara o compartilhamento das outras 5 fotos.
 */
function aguardarSharePasso2(outrasFiles) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-share-passo2");
    const btnOk = document.getElementById("btn-share-outras-fotos");
    const btnCancel = document.getElementById("btn-share-passo2-cancelar");
    if (!modal || !btnOk || !btnCancel) {
      showToast("Não foi possível mostrar o passo 2. Anexe as outras 5 fotos manualmente no WhatsApp.", true);
      resolve("ok-fotos-duplo-parcial");
      return;
    }

    const fechar = () => {
      modal.classList.add("hidden");
    };

    const onOk = async () => {
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      try {
        await navigator.share({
          title: "Delicatto — Outras 5 fotos",
          text: "Outras 5 fotos do mesmo pedido (Caixa Surpresa Coração).",
          files: outrasFiles,
        });
        fechar();
        resolve("ok-fotos-duplo");
      } catch (err) {
        fechar();
        if (err && err.name === "AbortError") {
          resolve("cancelado");
        } else {
          showToast(
            "Não foi possível compartilhar as 5 fotos; anexe-as manualmente na mesma conversa do WhatsApp.",
            true
          );
          resolve("ok-fotos-duplo-parcial");
        }
      }
    };

    const onCancel = () => {
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      fechar();
      showToast("Envie as outras 5 fotos manualmente na mesma conversa do WhatsApp.", true);
      resolve("ok-fotos-duplo-parcial");
    };

    modal.classList.remove("hidden");
    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
    setTimeout(() => btnOk.focus(), 100);
  });
}

async function enviarPedidoWhatsappAgora() {
  const texto = ultimoTextoWhatsapp;
  const files = ultimoFotosShare;
  if (!texto) {
    showToast("Erro ao montar o pedido.", true);
    return "cancelado";
  }

  const mobile = isMobileDispositivo();
  const temSeisFotos = files && files.length === NUM_FOTOS && files.every(Boolean);
  const temShare = typeof navigator !== "undefined" && navigator.share;

  /**
   * Celular: sempre tentar 2 compartilhamentos (foto principal + texto, depois outras 5).
   * Não usar navigator.canShare para decidir — em vários aparelhos canShare({ 5 arquivos }) retorna
   * false e o fluxo caía no envio único com 6 fotos.
   */
  if (mobile && temSeisFotos && temShare) {
    const principalNum = parseInt(getFotoPrincipalNumero(), 10);
    if (principalNum >= 1 && principalNum <= NUM_FOTOS) {
      const principalFile = files[principalNum - 1];
      const outrasFiles = files.filter((_, idx) => idx !== principalNum - 1);
      if (principalFile && outrasFiles.length === NUM_FOTOS - 1) {
        let primeiraEtapaOk = false;
        try {
          await navigator.share({
            title: "Delicatto — Foto principal",
            text: `Foto principal\n\n${texto}`,
            files: [principalFile],
          });
          primeiraEtapaOk = true;
        } catch (err) {
          if (err && err.name === "AbortError") return "cancelado";
          try {
            await navigator.share({
              text: `Foto principal\n\n${texto}`,
              files: [principalFile],
            });
            primeiraEtapaOk = true;
          } catch (errAlt) {
            if (errAlt && errAlt.name === "AbortError") return "cancelado";
          }
        }
        if (!primeiraEtapaOk) {
          showToast(
            "Não foi possível compartilhar só a foto principal. Abrindo o WhatsApp com o texto do pedido — anexe as fotos na conversa.",
            true
          );
        }
        if (primeiraEtapaOk) {
          return await aguardarSharePasso2(outrasFiles);
        }
      }
    }
  }

  let podeCompartilharComFotos = !mobile && temSeisFotos && temShare;
  if (podeCompartilharComFotos && navigator.canShare) {
    podeCompartilharComFotos = navigator.canShare({ files });
  }

  if (podeCompartilharComFotos) {
    try {
      await navigator.share({
        title: "Delicatto — Caixa Surpresa Coração — texto + 6 imagens",
        text: texto,
        files,
      });
      return "ok-fotos";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelado";
      showToast("Abrindo só o texto no WhatsApp; anexe as 6 fotos na conversa.", true);
    }
  }

  const url = abrirUrlWhatsappComTexto(texto);
  if (isMobileDispositivo()) {
    finalizarPedidoAposEnvio();
    window.location.assign(url);
    return "navegando";
  }
  abrirWhatsappUrl(url);
  return "ok";
}

function montarResumo() {
  const fd = new FormData(form);
  const cepFmt = formatCep(fd.get("cep"));
  const nomeArquivos = [1, 2, 3, 4, 5, 6].map((i) => {
    const f = document.getElementById(`foto${i}`).files[0];
    return f ? f.name : "—";
  });
  const dataFmt = formatDateBR(fd.get("dataDestaque"));

  const rows = [
    ["Produto", `Caixa Surpresa Coração — ${textoOpcaoLegivel()}`],
    ["Pagamento", "Confirmado ✅"],
    ["Frase — lateral da caixa", fd.get("fraseLateral")],
    ["Frase — coração da caixa", fd.get("fraseCoracao")],
    ["Data", dataFmt],
    ["Foto principal", textoFotoPrincipalParaWhatsapp()],
    ["Fotos (nomes dos arquivos)", nomeArquivos.join(" · ")],
    ["Rua", fd.get("rua")],
    ["Número", fd.get("numero")],
    ["Bairro", fd.get("bairro")],
    ["Cidade / UF", `${fd.get("cidade")} — ${String(fd.get("uf") || "").toUpperCase()}`],
    ["CEP", cepFmt],
    ["Referência", fd.get("referencia")?.trim() || "—"],
    ["Nome", fd.get("nomeCompleto")],
    ["CPF", formatCpf(fd.get("cpf"))],
  ];

  resumoConteudo.innerHTML = "";
  rows.forEach(([dt, dd]) => {
    const dterm = document.createElement("dt");
    dterm.textContent = dt;
    const ddef = document.createElement("dd");
    ddef.textContent = dd;
    resumoConteudo.appendChild(dterm);
    resumoConteudo.appendChild(ddef);
  });
}

btnResumo.addEventListener("click", () => {
  const erros = validar();
  if (erros.length) {
    showToast(erros[0], true);
    return;
  }
  ultimoTextoWhatsapp = "";
  ultimoFotosShare = null;
  montarResumo();
  resumoAberto = true;
  panelResumo.classList.remove("hidden");
  panelResumo.scrollIntoView({ behavior: "smooth", block: "start" });
});

btnVoltar.addEventListener("click", () => {
  resumoAberto = false;
  panelResumo.classList.add("hidden");
  form.scrollIntoView({ behavior: "smooth" });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const erros = validar();
  if (erros.length) {
    showToast(erros[0], true);
    panelResumo.classList.add("hidden");
    resumoAberto = false;
    return;
  }

  if (!resumoAberto) {
    showToast('Use "Ver resumo antes de enviar" para revisar o pedido.', true);
    return;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    showToast("Sem conexão com a internet. Tente novamente.", true);
    return;
  }

  btnEnviar.disabled = true;
  try {
    ultimoFotosShare = coletarArquivosFotosOrdenados();
    ultimoTextoWhatsapp = montarTextoWhatsappPedido();

    const resultado = await enviarPedidoWhatsappAgora();
    if (resultado === "cancelado") {
      return;
    }
    if (resultado === "navegando") {
      return;
    }
    finalizarPedidoAposEnvio();
    if (resultado === "ok-fotos-duplo") {
      showToast(
        "Foram duas etapas: foto principal com o texto do pedido e, em seguida, as outras 5 fotos. Confira se ambas foram para o WhatsApp da loja (+55 21 99672-8473)."
      );
    } else if (resultado === "ok-fotos-duplo-parcial") {
      showToast(
        "A foto principal foi enviada; complete anexando as outras 5 fotos na mesma conversa com a loja (+55 21 99672-8473)."
      );
    } else if (resultado === "ok-fotos") {
      showToast(
        "No próximo passo, escolha o WhatsApp e o contato da loja (+55 21 99672-8473). O texto e as 6 imagens vão juntos no envio."
      );
    } else if (isMobileDispositivo()) {
      showToast("WhatsApp aberto com o texto — anexe as 6 fotos se ainda não enviou.");
    } else {
      showToast(
        "Abrimos o WhatsApp Web com o texto do pedido. Anexe as 6 fotos na conversa (arrastar ou botão de clipe)."
      );
    }
  } catch (err) {
    console.error(err);
    const detalhe = err && err.message ? err.message : "falha ao processar o pedido";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const dicaInApp = /Instagram|FBAN|FBAV|Line\/|MicroMessenger|WebView/i.test(ua)
      ? " Se estiver dentro do Instagram/WhatsApp, abra o link no Safari ou Chrome."
      : "";
    showToast(`Não foi possível concluir: ${detalhe}.${dicaInApp}`, true);
  } finally {
    btnEnviar.disabled = false;
  }
});

wireFotoPreviewListeners(NUM_FOTOS);

atualizarVisibilidadeProduto();
