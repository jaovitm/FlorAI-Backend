import { layout } from "./layout";

// Sem template literals no script do navegador: ele fica dentro da template string do layout.
const body = `
<section id="app">
  <div class="row">
    <div>
      <h1 id="title">Parceiro FlorAI</h1>
      <p class="muted" style="margin:0" id="subtitle">Carregando…</p>
    </div>
    <div class="spacer"></div>
    <select id="period" style="width:auto"></select>
  </div>
  <div class="linkbox" id="linkbox" hidden>
    <span id="link"></span>
    <button class="small" id="copyLink">Copiar link</button>
  </div>
  <div class="cards" id="cards"></div>
  <h2>Mês a mês</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Mês</th><th>Cliques</th><th>Instalações</th><th>Cadastros</th><th>Pagamentos</th><th>Sua comissão</th></tr></thead>
      <tbody id="months"></tbody>
    </table>
  </div>
  <h2>Como funciona</h2>
  <div class="card" id="rules"></div>
  <p class="error" id="error"></p>
</section>
`;

const script = `
const token = location.pathname.split("/").filter(Boolean).pop();
const period = document.getElementById("period");
periodOptions(period);
period.addEventListener("change", load);
let data = null;
document.getElementById("copyLink").addEventListener("click", () => data && copy(data.link, "Link copiado"));

async function load() {
  try {
    const res = await fetch("/p/" + encodeURIComponent(token) + "/stats?period=" + period.value);
    if (!res.ok) throw new Error(res.status === 404 ? "Painel não encontrado. Confira o link com a equipe do FlorAI." : "Não foi possível carregar.");
    data = await res.json();
    render();
  } catch (err) { document.getElementById("error").textContent = err.message; document.getElementById("subtitle").textContent = ""; }
}

function render() {
  const s = data.stats;
  document.title = data.name + " · FlorAI";
  document.getElementById("title").textContent = "Olá, " + data.name;
  document.getElementById("subtitle").innerHTML = 'Seu cupom: <span class="code">' + esc(data.code) + "</span>" +
    (data.active ? "" : ' <span class="badge off">parceria encerrada</span>');
  document.getElementById("link").textContent = data.link;
  document.getElementById("linkbox").hidden = false;
  const card = (value, label, cls) => '<div class="card ' + (cls || "") + '"><div class="value">' + value + '</div><div class="label">' + label + "</div></div>";
  document.getElementById("cards").innerHTML =
    card(num(s.clicks), "Cliques no link") + card(num(s.installs), "Instalações") + card(num(s.signups), "Cadastros") +
    card(num(s.activated), "Identificaram a 1ª planta") + card(num(s.payingUsers), "Assinaram") +
    card(num(s.activeSubscribers), "Assinantes ativos hoje") + card(brl(s.commissionCents), "Sua comissão no período") +
    card(brl(data.balance.dueCents), "A receber", "highlight");
  document.getElementById("months").innerHTML = data.monthly.map((m) => "<tr><td>" + monthName(m.month) + "</td><td>" + num(m.clicks) +
    "</td><td>" + num(m.installs) + "</td><td>" + num(m.signups) + "</td><td>" + num(m.payments) + "</td><td>" + brl(m.commissionCents) + "</td></tr>").join("");
  document.getElementById("rules").innerHTML =
    "<p style='margin-top:0'>Divulgue seu link ou peça para usarem o cupom <span class='code'>" + esc(data.code) + "</span> no cadastro do app.</p>" +
    (data.bonusDays > 0 ? "<p>Quem entra pelo seu link ou cupom ganha <strong>" + data.bonusDays + " dias de FlorAI Pro</strong> ao identificar a primeira planta.</p>" : "") +
    "<p>Você recebe <strong>" + pct(data.firstRate) + "</strong> do que cada assinante pagar nos " + data.firstMonths +
    " primeiros meses e <strong>" + pct(data.rate) + "</strong> depois disso, enquanto ele continuar assinando.</p>" +
    "<p class='muted' style='margin-bottom:0'>A comissão é calculada sobre o valor líquido (após a taxa do Google Play). Reembolsos são descontados. " +
    "Cliques e instalações são atualizados na hora; downloads de quem nunca abriu o app não aparecem aqui.</p>";
}

load();
`;

export const partnerPage = () => layout("Parceiro · FlorAI", body, script);
