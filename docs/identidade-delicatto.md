# Delicatto Personalizados — Identidade visual e projeto

Documento de referência para designers, parceiros e desenvolvimento (repo `delicatto-formularios`).

---

## Nome e marca

| Item | Valor |
|------|--------|
| **Nome comercial** | **Delicatto Personalizados** (dois “t” em *Delicatto*) |
| **Domínio** | `https://delicattopersonalizados.com.br/` |
| **Tagline** (ex.: rastreio) | *Presentes personalizados com carinho* |
| **Pacote npm** | `delicatto-formularios` |

---

## Logo

| Campo | Detalhe |
|-------|---------|
| **Ficheiro** | `logo-delicatto.png` (PNG) |
| **Localização no projeto** | `public/formulariocaixalove/assets/` (e cópias em pastas de outros formulários) |
| **Texto alternativo** | `Delicatto Personalizados` |
| **Classe CSS** | `brand-logo` |
| **Nota** | A página de rastreio pode referenciar `/formulariocaixalove/assets/logo-delicatto.png` para reutilizar o mesmo ficheiro. |

---

## Paleta de cores (`:root`)

Valores usados em formulários e em `public/rastreios/styles.css`.

| Token | Valor | Uso |
|-------|--------|-----|
| `--bg` | `#fdf2f2` | Fundo geral (rosa/bege claro) |
| `--bg-elevated` | `#ffffff` | Cartões e superfícies elevadas |
| `--ink` | `#7a5c43` | Texto principal (castanho) |
| `--ink-muted` | `rgba(122, 92, 67, 0.72)` | Texto secundário |
| `--border` | `rgba(122, 92, 67, 0.22)` | Bordas |
| `--accent-soft` | `rgba(122, 92, 67, 0.08)` | Destaques suaves |
| `--shadow` | `0 18px 48px rgba(122, 92, 67, 0.08)` | Sombra de cartões |
| `--ok` | `#2d6a4f` | Sucesso / estados positivos (verde) |
| `--ok-soft` | `rgba(45, 106, 79, 0.12)` | Fundos verdes suaves |
| `--warn` | `#b45309` | Avisos |
| `--err` | `#9b2c2c` | Erros / alertas |

### Raios

- `--radius`: `16px`
- `--radius-sm`: `12px`

---

## Tipografia (Google Fonts)

| Função | Família |
|--------|---------|
| Títulos / destaque | **Cormorant Garamond** |
| Tagline / assinatura | **Great Vibes** |
| Corpo e UI | **Source Sans 3** |

---

## Visão geral técnica do repositório

- **Backend:** Node.js + Express (`server.js`) — APIs de pedido, IA, ficheiros estáticos em `public/`.
- **Formulários por produto:** `formulariocaixalove`, `formulariocaixaexplosiva`, `formulariocaixacoracao`, `formularioDoProduto` — HTML/CSS/JS com a mesma base visual.
- **Rastreio:** `public/rastreios/` (e subpasta `tracking/`), consumo da API configurada via meta `delicatto-api-base`.
- **Admin rastreio:** `public/rastreios/admin/`.
- **Domínio rastreio / Melhor Envio:** `src/rastreio/` (Prisma quando aplicável).
- **Deploy estático (GitHub Pages):** `npm run sync-pages` — espelha `public/` na estrutura publicada na raiz do site.

---

## API / infra (referência)

- Backend de exemplo em produção: `https://formulariodelicatto.onrender.com` (configurável por meta ou env).

---

*Última atualização alinhada ao código em `public/*/styles.css` e `public/rastreios/styles.css`.*
