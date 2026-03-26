import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
} from "https://esm.sh/docx@9.5.0";

const DOC_IMAGE_MAX_WIDTH = 480;
const DOC_IMAGE_MAX_HEIGHT = 720;

function formatarDataBR(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

async function prepararImagemParaDoc(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "Não foi possível processar uma das imagens para o Word. Use JPEG ou PNG ou tente outro arquivo."
    );
  }
  const { width: iw, height: ih } = bitmap;
  const ratio = Math.min(DOC_IMAGE_MAX_WIDTH / iw, DOC_IMAGE_MAX_HEIGHT / ih, 1);
  const w = Math.round(iw * ratio);
  const h = Math.round(ih * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Não foi possível preparar as imagens.");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG"))), "image/jpeg", 0.93);
  });
  const buf = await blob.arrayBuffer();
  return {
    data: new Uint8Array(buf),
    width: w,
    height: h,
  };
}

async function buildDocxBlob(body, tipoLabel, arquivosFotos) {
  const line = (text, opts = {}) =>
    new Paragraph({
      children: [new TextRun({ text, size: 22, font: "Calibri", ...opts })],
      spacing: { after: 120 },
    });

  const title = (text) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text,
          bold: true,
          size: 28,
          font: "Calibri",
          color: "7A5C43",
        }),
      ],
    });

  const ok = body.pagamentoConfirmado === "true" || body.pagamentoConfirmado === true;
  const children = [
    line("--------------------------------------------------"),
    line(""),
    title("Delicatto Personalizados"),
    line(""),
    line("Caixa Love"),
    line(tipoLabel),
    line(""),
    line(`Pagamento confirmado ${ok ? "✅" : ""}`),
    line(""),
    line("Frase para a frente da caixa:"),
    line(body.fraseTampa || ""),
    line(""),
    line("Personalização extra na frente da caixa:"),
    ...(function extraLinhas() {
      const tipoEx = body.tipoExtraTampa || "nenhum";
      if (tipoEx === "nenhum") {
        return [line("Nenhum destaque extra selecionado.")];
      }
      if (tipoEx === "data-especial") {
        return [line(`Data especial: ${formatarDataBR(body.dataEspecial)}`)];
      }
      if (tipoEx === "eu-te-amo") {
        return [line("Frase fixa: Eu te amo")];
      }
      if (tipoEx === "texto-curto") {
        return [
          line(
            `Texto curto na frente da caixa (máx. 7 caracteres): ${String(body.textoCurtoTampa || "").trim()}`
          ),
        ];
      }
      return [line("—")];
    })(),
    line(""),
    line("Frase para dentro da caixa:"),
    line(body.fraseDentro || ""),
    line(""),
    line("Fotos:"),
    line("As imagens abaixo foram anexadas ao pedido em alta qualidade."),
    line(""),
  ];

  const fotos = arquivosFotos.filter(Boolean);
  for (let i = 0; i < fotos.length; i++) {
    const prepared = await prepararImagemParaDoc(fotos[i]);
    children.push(line(`Foto ${i + 1}:`));
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new ImageRun({
            type: "jpg",
            data: prepared.data,
            transformation: {
              width: prepared.width,
              height: prepared.height,
            },
          }),
        ],
      })
    );
    children.push(line(""));
  }

  children.push(
    line("Endereço:"),
    line(`Rua: ${body.rua || ""}`),
    line(`Número: ${body.numero || ""}`),
    line(`Bairro: ${body.bairro || ""}`),
    line(`CEP: ${body.cep || ""}`),
    line(`Ponto de referência: ${body.referencia || ""}`),
    line(""),
    line("Dados do cliente:"),
    line(`Nome completo: ${body.nomeCompleto || ""}`),
    line(`CPF: ${body.cpf || ""}`),
    line(""),
    line("--------------------------------------------------")
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

/**
 * Gera o .docx no navegador (GitHub Pages, celular, sem servidor Node).
 * @param {object} body — campos do pedido (mesmo formato usado no server.js)
 * @param {string} tipoLabel — rótulo do produto
 * @param {File[]} arquivosFotos — [f1, f2, f3]
 */
export async function gerarDocxPedido(body, tipoLabel, arquivosFotos) {
  const blob = await buildDocxBlob(body, tipoLabel, arquivosFotos);
  const filename = `Pedido-Delicatto-${Date.now()}.docx`;
  return { blob, filename };
}
