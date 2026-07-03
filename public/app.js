let sortBy = "count";

const elements = {
  subtitle: document.querySelector("#subtitle"),
  health: document.querySelector("#health"),
  totalOrders: document.querySelector("#totalOrders"),
  totalAmount: document.querySelector("#totalAmount"),
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
    elements.health.textContent = `读取失败：${error.message}`;
    elements.health.classList.remove("ok");
  }
}

function render(data) {
  const totals = data.totals ?? {};
  const health = data.health ?? {};
  elements.subtitle.textContent = `${data.date || "店铺端今天"} · 更新时间 ${formatTime(data.generatedAt)}`;
  elements.health.textContent = health.message || "等待首次抓取";
  elements.health.classList.toggle("ok", Boolean(health.ok));
  elements.totalOrders.textContent = totals.orderCount ?? 0;
  elements.totalAmount.textContent = money(totals.totalAmount ?? 0);
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

  elements.summaryRows.innerHTML = groups.map((group) => `
    <tr>
      <td class="${group.recognized ? "" : "unknown"}">${escapeHtml(group.utmId)}</td>
      <td>${group.orderCount}</td>
      <td>${money(group.totalAmount)}</td>
      <td>${escapeHtml(group.latestOrderTime || "-")}</td>
      <td>${renderStatus(group.statusCounts)}</td>
    </tr>
  `).join("");
}

function scrapeInfo(data) {
  const meta = data.scrapeMeta ?? {};
  const pages = Array.isArray(meta.pageLogs) ? meta.pageLogs.length : 0;
  const duration = Number(meta.durationMs ?? 0);
  if (!pages && !duration) return "每 10 秒自动刷新页面数据";
  return `最近抓取 ${pages || "-"} 页，耗时 ${duration ? `${Math.round(duration / 1000)} 秒` : "-"}`;
}

function renderStatus(statusCounts = {}) {
  const entries = Object.entries(statusCounts);
  if (!entries.length) return "-";
  return entries.map(([status, count]) => (
    `<span class="statusPill">${escapeHtml(status)} ${count}</span>`
  )).join("");
}

function money(value) {
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
