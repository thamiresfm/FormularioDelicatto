import {
  limparTodasPreviewsFotos,
  wireFotoPreviewListeners,
} from "../js/foto-preview.js";

/** WhatsApp da loja (E.164, sem +): +55 21 99672-8473 — sempre usado em api.whatsapp.com/send */
const WHATSAPP_LOJA_E164 = "5521996728473";
const NUM_FOTOS_PREVIEW = 3;
const WA_TEXTO_MAX = 3500;

const form = document.getElementById("pedido-form");
  const tipoInputs = form.querySelectorAll('input[name="tipoProduto"]');
  const secPerso = document.getElementById("sec-personalizacao");
  const secFotos = document.getElementById("sec-fotos");
  const secEndereco = document.getElementById("sec-endereco");
  const secCliente = document.getElementById("sec-cliente");
  const actionsPrimary = document.getElementById("actions-primary");
  const bannerCompleta = document.getElementById("banner-completa");
  const bannerSem = document.getElementById("banner-sem");
  const bannerPalhaLed = document.getElementById("banner-palha-led");
  const btnResumo = document.getElementById("btn-resumo");
  const panelResumo = document.getElementById("panel-resumo");
  const resumoConteudo = document.getElementById("resumo-conteudo");
  const btnVoltar = document.getElementById("btn-voltar");
  const btnEnviar = document.getElementById("btn-enviar");
  const toast = document.getElementById("toast");
  const cepInput = document.getElementById("cep");
  const ufInput = document.getElementById("uf");
  const cpfInput = document.getElementById("cpf");
  const tipoExtraTampa = document.getElementById("tipoExtraTampa");
  const wrapDataEspecial = document.getElementById("wrap-data-especial");
  const wrapEuTeAmo = document.getElementById("wrap-eu-te-amo");
  const wrapTextoCurto = document.getElementById("wrap-texto-curto");

  let resumoAberto = false;
  let ultimoTextoWhatsapp = "";
  /** Três arquivos de foto (antes do reset) — usados no compartilhamento nativo com imagens. */
  let ultimoFotosShare = null;

  function formatDateBR(iso) {
    if (!iso) return "";
    const parts = String(iso).split("-");
    if (parts.length !== 3) return iso;
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }

  function atualizarExtraTampa() {
    if (!tipoExtraTampa) return;
    const v = tipoExtraTampa.value;
    if (wrapDataEspecial) wrapDataEspecial.classList.toggle("hidden", v !== "data-especial");
    if (wrapEuTeAmo) wrapEuTeAmo.classList.toggle("hidden", v !== "eu-te-amo");
    if (wrapTextoCurto) wrapTextoCurto.classList.toggle("hidden", v !== "texto-curto");
  }

  if (tipoExtraTampa) {
    tipoExtraTampa.addEventListener("change", atualizarExtraTampa);
    tipoExtraTampa.addEventListener("input", atualizarExtraTampa);
    atualizarExtraTampa();
  }

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

  /** Consulta de CEP (serviço público). */
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

  function getTipoSelecionado() {
    const el = form.querySelector('input[name="tipoProduto"]:checked');
    return el ? el.value : null;
  }

  function atualizarVisibilidadeProduto() {
    const tipo = getTipoSelecionado();
    const mostrar = !!tipo;
    [secPerso, secFotos, secEndereco, secCliente, actionsPrimary].forEach((el) => {
      el.classList.toggle("hidden", !mostrar);
    });

    bannerCompleta.classList.toggle("hidden", !mostrar || tipo !== "completa");
    bannerSem.classList.toggle("hidden", !mostrar || tipo !== "sem-chocolate");
    bannerPalhaLed.classList.toggle("hidden", !mostrar || tipo !== "sem-chocolate-palha-led");
  }

  tipoInputs.forEach((input) => {
    input.addEventListener("change", atualizarVisibilidadeProduto);
  });

  function clearFieldErrors() {
    form.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
  }

  function markError(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("field-error");
  }

  const MIN_FOTO_BYTES = 15 * 1024;
  const MAX_FRASE_TAMPA = 45;
  const MAX_FRASE_DENTRO = 35;

  function contarFotosAnexadas() {
    let n = 0;
    for (let i = 1; i <= NUM_FOTOS_PREVIEW; i++) {
      if (document.getElementById(`foto${i}`).files[0]) n += 1;
    }
    return n;
  }

  function validar() {
    clearFieldErrors();
    const erros = [];
    const tipo = getTipoSelecionado();
    if (!tipo) {
      erros.push("Selecione o tipo de produto.");
      return erros;
    }

    const fraseTampa = document.getElementById("fraseTampa").value.trim();
    if (fraseTampa.length < 2) {
      erros.push("Informe a frase para a frente da caixa.");
      markError("fraseTampa");
    } else if (fraseTampa.length > MAX_FRASE_TAMPA) {
      erros.push(`A frase da frente da caixa pode ter no máximo ${MAX_FRASE_TAMPA} caracteres.`);
      markError("fraseTampa");
    }

    const tipoExtra = tipoExtraTampa ? tipoExtraTampa.value : "nenhum";
    if (tipoExtra === "data-especial") {
      const dataEsp = document.getElementById("dataEspecial").value;
      if (!dataEsp) {
        erros.push("Selecione a data especial.");
        markError("dataEspecial");
      }
    }
    if (tipoExtra === "texto-curto") {
      const curto = document.getElementById("textoCurtoTampa").value.trim();
      if (!curto) {
        erros.push("Informe o texto curto (até 7 caracteres).");
        markError("textoCurtoTampa");
      } else if (curto.length > 7) {
        erros.push("O texto curto pode ter no máximo 7 caracteres.");
        markError("textoCurtoTampa");
      }
    }

    const fraseDentro = document.getElementById("fraseDentro").value.trim();
    if (fraseDentro.length < 2) {
      erros.push("Informe a frase para dentro da caixa.");
      markError("fraseDentro");
    } else if (fraseDentro.length > MAX_FRASE_DENTRO) {
      erros.push(`A frase de dentro da caixa pode ter no máximo ${MAX_FRASE_DENTRO} caracteres.`);
      markError("fraseDentro");
    }

    const fotos = [1, 2, 3].map((i) => document.getElementById(`foto${i}`).files[0]);
    fotos.forEach((f, i) => {
      if (f && f.size < MIN_FOTO_BYTES) {
        erros.push(`A foto ${i + 1} parece muito pequena; prefira arquivo HD ou original.`);
        markError(`foto${i + 1}`);
      }
    });

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

  function textoTipo(tipo) {
    if (tipo === "completa") return "Caixa Love COMPLETA (chocolate, palha e LED)";
    if (tipo === "sem-chocolate-palha-led") return "Caixa Love SEM chocolate e com palha e LED";
    return "Caixa Love SEM chocolate e SEM palha e LED";
  }

  function textoResumoExtra() {
    const tipo = tipoExtraTampa ? tipoExtraTampa.value : "nenhum";
    if (tipo === "nenhum") return "Nenhum destaque extra";
    if (tipo === "data-especial") {
      const d = document.getElementById("dataEspecial").value;
      return d ? `Data especial: ${formatDateBR(d)}` : "—";
    }
    if (tipo === "eu-te-amo") return 'Frase fixa: "Eu te amo"';
    if (tipo === "texto-curto") {
      const t = document.getElementById("textoCurtoTampa").value.trim();
      return t ? `Texto curto: "${t}"` : "—";
    }
    return "—";
  }

  function montarTextoWhatsappPedido() {
    const tipo = getTipoSelecionado();
    const cepFmt = formatCep(document.getElementById("cep").value);
    const nomesFotos = [1, 2, 3]
      .map((i) => {
        const f = document.getElementById(`foto${i}`).files[0];
        return f ? f.name : null;
      })
      .filter(Boolean)
      .join(", ");
    const nFotos = contarFotosAnexadas();
    let t = "*Delicatto Personalizados — novo pedido*\n\n";
    t += `Produto: ${textoTipo(tipo)}\n`;
    t += "Pagamento: confirmado\n";
    t += `Frase frente da caixa: ${document.getElementById("fraseTampa").value.trim()}\n`;
    t += `Destaque extra (frente): ${textoResumoExtra()}\n`;
    t += `Frase dentro da caixa: ${document.getElementById("fraseDentro").value.trim()}\n`;
    t +=
      nFotos === 0
        ? "Fotos: nenhuma anexada (opcional).\n"
        : `Fotos enviadas (nomes): ${nomesFotos}\n`;
    t += "\n*Endereço*\n";
    t += `Rua: ${document.getElementById("rua").value.trim()}\n`;
    t += `Número: ${document.getElementById("numero").value.trim()}\n`;
    t += `Bairro: ${document.getElementById("bairro").value.trim()}\n`;
    t += `Cidade: ${document.getElementById("cidade").value.trim()} — ${document.getElementById("uf").value.trim().toUpperCase()}\n`;
    t += `CEP: ${cepFmt}\n`;
    t += `Referência: ${document.getElementById("referencia").value.trim() || "—"}\n`;
    t += "\n*Cliente*\n";
    t += `Nome: ${document.getElementById("nomeCompleto").value.trim()}\n`;
    t += `CPF: ${formatCpf(document.getElementById("cpf").value)}\n`;
    return t;
  }

  /**
   * Celular/tablet: api.whatsapp.com + compartilhamento com fotos quando disponível.
   * Desktop (Windows, macOS, Linux): web.whatsapp.com — sem menu nativo de compartilhar (no macOS o share
   * com arquivos não lista WhatsApp; por isso não usamos navigator.share com fotos no desktop).
   */
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
    const base = isMobileDispositivo()
      ? "https://api.whatsapp.com/send"
      : "https://web.whatsapp.com/send";
    let url = `${base}?phone=${phone}&text=${encoded}`;
    if (url.length > 8000) {
      url = `${base}?phone=${phone}`;
    }
    return url;
  }

  /**
   * Mobile: mesma aba (evita bloqueio de pop-up). Desktop: nova aba com WhatsApp Web.
   */
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
    for (let i = 1; i <= NUM_FOTOS_PREVIEW; i++) {
      const f = document.getElementById(`foto${i}`).files[0];
      if (f) out.push(f);
    }
    return out.length ? out : null;
  }

  function finalizarPedidoAposEnvio() {
    resumoAberto = false;
    panelResumo.classList.add("hidden");
    form.reset();
    limparTodasPreviewsFotos(NUM_FOTOS_PREVIEW);
    ultimoCepPreenchidoViaApi = "";
    atualizarExtraTampa();
    atualizarVisibilidadeProduto();
    ultimoTextoWhatsapp = "";
    ultimoFotosShare = null;
  }

  /**
   * 1) Só em celular/tablet: compartilhamento nativo com texto + 3 fotos (WhatsApp aparece no menu).
   * 2) No desktop: sempre link direto (web.whatsapp.com ou api) — texto pré-preenchido; fotos anexar na conversa.
   */
  async function enviarPedidoWhatsappAgora() {
    const texto = ultimoTextoWhatsapp;
    const files = ultimoFotosShare;
    if (!texto) {
      showToast("Erro ao montar o pedido.", true);
      return "cancelado";
    }

    const mobile = isMobileDispositivo();
    const temAlgumaFoto = files && files.length > 0;
    const temShare = typeof navigator !== "undefined" && navigator.share;
    let podeCompartilharComFotos = mobile && temAlgumaFoto && temShare;
    if (podeCompartilharComFotos && navigator.canShare) {
      try {
        podeCompartilharComFotos = navigator.canShare({ files });
      } catch (_e) {
        podeCompartilharComFotos = false;
      }
    }

    if (podeCompartilharComFotos) {
      try {
        const n = files.length;
        await navigator.share({
          title: `Delicatto — texto do pedido + ${n} imagem(ns)`,
          text: texto,
          files,
        });
        return "ok-fotos";
      } catch (err) {
        if (err && err.name === "AbortError") return "cancelado";
        showToast("Abrindo só o texto no WhatsApp; anexe as fotos na conversa se desejar.", true);
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
    const tipo = getTipoSelecionado();
    const fd = new FormData(form);
    const cepFmt = formatCep(fd.get("cep"));
    const nomeArquivos = [1, 2, 3].map((i) => {
      const f = document.getElementById(`foto${i}`).files[0];
      return f ? f.name : "—";
    });
    const fotosResumo = nomeArquivos.every((n) => n === "—")
      ? "Nenhuma (opcional)"
      : nomeArquivos.join(" · ");

    const rows = [
      ["Produto", textoTipo(tipo)],
      ["Pagamento", "Confirmado ✅"],
      ["Frase — frente da caixa", fd.get("fraseTampa")],
      ["Destaque extra na frente da caixa", textoResumoExtra()],
      ["Frase — dentro da caixa", fd.get("fraseDentro")],
      ["Fotos (nomes dos arquivos)", fotosResumo],
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
      const nFotosEnvio = ultimoFotosShare ? ultimoFotosShare.length : 0;
      finalizarPedidoAposEnvio();
      if (resultado === "ok-fotos") {
        showToast(
          nFotosEnvio > 0
            ? `No próximo passo, escolha o WhatsApp e o contato da loja (+55 21 99672-8473). O texto e ${nFotosEnvio} imagem(ns) vão juntos no envio.`
            : "No próximo passo, escolha o WhatsApp e o contato da loja (+55 21 99672-8473)."
        );
      } else if (isMobileDispositivo()) {
        showToast(
          nFotosEnvio > 0
            ? "WhatsApp aberto com o texto — anexe mais fotos na conversa se ainda não enviou todas."
            : "WhatsApp aberto com o texto do pedido."
        );
      } else {
        showToast(
          nFotosEnvio > 0
            ? "Abrimos o WhatsApp Web com o texto do pedido. Anexe as fotos na conversa (arrastar ou botão de clipe)."
            : "Abrimos o WhatsApp Web com o texto do pedido."
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

  wireFotoPreviewListeners(NUM_FOTOS_PREVIEW);
