let sortBy = "count";

const fallbackCurrency = {
  sourceSymbol: "£",
  targetSymbol: "$",
  rate: 1.336,
  rateLabel: "1 GBP = 1.336 USD"
};

const elements = {
  subtitle: document.querySelector("#subtitle"),
  health: document.querySelector("#health"),
  totalOrders: document.querySelector("#totalOrders"),
  totalAmount: document.querySelector("#totalAmount"),
  totalUsd: document.querySelector("#totalUsd"),
  recognizedOrders: document.querySelector("#recognizedOrders"),
  recognitionRate: document.querySelector("#recognitionRate"),
  summaryRows: document.querySelector("#summaryRows"),
  scrapeInfo: document.querySelector("#scrapeInfo"),
  sortCount: document.querySelector("#sortCount"),
  sortAmount: document.querySelector("#sortAmount")
};

elements.sortCount.addEventListener("click", () => setSort("count"));
elements.sortAmount.addEventListener("click", () => setSort("amount"));

refresh();
setInterval(refresh, 10000);

function setSort(nextSortBy) {
  sortBy = nextSortBy;
  elements.sortCount.classList.toggle("active", sortBy === "count");
  elements.sortAmount.classList.toggle("active", sortBy === "amount");
  refresh();
}

async function refresh() {
  try {
    const response = await fetch(`/data/summary.json?t=${Date.now()}`);
    const data = await response.json();
    render(data);
  } catch (error) {
    setHealth(false, `读取失败：${error.message}`);
  }
}

function render(data) {
  const totals = data.totals ?? {};
  const health = data.health ?? {};
  const currency = { ...fallbackCurrency, ...(data.currency ?? {}) };

  elements.subtitle.textContent = `${data.date || "店铺端今天"} · 更新时间 ${formatTime(data.generatedAt)} · ${currency.rateLabel}`;
  setHealth(Boolean(health.ok), health.message || "等待首次抓取");
  elements.totalOrders.textContent = totals.orderCount ?? 0;
  elements.totalAmount.textContent = moneyGbp(totals.totalAmount ?? 0, currency);
  elements.totalUsd.textContent = moneyUsd(totals.totalAmount ?? 0, currency);
  elements.recognizedOrders.textContent = `${totals.recognizedOrders ?? 0} / ${totals.unrecognizedOrders ?? 0}`;
  elements.recognitionRate.textContent = `${Math.round((totals.recognitionRate ?? 0) * 10000) / 100}%`;
  elements.scrapeInfo.textContent = scrapeInfo(data);

  const groups = [...(data.groups ?? [])].sort((a, b) => {
    if (sortBy === "amount") return b.totalAmount - a.totalAmount || b.orderCount - a.orderCount;
    return b.orderCount - a.orderCount || b.totalAmount - a.totalAmount;
  });

  if (!groups.length) {
    elements.summaryRows.innerHTML = '<tr><td colspan="5">暂无数据</td></tr>';
    return;
  }

  elements.summaryRows.innerHTML = groups.map((group, index) => `
    <tr>
      <td>
        <div class="utmCell">
          <span class="rank">${String(index + 1).padStart(2, "0")}</span>
          <span class="${group.recognized ? "" : "unknown"}">${escapeHtml(group.utmId)}</span>
        </div>
      </td>
      <td><strong>${group.orderCount}</strong></td>
      <td>
        <div class="moneyStack">
          <strong>${moneyGbp(group.totalAmount, currency)}</strong>
          <small>${moneyUsd(group.totalAmount, currency)}</small>
        </div>
      </td>
      <td>${escapeHtml(group.latestOrderTime || "-")}</td>
      <td>${renderStatus(group.statusCounts)}</td>
    </tr>
  `).join("");
}

function setHealth(ok, message) {
  elements.health.classList.toggle("ok", ok);
  elements.health.innerHTML = `<span class="healthDot"></span><span>${escapeHtml(message)}</span>`;
}

function scrapeInfo(data) {
  const meta = data.scrapeMeta ?? {};
  const pages = Array.isArray(meta.pageLogs) ? meta.pageLogs.length : 0;
  const duration = Number(meta.durationMs ?? 0);
  if (!pages && !duration) return "每 10 秒刷新前端数据";
  return `最近抓取 ${pages || "-"} 页，耗时 ${duration ? `${Math.round(duration / 1000)} 秒` : "-"}`;
}

function renderStatus(statusCounts = {}) {
  const entries = Object.entries(statusCounts);
  if (!entries.length) return "-";
  return entries.map(([status, count]) => (
    `<span class="statusPill">${escapeHtml(status)} ${count}</span>`
  )).join("");
}

function moneyGbp(value, currency) {
  return `${currency.sourceSymbol}${formatNumber(value)}`;
}

function moneyUsd(value, currency) {
  return `${currency.targetSymbol}${formatNumber(Number(value) * Number(currency.rate || 0))}`;
}

function formatNumber(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
