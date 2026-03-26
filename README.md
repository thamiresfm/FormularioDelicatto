# Formulário Delicatto (Caixa Love)

> **Importante:** versões antigas deste README falavam em pasta `/docs`, `npm run sync-docs`, servidor **Render** e `window.DELICATO_API_URL`. **Isso não vale mais.** O Word é gerado **no navegador**; **não** é necessário backend nem variável de API.

## O que o projeto faz hoje

- O arquivo **`.docx`** é montado **no próprio celular/navegador** (`gerar-docx.js` + biblioteca [docx](https://www.npmjs.com/package/docx) via CDN).
- **GitHub Pages** só precisa servir HTML/CSS/JS na **raiz** do repositório.
- **Não** configure `DELICATO_API_URL` nem hospede API em Render só por causa deste formulário.

## Rodar local

```bash
npm install
npm start
```

Abra `http://localhost:3000`. O `server.js` serve a pasta `public/`; o fluxo de geração do Word é o mesmo do site publicado.

## GitHub Pages (raiz `/`, não `/docs`)

No GitHub: **Settings → Pages → Branch: `main`, Folder: `/ (root)`**.

1. Edite os arquivos em **`public/`** (fonte principal).
2. Copie para a raiz do repositório antes do commit:

   ```bash
   npm run sync-pages
   ```

3. Faça commit e push de: `index.html`, `app.js`, `styles.css`, `gerar-docx.js`, pasta `assets/`, arquivo `.nojekyll` na raiz.

Assim o site no ar fica igual ao que você testou em `public/`.

## “Erro de rede” ou falha ao gerar o Word

| Causa comum | O que fazer |
|-------------|-------------|
| README ou `index.html` **antigos** no GitHub (ainda com API/Render) | Faça `git pull`, rode `npm run sync-pages`, commit na **raiz** e push. |
| Sem internet na **primeira** visita | Precisa carregar o pacote `docx` (CDN). Depois o cache ajuda. |
| Foto HEIC / arquivo que o navegador não lê | Use **JPEG** ou **PNG**. |
| Site aberto só dentro do Instagram | Abra no **Safari** ou **Chrome**. |

## Fotos e HTTPS

- Prefira **JPEG** ou **PNG**.
- O site no GitHub Pages deve ser **HTTPS** (padrão). Não é necessário servidor HTTP separado para o formulário.

## Primeira visita

É preciso **internet** uma vez para baixar o módulo `docx` (esm.sh); em seguida o navegador pode usar cache.
