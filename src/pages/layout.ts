/** Estrutura e estilos comuns às páginas do painel (admin e parceiro). */
export const layout = (title: string, body: string, script: string) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
:root {
  --bg: #f3f7f3; --surface: #ffffff; --border: #dfe8df; --text: #1d2a21; --muted: #5d6e62;
  --primary: #2e8b57; --primary-soft: #e3f2e8; --danger: #c0392b; --gold: #b7862b;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1612; --surface: #17211b; --border: #26352b; --text: #e7efe9; --muted: #9db0a3;
    --primary: #5cc58a; --primary-soft: #1d3326; --danger: #ef6b5b; --gold: #e0b45a;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 28px 0 12px; }
p.muted, .muted { color: var(--muted); }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.spacer { flex: 1; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; }
.card .value { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.card .label { font-size: 12px; color: var(--muted); }
.card.highlight { border-color: var(--primary); background: var(--primary-soft); }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: 10px 12px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--border); }
th:first-child, td:first-child { text-align: left; }
th { font-size: 12px; font-weight: 600; color: var(--muted); }
tr:last-child td { border-bottom: 0; }
tfoot td { font-weight: 700; }
button, .button {
  font: inherit; font-weight: 600; border-radius: 10px; border: 1px solid var(--border); background: var(--surface);
  color: var(--text); padding: 8px 14px; cursor: pointer;
}
button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
button.small { padding: 4px 10px; font-size: 13px; }
button.link { border: 0; background: none; color: var(--primary); padding: 4px 6px; }
button:disabled { opacity: .5; cursor: default; }
input, select {
  font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 8px 10px; width: 100%;
}
label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: var(--primary-soft); color: var(--primary); }
.badge.off { background: transparent; border: 1px solid var(--border); color: var(--muted); }
.code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; letter-spacing: .5px; }
.error { color: var(--danger); }
dialog { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); color: var(--text); padding: 20px; width: min(560px, calc(100vw - 32px)); }
dialog::backdrop { background: rgb(0 0 0 / .45); }
dialog h3 { margin: 0 0 8px; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 10px 16px; border-radius: 10px; opacity: 0; transition: opacity .2s; pointer-events: none; }
.toast.show { opacity: 1; }
.linkbox { display: flex; gap: 8px; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; margin-top: 12px; }
.linkbox span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 520px) { .grid2 { grid-template-columns: 1fr; } h1 { font-size: 21px; } }
</style>
</head>
<body>
<main>${body}</main>
<div class="toast" id="toast"></div>
<script>
const brl = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (n) => Number(n || 0).toLocaleString("pt-BR");
const pct = (r) => Math.round(r * 1000) / 10 + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const monthName = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }); };
function toast(message) { const t = document.getElementById("toast"); t.textContent = message; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); }
async function copy(text, message) { try { await navigator.clipboard.writeText(text); toast(message || "Copiado"); } catch { prompt("Copie:", text); } }
function periodOptions(select, current) {
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    options.push('<option value="' + ym + '">' + monthName(ym) + "</option>");
  }
  options.push('<option value="all">Desde o início</option>');
  select.innerHTML = options.join("");
  if (current) select.value = current;
}
${script}
</script>
</body>
</html>`;
