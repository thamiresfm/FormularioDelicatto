require("dotenv").config();

const { rastreioSemBanco } = require("./src/rastreio/semBanco");
if (!process.env.DATABASE_URL && !rastreioSemBanco()) {
  process.env.DATABASE_URL = "file:./dev.db";
}

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
} = require("docx");

const DOC_IMAGE_MAX_WIDTH = 480;
const DOC_IMAGE_MAX_HEIGHT = 720;

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const { registrarWebhookMelhorEnvio, registrarRotasRastreio } = require("./src/rastreio/apiRoutes");
const { iniciarPollingMelhorEnvio } = require("./src/rastreio/syncScheduler");

/** Webhook ME precisa de body raw — registrar antes do express.json() global */
registrarWebhookMelhorEnvio(app);

const OpenAI = require("openai");
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${path.extname(file.originalname) || ""}`;
    cb(null, safe);
  },
});

const imageFilter = (_req, file, cb) => {
  const ok = /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype);
  if (!ok) {
    return cb(new Error("Apenas imagens (JPEG, PNG, WebP ou HEIC) são aceitas."));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: imageFilter,
});

function formatarDataBR(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function cpfValido(digits) {
  const s = String(digits).replace(/\D/g, "");
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

async function prepararImagemParaDoc(caminhoArquivo) {
  const buf = fs.readFileSync(caminhoArquivo);
  const { data, info } = await sharp(buf)
    .rotate()
    .resize({
      width: DOC_IMAGE_MAX_WIDTH,
      height: DOC_IMAGE_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 93, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
  };
}

async function buildDocxBuffer(body, tipoLabel, arquivosFotos) {
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
    const prepared = await prepararImagemParaDoc(fotos[i].path);
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
    line(`Cidade / UF: ${body.cidade || ""} — ${body.uf || ""}`),
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

  return Packer.toBuffer(doc);
}

app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    optionsSuccessStatus: 204,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/** Rotas /api/rastreio/* (usa JSON já parseado pelo middleware acima) */
registrarRotasRastreio(app);

app.get("/formularioDoProduto", (_req, res) => {
  res.redirect(301, "/formulariocaixalove/");
});
app.get("/formularioDoProduto/", (_req, res) => {
  res.redirect(301, "/formulariocaixalove/");
});
app.get("/formularioCaixaLove", (_req, res) => {
  res.redirect(301, "/formulariocaixalove/");
});
app.get("/formularioCaixaLove/", (_req, res) => {
  res.redirect(301, "/formulariocaixalove/");
});
app.get("/formulariocaixalove", (_req, res) => {
  res.redirect(301, "/formulariocaixalove/");
});
app.get("/formulariocaixaexplosiva", (_req, res) => {
  res.redirect(301, "/formulariocaixaexplosiva/");
});
app.get("/formulariocaixacoracao", (_req, res) => {
  res.redirect(301, "/formulariocaixacoracao/");
});
app.get("/rastreios", (_req, res) => {
  res.redirect(301, "/rastreios/");
});
app.get("/rastreios/admin", (_req, res) => {
  res.redirect(301, "/rastreios/admin/");
});
app.use(express.static(path.join(__dirname, "public")));

const fieldsUpload = upload.fields([
  { name: "foto1", maxCount: 1 },
  { name: "foto2", maxCount: 1 },
  { name: "foto3", maxCount: 1 },
]);

app.post("/api/pedido", fieldsUpload, async (req, res) => {
  const files = req.files || {};
  const f1 = files.foto1?.[0];
  const f2 = files.foto2?.[0];
  const f3 = files.foto3?.[0];

  const cleanup = () => {
    [f1, f2, f3].forEach((f) => {
      if (f?.path) {
        fs.unlink(f.path, () => {});
      }
    });
  };

  try {
    const {
      tipoProduto,
      fraseTampa,
      fraseDentro,
      tipoExtraTampa,
      dataEspecial,
      textoCurtoTampa,
      rua,
      numero,
      bairro,
      cidade,
      uf,
      cep,
      referencia,
      nomeCompleto,
      cpf,
    } = req.body;

    const errors = [];

    const tiposExtraValidos = ["nenhum", "data-especial", "eu-te-amo", "texto-curto"];
    const tipoExtra = String(tipoExtraTampa || "nenhum").trim();
    if (!tiposExtraValidos.includes(tipoExtra)) {
      errors.push("Opção de personalização extra inválida.");
    }

    if (
      !tipoProduto ||
      !["sem-chocolate", "sem-chocolate-palha-led", "completa"].includes(tipoProduto)
    ) {
      errors.push("Selecione o tipo de produto.");
    }
    const fraseTampaTrim = String(fraseTampa || "").trim();
    if (fraseTampaTrim.length < 2) {
      errors.push("Informe a frase para a frente da caixa.");
    } else if (fraseTampaTrim.length > 45) {
      errors.push("A frase da frente da caixa pode ter no máximo 45 caracteres.");
    }
    if (tipoExtra === "data-especial") {
      const d = String(dataEspecial || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        errors.push("Informe uma data especial válida.");
      }
    }
    if (tipoExtra === "texto-curto") {
      const t = String(textoCurtoTampa || "").trim();
      if (!t || t.length > 7) {
        errors.push("Informe o texto curto com 1 a 7 caracteres.");
      }
    }
    const fraseDentroTrim = String(fraseDentro || "").trim();
    if (fraseDentroTrim.length < 2) {
      errors.push("Informe a frase para dentro da caixa.");
    } else if (fraseDentroTrim.length > 35) {
      errors.push("A frase de dentro da caixa pode ter no máximo 35 caracteres.");
    }
    if (!f1 || !f2 || !f3) {
      errors.push("Envie exatamente 3 fotos em alta qualidade.");
    }
    const MIN_BYTES = 15 * 1024;
    [f1, f2, f3].forEach((f, i) => {
      if (f && f.size < MIN_BYTES) {
        errors.push(`A foto ${i + 1} parece muito pequena; use arquivo original ou HD.`);
      }
    });
    if (!rua || String(rua).trim().length < 2) errors.push("Informe a rua.");
    if (!numero || String(numero).trim().length < 1) errors.push("Informe o número.");
    if (!bairro || String(bairro).trim().length < 2) errors.push("Informe o bairro.");
    if (!cidade || String(cidade).trim().length < 2) errors.push("Informe a cidade.");
    const ufTrim = String(uf || "")
      .trim()
      .replace(/[^a-zA-Z]/g, "")
      .toUpperCase();
    if (ufTrim.length !== 2) errors.push("Informe a UF com 2 letras.");
    const cepDigits = String(cep || "").replace(/\D/g, "");
    if (cepDigits.length !== 8) errors.push("CEP inválido (use 8 dígitos).");
    if (!nomeCompleto || String(nomeCompleto).trim().split(/\s+/).length < 2) {
      errors.push("Informe o nome completo.");
    }
    const cpfDigits = String(cpf || "").replace(/\D/g, "");
    if (!cpfValido(cpfDigits)) {
      errors.push("CPF inválido.");
    }

    if (errors.length) {
      cleanup();
      return res.status(400).json({ ok: false, errors });
    }

    const tipoLabel =
      tipoProduto === "completa"
        ? "Caixa Love COMPLETA (com chocolate, palha e LED)"
        : tipoProduto === "sem-chocolate-palha-led"
          ? "Caixa Love SEM chocolate e com palha e LED"
          : "Caixa Love SEM chocolate e SEM palha e LED";

    let buffer;
    try {
      buffer = await buildDocxBuffer(
        {
          ...req.body,
          pagamentoConfirmado: "true",
          fraseTampa: fraseTampaTrim,
          fraseDentro: fraseDentroTrim,
          cidade: String(cidade).trim(),
          uf: ufTrim,
          cpf: cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"),
          cep: cepDigits.replace(/(\d{5})(\d{3})/, "$1-$2"),
        },
        tipoLabel,
        [f1, f2, f3]
      );
    } catch (imgErr) {
      cleanup();
      console.error(imgErr);
      return res.status(400).json({
        ok: false,
        errors: [
          "Não foi possível processar uma das imagens para o Word. Use JPEG ou PNG ou tente outro arquivo.",
        ],
      });
    }

    cleanup();

    const filename = `Pedido-Delicatto-${Date.now()}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    cleanup();
    console.error(err);
    return res.status(500).json({
      ok: false,
      errors: [err.message || "Erro ao processar o pedido."],
    });
  }
});

/**
 * Opcional: sugestão de frase curta (romântica) usando a API OpenAI.
 * A chave fica só no servidor — nunca no frontend nem no GitHub Pages.
 * Documentação: https://platform.openai.com/docs | SDK: https://github.com/openai/openai-node
 */
app.post("/api/ia/sugestao-frase", async (req, res) => {
  if (!openaiClient) {
    return res.status(503).json({
      ok: false,
      errors: [
        "OPENAI_API_KEY não configurada. Crie .env na raiz (veja .env.example) ou exporte a variável antes de npm start.",
      ],
    });
  }
  const tema = String(req.body?.tema || "").trim().slice(0, 500);
  if (!tema) {
    return res.status(400).json({
      ok: false,
      errors: ['Envie JSON { "tema": "sua ideia em poucas palavras" }.'],
    });
  }
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const completion = await openaiClient.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "Você ajuda a escrever frases curtas e românticas para personalização de presentes em português do Brasil. Responda só com a frase sugerida, sem aspas, até 45 caracteres quando possível.",
        },
        {
          role: "user",
          content: `Sugira uma frase curta para a frente de uma caixa de presente. Ideia: ${tema}`,
        },
      ],
      max_tokens: 120,
    });
    const text = completion.choices[0]?.message?.content?.trim() || "";
    return res.json({ ok: true, sugestao: text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      errors: [e.message || "Erro na API OpenAI."],
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, errors: [err.message] });
  }
  if (err?.message) {
    return res.status(400).json({ ok: false, errors: [err.message] });
  }
  return res.status(500).json({ ok: false, errors: ["Erro interno no servidor."] });
});

app.listen(PORT, () => {
  console.log(`Delicatto — formulário em http://localhost:${PORT}`);
  console.log(`Rastreios: http://localhost:${PORT}/rastreios/`);
  iniciarPollingMelhorEnvio();
  if (openaiClient) {
    console.log("OpenAI: rota opcional POST /api/ia/sugestao-frase ativa.");
  }
});
