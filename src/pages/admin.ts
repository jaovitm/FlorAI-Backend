import { layout } from "./layout";

// Sem template literals no script do navegador: ele fica dentro da template string do layout.
const body = `
<section id="login" hidden>
  <h1>Afiliados FlorAI</h1>
  <p class="muted">Informe a senha do painel (secret <span class="code">ADMIN_TOKEN</span> do backend).</p>
  <form id="loginForm" class="row" style="max-width:420px">
    <input id="token" type="password" autocomplete="current-password" placeholder="Senha do painel" required>
    <button class="primary">Entrar</button>
  </form>
  <p id="loginError" class="error"></p>
</section>

<section id="app" hidden>
  <div class="row">
    <div>
      <h1>Afiliados FlorAI</h1>
      <p class="muted" style="margin:0">Influenciadores, downloads, assinaturas e comissões.</p>
    </div>
    <div class="spacer"></div>
    <select id="period" style="width:auto"></select>
    <button class="primary" id="newButton">Novo parceiro</button>
    <button class="link" id="logout">Sair</button>
  </div>
  <div class="cards" id="totals"></div>
  <h2>Parceiros</h2>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Parceiro</th><th>Cliques</th><th>Instalações</th><th>Cadastros</th><th>1ª identificação</th>
        <th>Pagamentos</th><th>Assinantes ativos</th><th>Receita líquida</th><th>Comissão no período</th><th>A pagar</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <p class="muted" style="font-size:13px">
    Cliques: aberturas do link curto. Instalações: aparelhos que abriram o app vindos do link
    (downloads que nunca abriram o app aparecem só no Play Console, por <span class="code">utm_source</span>).
    Cadastros: contas criadas com o cupom ou link. Receita líquida: preço do plano menos a taxa de 15% do Google.
    A pagar: comissão acumulada menos os pagamentos registrados.
  </p>
</section>

<dialog id="editDialog">
  <form id="editForm" method="dialog">
    <h3 id="editTitle">Novo parceiro</h3>
    <div class="grid2">
      <div><label>Nome</label><input name="name" required maxlength="80"></div>
      <div><label>Cupom (link e código)</label><input name="code" required maxlength="20" pattern="[A-Za-z0-9]{3,20}" placeholder="MARINA"></div>
    </div>
    <label>Contato (Instagram, e-mail, PIX…)</label><input name="contact" maxlength="200">
    <div class="grid2">
      <div><label>Comissão nos primeiros meses (%)</label><input name="firstRate" type="number" min="0" max="100" step="0.5" value="20"></div>
      <div><label>Quantos primeiros meses</label><input name="firstMonths" type="number" min="0" max="36" value="3"></div>
      <div><label>Comissão depois (%)</label><input name="rate" type="number" min="0" max="100" step="0.5" value="10"></div>
      <div><label>Dias de Pro para o seguidor</label><input name="bonusDays" type="number" min="0" max="90" value="7"></div>
    </div>
    <p class="muted" style="font-size:13px">Os meses contam a partir do 1º pagamento de cada assinante. Mudanças valem para pagamentos futuros.</p>
    <p id="editError" class="error"></p>
    <div class="actions">
      <button type="button" data-close>Cancelar</button>
      <button class="primary" value="save">Salvar</button>
    </div>
  </form>
</dialog>

<dialog id="payDialog">
  <form id="payForm" method="dialog">
    <h3>Registrar pagamento</h3>
    <p class="muted" id="payInfo"></p>
    <label>Valor pago (R$)</label><input name="amount" type="number" min="0.01" step="0.01" required>
    <label>Observação</label><input name="note" maxlength="200" placeholder="PIX 15/11">
    <p id="payError" class="error"></p>
    <div class="actions">
      <button type="button" data-close>Cancelar</button>
      <button class="primary" value="save">Registrar</button>
    </div>
  </form>
</dialog>

<dialog id="detailDialog" style="width:min(760px, calc(100vw - 32px))">
  <h3 id="detailTitle"></h3>
  <div id="detailBody"></div>
  <div class="actions"><button type="button" data-close>Fechar</button></div>
</dialog>
`;

const script = `
const TOKEN_KEY = "florai.adminToken";
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch {}
let items = [];
let editing = null;
let paying = null;

async function api(path, options) {
  const res = await fetch("/admin/api/" + path, Object.assign({}, options, {
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
  }));
  if (res.status === 401) { showLogin("Senha incorreta ou expirada."); throw new Error("401"); }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || "Erro " + res.status);
  return data;
}

function showLogin(message) {
  document.getElementById("app").hidden = true;
  document.getElementById("login").hidden = false;
  document.getElementById("loginError").textContent = message || "";
}

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  token = document.getElementById("token").value.trim();
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  start();
});
document.getElementById("logout").addEventListener("click", () => {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  token = null; showLogin();
});
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

const period = document.getElementById("period");
periodOptions(period);
period.addEventListener("change", load);

async function start() {
  if (!token) return showLogin();
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;
  await load();
}

async function load() {
  const data = await api("affiliates?period=" + period.value);
  items = data.items;
  render();
}

function render() {
  const t = { clicks: 0, installs: 0, signups: 0, activated: 0, payments: 0, activeSubscribers: 0, netCents: 0, commissionCents: 0, dueCents: 0 };
  for (const a of items) {
    for (const k of Object.keys(t)) t[k] += k === "dueCents" ? a.balance.dueCents : a.stats[k];
  }
  const card = (value, label, cls) => '<div class="card ' + (cls || "") + '"><div class="value">' + value + '</div><div class="label">' + label + "</div></div>";
  document.getElementById("totals").innerHTML =
    card(num(t.clicks), "Cliques") + card(num(t.installs), "Instalações") + card(num(t.signups), "Cadastros") +
    card(num(t.activeSubscribers), "Assinantes ativos") + card(brl(t.netCents), "Receita líquida no período") +
    card(brl(t.commissionCents), "Comissão no período") + card(brl(t.dueCents), "Total a pagar", "highlight");

  const rows = items.map((a, i) => {
    const s = a.stats;
    return "<tr>" +
      "<td><strong>" + esc(a.name) + '</strong> <span class="badge' + (a.active ? "" : " off") + '">' + (a.active ? "ativo" : "inativo") + "</span>" +
      '<div class="muted" style="font-size:12px"><span class="code">' + esc(a.code) + "</span> · " + pct(a.firstRate) + " por " + a.firstMonths + " meses, depois " + pct(a.rate) + "</div>" +
      '<div style="margin-left:-6px"><button class="link small" data-act="link" data-i="' + i + '">Copiar link</button>' +
      '<button class="link small" data-act="partner" data-i="' + i + '">Painel do parceiro</button>' +
      '<button class="link small" data-act="detail" data-i="' + i + '">Detalhes</button>' +
      '<button class="link small" data-act="pay" data-i="' + i + '">Pagar</button></div></td>' +
      "<td>" + num(s.clicks) + "</td><td>" + num(s.installs) + "</td><td>" + num(s.signups) + "</td><td>" + num(s.activated) + "</td>" +
      "<td>" + num(s.payments) + (s.testPayments ? ' <span class="muted" title="Compras de teste (fora dos totais)">+' + s.testPayments + " teste</span>" : "") + "</td>" +
      "<td>" + num(s.activeSubscribers) + "</td><td>" + brl(s.netCents) + "</td><td>" + brl(s.commissionCents) + "</td>" +
      "<td><strong>" + brl(a.balance.dueCents) + "</strong></td>" +
      "</tr>";
  });
  document.getElementById("rows").innerHTML = rows.join("") ||
    '<tr><td colspan="10" class="muted">Nenhum parceiro ainda. Clique em "Novo parceiro".</td></tr>';
}

document.getElementById("rows").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const a = items[Number(b.dataset.i)];
  if (b.dataset.act === "link") copy(a.link, "Link de " + a.name + " copiado");
  if (b.dataset.act === "partner") copy(a.partnerUrl, "Link do painel copiado. Envie só para " + a.name + ".");
  if (b.dataset.act === "detail") openDetail(a);
  if (b.dataset.act === "pay") openPay(a);
});

document.getElementById("newButton").addEventListener("click", () => openEdit(null));

function openEdit(a) {
  editing = a;
  const f = document.getElementById("editForm");
  f.reset();
  document.getElementById("editTitle").textContent = a ? "Editar " + a.name : "Novo parceiro";
  document.getElementById("editError").textContent = "";
  if (a) {
    f.name.value = a.name; f.code.value = a.code; f.contact.value = a.contact || "";
    f.firstRate.value = a.firstRate * 100; f.firstMonths.value = a.firstMonths; f.rate.value = a.rate * 100; f.bonusDays.value = a.bonusDays;
  }
  document.getElementById("editDialog").showModal();
}

document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.name.value, code: f.code.value, contact: f.contact.value || null,
    firstRate: Number(f.firstRate.value) / 100, firstMonths: Number(f.firstMonths.value),
    rate: Number(f.rate.value) / 100, bonusDays: Number(f.bonusDays.value),
  };
  try {
    if (editing) await api("affiliates/" + editing.id, { method: "PATCH", body: JSON.stringify(body) });
    else await api("affiliates", { method: "POST", body: JSON.stringify(body) });
    document.getElementById("editDialog").close();
    toast(editing ? "Parceiro atualizado" : "Parceiro criado. Copie o link e envie para ele.");
    await load();
  } catch (err) { document.getElementById("editError").textContent = err.message; }
});

function openPay(a) {
  paying = a;
  const f = document.getElementById("payForm");
  f.reset();
  document.getElementById("payError").textContent = "";
  document.getElementById("payInfo").textContent = a.name + " · a pagar: " + brl(a.balance.dueCents);
  if (a.balance.dueCents > 0) f.amount.value = (a.balance.dueCents / 100).toFixed(2);
  document.getElementById("payDialog").showModal();
}

document.getElementById("payForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api("affiliates/" + paying.id + "/payouts", {
      method: "POST",
      body: JSON.stringify({ amountCents: Math.round(Number(f.amount.value) * 100), note: f.note.value }),
    });
    document.getElementById("payDialog").close();
    toast("Pagamento registrado");
    await load();
  } catch (err) { document.getElementById("payError").textContent = err.message; }
});

async function openDetail(a) {
  document.getElementById("detailTitle").textContent = a.name + " (" + a.code + ")";
  const box = document.getElementById("detailBody");
  box.innerHTML = '<p class="muted">Carregando…</p>';
  document.getElementById("detailDialog").showModal();
  try {
    const d = await api("affiliates/" + a.id);
    const months = d.monthly.map((m) => "<tr><td>" + monthName(m.month) + "</td><td>" + num(m.clicks) + "</td><td>" + num(m.installs) +
      "</td><td>" + num(m.signups) + "</td><td>" + num(m.payments) + "</td><td>" + brl(m.netCents) + "</td><td>" + brl(m.commissionCents) + "</td></tr>").join("");
    const payouts = d.payouts.map((p) => "<tr><td>" + new Date(p.paidAt).toLocaleDateString("pt-BR") + "</td><td>" + esc(p.note || "") +
      "</td><td>" + brl(p.amountCents) + "</td></tr>").join("") || '<tr><td colspan="3" class="muted">Nenhum pagamento registrado.</td></tr>';
    box.innerHTML =
      '<p class="muted" style="margin-top:0">' + esc(a.contact || "Sem contato") + "</p>" +
      '<div class="linkbox"><span>' + esc(a.link) + '</span><button class="small" id="dCopy">Copiar link</button></div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="small" id="dEdit">Editar</button>' +
      '<button class="small" id="dToggle">' + (a.active ? "Desativar" : "Reativar") + "</button>" +
      '<span class="muted" style="font-size:12px">Desativado, o link leva ao app sem atribuir e o cupom deixa de valer. Quem já veio continua gerando comissão.</span></div>' +
      "<h2>Mês a mês</h2><div class=\\"table-wrap\\"><table><thead><tr><th>Mês</th><th>Cliques</th><th>Instalações</th><th>Cadastros</th><th>Pagamentos</th><th>Receita líquida</th><th>Comissão</th></tr></thead><tbody>" + months + "</tbody></table></div>" +
      "<h2>Pagamentos ao parceiro</h2><div class=\\"table-wrap\\"><table><thead><tr><th>Data</th><th>Observação</th><th>Valor</th></tr></thead><tbody>" + payouts + "</tbody></table></div>";
    document.getElementById("dCopy").onclick = () => copy(a.link, "Link copiado");
    document.getElementById("dEdit").onclick = () => { document.getElementById("detailDialog").close(); openEdit(a); };
    document.getElementById("dToggle").onclick = async () => {
      await api("affiliates/" + a.id, { method: "PATCH", body: JSON.stringify({ active: !a.active }) });
      document.getElementById("detailDialog").close();
      toast(a.active ? "Parceiro desativado" : "Parceiro reativado");
      await load();
    };
  } catch (err) { box.innerHTML = '<p class="error">' + esc(err.message) + "</p>"; }
}

start().catch(() => {});
`;

export const adminPage = () => layout("Afiliados · FlorAI", body, script);
