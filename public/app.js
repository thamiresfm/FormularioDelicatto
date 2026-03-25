(function () {
  /** Número só dígitos (E.164 BR sem +): atendimento Delicatto */
  const WHATSAPP_LOJA_E164 = "5521996728473";
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
  const btnResumo = document.getElementById("btn-resumo");
  const panelResumo = document.getElementById("panel-resumo");
  const resumoConteudo = document.getElementById("resumo-conteudo");
  const btnVoltar = document.getElementById("btn-voltar");
  const btnEnviar = document.getElementById("btn-enviar");
  const toast = document.getElementById("toast");
  const cepInput = document.getElementById("cep");
  const cpfInput = document.getElementById("cpf");
  const tipoExtraTampa = document.getElementById("tipoExtraTampa");
  const wrapDataEspecial = document.getElementById("wrap-data-especial");
  const wrapEuTeAmo = document.getElementById("wrap-eu-te-amo");
  const wrapTextoCurto = document.getElementById("wrap-texto-curto");
  const waPosPedido = document.getElementById("wa-pos-pedido");
  const btnBaixarDocx = document.getElementById("btn-baixar-docx");
  const btnWaFotos = document.getElementById("btn-wa-fotos");
  const btnWaTexto = document.getElementById("btn-wa-texto");

  let resumoAberto = false;
  let ultimoDocxBlob = null;
  let ultimoDocxNome = "Pedido-Delicatto.docx";
  let ultimoTextoWhatsapp = "";
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
    wrapDataEspecial.classList.toggle("hidden", v !== "data-especial");
    wrapEuTeAmo.classList.toggle("hidden", v !== "eu-te-amo");
    wrapTextoCurto.classList.toggle("hidden", v !== "texto-curto");
  }

  if (tipoExtraTampa) {
    tipoExtraTampa.addEventListener("change", atualizarExtraTampa);
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

  cepInput.addEventListener("input", () => {
    cepInput.value = formatCep(cepInput.value);
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

    const f1 = document.getElementById("foto1").files[0];
    const f2 = document.getElementById("foto2").files[0];
    const f3 = document.getElementById("foto3").files[0];
    if (!f1 || !f2 || !f3) {
      erros.push("Envie as 3 fotos.");
      ["foto1", "foto2", "foto3"].forEach(markError);
    } else {
      [f1, f2, f3].forEach((f, i) => {
        if (f.size < MIN_FOTO_BYTES) {
          erros.push(`A foto ${i + 1} parece muito pequena; prefira arquivo HD ou original.`);
          markError(`foto${i + 1}`);
        }
      });
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
    return "Caixa Love SEM chocolate";
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
    let t = "*Delicatto Personalizados — novo pedido*\n\n";
    t += `Produto: ${textoTipo(tipo)}\n`;
    t += "Pagamento: confirmado\n";
    t += `Frase frente da caixa: ${document.getElementById("fraseTampa").value.trim()}\n`;
    t += `Destaque extra (frente): ${textoResumoExtra()}\n`;
    t += `Frase dentro da caixa: ${document.getElementById("fraseDentro").value.trim()}\n`;
    t += `Fotos enviadas (nomes): ${nomesFotos || "—"}\n`;
    t += "\n*Endereço*\n";
    t += `Rua: ${document.getElementById("rua").value.trim()}\n`;
    t += `Número: ${document.getElementById("numero").value.trim()}\n`;
    t += `Bairro: ${document.getElementById("bairro").value.trim()}\n`;
    t += `CEP: ${cepFmt}\n`;
    t += `Referência: ${document.getElementById("referencia").value.trim() || "—"}\n`;
    t += "\n*Cliente*\n";
    t += `Nome: ${document.getElementById("nomeCompleto").value.trim()}\n`;
    t += `CPF: ${formatCpf(document.getElementById("cpf").value)}\n`;
    return t;
  }

  function abrirUrlWhatsappComTexto(texto) {
    let corpo = texto;
    if (corpo.length > WA_TEXTO_MAX) {
      corpo = `${corpo.slice(0, WA_TEXTO_MAX)}\n…(texto truncado — veja o documento Word)`;
    }
    const url = `https://wa.me/${WHATSAPP_LOJA_E164}?text=${encodeURIComponent(corpo)}`;
    return url.length > 8192 ? `https://wa.me/${WHATSAPP_LOJA_E164}` : url;
  }

  function abrirWhatsappAutomatico(url) {
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

  function atualizarBotaoWhatsappFotos() {
    if (!btnWaFotos) return;
    const files = ultimoFotosShare;
    const pode =
      files &&
      files.length === 3 &&
      files.every(Boolean) &&
      typeof navigator !== "undefined" &&
      navigator.canShare &&
      navigator.canShare({ files });
    btnWaFotos.classList.toggle("hidden", !pode);
  }

  if (btnWaFotos) {
    btnWaFotos.addEventListener("click", async () => {
      if (!ultimoTextoWhatsapp || !ultimoFotosShare || ultimoFotosShare.length !== 3) {
        showToast("Dados do pedido indisponíveis. Envie o formulário novamente.", true);
        return;
      }
      try {
        await navigator.share({
          title: "Pedido Delicatto Personalizados",
          text: ultimoTextoWhatsapp,
          files: ultimoFotosShare,
        });
        showToast("Escolha o WhatsApp e o número da loja para concluir o envio.");
      } catch (err) {
        if (err && err.name === "AbortError") return;
        showToast('Não foi possível compartilhar. Use "WhatsApp: só texto" e anexe as fotos manualmente.', true);
      }
    });
  }

  if (btnWaTexto) {
    btnWaTexto.addEventListener("click", () => {
      if (!ultimoTextoWhatsapp) {
        showToast("Dados do pedido indisponíveis. Envie o formulário novamente.", true);
        return;
      }
      abrirWhatsappAutomatico(abrirUrlWhatsappComTexto(ultimoTextoWhatsapp));
    });
  }

  if (btnBaixarDocx) {
    btnBaixarDocx.addEventListener("click", () => {
      if (!ultimoDocxBlob) {
        showToast("Nenhum documento disponível. Envie o pedido novamente.", true);
        return;
      }
      const url = URL.createObjectURL(ultimoDocxBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ultimoDocxNome;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Download do Word iniciado.");
    });
  }

  function montarResumo() {
    const tipo = getTipoSelecionado();
    const fd = new FormData(form);
    const cepFmt = formatCep(fd.get("cep"));
    const nomeArquivos = [1, 2, 3].map((i) => {
      const f = document.getElementById(`foto${i}`).files[0];
      return f ? f.name : "—";
    });

    const rows = [
      ["Produto", textoTipo(tipo)],
      ["Pagamento", "Confirmado ✅"],
      ["Frase — frente da caixa", fd.get("fraseTampa")],
      ["Destaque extra na frente da caixa", textoResumoExtra()],
      ["Frase — dentro da caixa", fd.get("fraseDentro")],
      ["Fotos (nomes dos arquivos)", nomeArquivos.join(" · ")],
      ["Rua", fd.get("rua")],
      ["Número", fd.get("numero")],
      ["Bairro", fd.get("bairro")],
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
    if (btnWaFotos) btnWaFotos.classList.add("hidden");
    if (waPosPedido) waPosPedido.classList.add("hidden");
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

    const fd = new FormData();
    fd.append("tipoProduto", getTipoSelecionado());
    fd.append("pagamentoConfirmado", "true");
    fd.append("fraseTampa", document.getElementById("fraseTampa").value.trim());
    fd.append("tipoExtraTampa", tipoExtraTampa ? tipoExtraTampa.value : "nenhum");
    fd.append("dataEspecial", document.getElementById("dataEspecial").value || "");
    fd.append("textoCurtoTampa", document.getElementById("textoCurtoTampa").value.trim());
    fd.append("fraseDentro", document.getElementById("fraseDentro").value.trim());
    fd.append("rua", document.getElementById("rua").value.trim());
    fd.append("numero", document.getElementById("numero").value.trim());
    fd.append("bairro", document.getElementById("bairro").value.trim());
    fd.append("cep", onlyDigits(document.getElementById("cep").value));
    fd.append("referencia", document.getElementById("referencia").value.trim());
    fd.append("nomeCompleto", document.getElementById("nomeCompleto").value.trim());
    fd.append("cpf", onlyDigits(document.getElementById("cpf").value));

    const f1 = document.getElementById("foto1").files[0];
    const f2 = document.getElementById("foto2").files[0];
    const f3 = document.getElementById("foto3").files[0];
    fd.append("foto1", f1);
    fd.append("foto2", f2);
    fd.append("foto3", f3);

    btnEnviar.disabled = true;
    try {
      const textoWhatsapp = montarTextoWhatsappPedido();

      const res = await fetch("/api/pedido", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.errors?.[0] || res.statusText || "Falha ao gerar o documento.";
        showToast(msg, true);
        return;
      }

      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition");
      let filename = "Pedido-Delicatto.docx";
      const m = dispo && /filename="([^"]+)"/.exec(dispo);
      if (m) filename = m[1];

      ultimoDocxBlob = blob;
      ultimoDocxNome = filename;

      ultimoTextoWhatsapp = textoWhatsapp;
      ultimoFotosShare = [f1, f2, f3];
      atualizarBotaoWhatsappFotos();

      showToast("Pedido salvo! Use os botões abaixo para enviar ao WhatsApp.");
      if (waPosPedido) {
        waPosPedido.classList.remove("hidden");
        waPosPedido.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      resumoAberto = false;
      panelResumo.classList.add("hidden");
      form.reset();
      atualizarExtraTampa();
      atualizarVisibilidadeProduto();
    } catch (err) {
      showToast("Erro de rede. Tente novamente.", true);
    } finally {
      btnEnviar.disabled = false;
    }
  });
})();
