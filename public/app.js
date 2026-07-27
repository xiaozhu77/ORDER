let sortBy = "count";
let selectedUtmId = "";
let selectedDate = "";
let latestData = null;
let latestAdData = null;
let draggedMetricId = "";
let adCapturePaused = false;
let stores = [];
let selectedStoreKey = localStorage.getItem("orderDashboard.selectedStore") || "";

const metricOrderStorageKey = "orderDashboard.metricOrder";
const adDataStorageKey = "orderDashboard.latestAdData";

const fallbackCurrency = {
  sourceSymbol: "£",
  targetSymbol: "$",
  rate: 1.336,
  rateLabel: "1 GBP = 1.336 USD"
};

const elements = {
  subtitle: document.querySelector("#subtitle"),
  health: document.querySelector("#health"),
  storeSwitcher: document.querySelector("#storeSwitcher"),
  adCaptureToggle: document.querySelector("#adCaptureToggle"),
  metrics: document.querySelector(".metrics"),
  totalOrders: document.querySelector("#totalOrders"),
  totalAmount: document.querySelector("#totalAmount"),
  totalUsd: document.querySelector("#totalUsd"),
  last60Orders: document.querySelector("#last60Orders"),
  last60Amount: document.querySelector("#last60Amount"),
  recognizedOrders: document.querySelector("#recognizedOrders"),
  profitCny: document.querySelector("#profitCny"),
  profitInfo: document.querySelector("#profitInfo"),
  adTotalSpend: document.querySelector("#adTotalSpend"),
  adSpendInfo: document.querySelector("#adSpendInfo"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  dateSwitcher: document.querySelector("#dateSwitcher"),
  continuingInfo: document.querySelector("#continuingInfo"),
  continuingRows: document.querySelector("#continuingRows"),
  chartInfo: document.querySelector("#chartInfo"),
  orderChart: document.querySelector("#orderChart"),
  summaryRows: document.querySelector("#summaryRows"),
  scrapeInfo: document.querySelector("#scrapeInfo"),
  sortCount: document.querySelector("#sortCount"),
  sortAmount: document.querySelector("#sortAmount")
};

elements.sortCount.addEventListener("click", () => setSort("count"));
elements.sortAmount.addEventListener("click", () => setSort("amount"));
elements.dateSwitcher.addEventListener("click", handleDateClick);
elements.adCaptureToggle.addEventListener("click", toggleAdCapture);
elements.storeSwitcher?.addEventListener("change", handleStoreChange);
initMetricSorting();

init();
setInterval(refresh, 10000);

async function init() {
  await loadStores();
  latestAdData = readStoredAdData();
  refresh();
}

function setSort(nextSortBy) {
  sortBy = nextSortBy;
  elements.sortCount.classList.toggle("active", sortBy === "count");
  elements.sortAmount.classList.toggle("active", sortBy === "amount");
  refresh();
}

async function loadStores() {
  stores = await fetchOptionalJson("/api/stores") || [];
  if (!stores.length) {
    stores = [{
      key: "default",
      name: "店铺",
      summaryUrl: "/data/summary.json",
      adSummaryUrl: "/data/ad-summary.json"
    }];
  }

  if (!selectedStoreKey || !stores.some((store) => store.key === selectedStoreKey)) {
    selectedStoreKey = stores[0].key;
  }

  renderStoreSwitcher();
}

function renderStoreSwitcher() {
  if (!elements.storeSwitcher) return;
  elements.storeSwitcher.innerHTML = stores.map((store) => (
    `<option value="${escapeAttr(store.key)}">${escapeHtml(store.name || store.key)}</option>`
  )).join("");
  elements.storeSwitcher.value = selectedStoreKey;
}

function handleStoreChange(event) {
  selectedStoreKey = event.target.value;
  localStorage.setItem("orderDashboard.selectedStore", selectedStoreKey);
  selectedDate = "";
  selectedUtmId = "";
  latestData = null;
  latestAdData = readStoredAdData();
  refresh();
}

function activeStore() {
  return stores.find((store) => store.key === selectedStoreKey) ?? stores[0] ?? {
    key: "default",
    name: "店铺",
    summaryUrl: "/data/summary.json",
    adSummaryUrl: "/data/ad-summary.json"
  };
}

function initMetricSorting() {
  applySavedMetricOrder();

  metricCards().forEach((card) => {
    card.addEventListener("dragstart", handleMetricDragStart);
    card.addEventListener("dragover", handleMetricDragOver);
    card.addEventListener("dragleave", handleMetricDragLeave);
    card.addEventListener("drop", handleMetricDrop);
    card.addEventListener("dragend", handleMetricDragEnd);
  });
}

function applySavedMetricOrder() {
  const savedOrder = readMetricOrder();
  if (!savedOrder.length) return;

  const cardsById = new Map(metricCards().map((card) => [card.dataset.metricId, card]));
  const orderedCards = [
    ...savedOrder.map((id) => cardsById.get(id)).filter(Boolean),
    ...metricCards().filter((card) => !savedOrder.includes(card.dataset.metricId))
  ];

  for (const card of orderedCards) {
    elements.metrics.appendChild(card);
  }
}

function handleMetricDragStart(event) {
  const card = event.currentTarget;
  draggedMetricId = card.dataset.metricId || "";
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedMetricId);
}

function handleMetricDragOver(event) {
  event.preventDefault();
  const target = event.currentTarget;
  if (target.dataset.metricId === draggedMetricId) return;
  target.classList.add("dropTarget");
  event.dataTransfer.dropEffect = "move";
}

function handleMetricDragLeave(event) {
  event.currentTarget.classList.remove("dropTarget");
}

function handleMetricDrop(event) {
  event.preventDefault();
  const target = event.currentTarget;
  const sourceId = event.dataTransfer.getData("text/plain") || draggedMetricId;
  const source = metricCards().find((card) => card.dataset.metricId === sourceId);
  target.classList.remove("dropTarget");

  if (!source || source === target) return;

  const rect = target.getBoundingClientRect();
  const placeAfter = event.clientY > rect.top + rect.height / 2 || event.clientX > rect.left + rect.width / 2;
  elements.metrics.insertBefore(source, placeAfter ? target.nextSibling : target);
  saveMetricOrder();
}

function handleMetricDragEnd() {
  draggedMetricId = "";
  metricCards().forEach((card) => {
    card.classList.remove("dragging", "dropTarget");
  });
}

function metricCards() {
  return Array.from(elements.metrics.querySelectorAll("[data-metric-id]"));
}

function readMetricOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(metricOrderStorageKey) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveMetricOrder() {
  localStorage.setItem(metricOrderStorageKey, JSON.stringify(metricCards().map((card) => card.dataset.metricId)));
}

function readStoredAdData() {
  try {
    const value = JSON.parse(localStorage.getItem(storeAdDataStorageKey()) || "null");
    return value?.status === "ok" ? value : null;
  } catch {
    return null;
  }
}

function saveStoredAdData(adData) {
  try {
    localStorage.setItem(storeAdDataStorageKey(), JSON.stringify(adData));
  } catch {
    // In-memory data still covers the current page when browser storage is unavailable.
  }
}

function storeAdDataStorageKey() {
  return `${adDataStorageKey}.${selectedStoreKey || "default"}`;
}

async function refresh() {
  try {
    const timestamp = Date.now();
    const store = activeStore();
    const summaryUrl = store.summaryUrl || "/data/summary.json";
    const summaryResponse = await fetch(`${summaryUrl}?t=${timestamp}`);
    const data = await summaryResponse.json();
    const targetDate = selectedDate && data.dailySummaries?.[selectedDate]
      ? selectedDate
      : data.selectedDate || data.storeDate || data.availableDates?.[0] || "";
    const adSummaryUrl = adSummaryUrlForDate(store.adSummaryUrl || "/data/ad-summary.json", targetDate, data.selectedDate || data.storeDate);
    const adData = await fetchOptionalJson(`${adSummaryUrl}?t=${timestamp}`);
    const control = await fetchOptionalJson(`/api/ad-capture-control?store=${encodeURIComponent(store.key)}&t=${timestamp}`);
    renderAdCaptureControl(control);
    render(data, adData);
  } catch (error) {
    setHealth(false, `读取失败：${error.message}`);
  }
}

function adSummaryUrlForDate(baseUrl, targetDate, currentDate) {
  if (!targetDate || targetDate === currentDate) return baseUrl;
  const dotIndex = baseUrl.lastIndexOf(".");
  if (dotIndex < 0) return `${baseUrl}-${targetDate}`;
  return `${baseUrl.slice(0, dotIndex)}-${targetDate}${baseUrl.slice(dotIndex)}`;
}

async function toggleAdCapture() {
  const paused = !adCapturePaused;
  elements.adCaptureToggle.disabled = true;
  try {
    const response = await fetch(`/api/ad-capture-control?store=${encodeURIComponent(activeStore().key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paused,
        reason: paused ? "用户正在手动调整广告" : ""
      })
    });
    renderAdCaptureControl(await response.json());
  } catch (error) {
    elements.adCaptureToggle.textContent = `切换失败：${error.message}`;
  } finally {
    elements.adCaptureToggle.disabled = false;
  }
}

function renderAdCaptureControl(control) {
  adCapturePaused = Boolean(control?.paused);
  elements.adCaptureToggle.classList.toggle("paused", adCapturePaused);
  elements.adCaptureToggle.textContent = adCapturePaused ? "抓取" : "暂停广告抓取";
  elements.adCaptureToggle.title = adCapturePaused
    ? `广告抓取已暂停：${control?.reason || "正在手动调整广告"}`
    : "恢复状态下，广告抓取跟随后台订单抓取频率";
}

async function fetchOptionalJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function render(data, adData = latestAdData) {
  latestData = data;
  if (adData?.status === "ok") {
    latestAdData = adData;
    saveStoredAdData(adData);
  }

  if (!selectedDate || !(data.dailySummaries?.[selectedDate])) {
    selectedDate = data.selectedDate || data.storeDate || data.availableDates?.[0] || "";
  }
  const displayAdData = latestAdData;
  const activeSummary = data.dailySummaries?.[selectedDate] ?? data;
  const isCurrentDate = selectedDate === (data.selectedDate || data.storeDate);
  const totals = activeSummary.totals ?? {};
  const health = data.health ?? {};
  const last60 = isCurrentDate ? (activeSummary.last60Minutes ?? {}) : emptyLast60();
  const currency = { ...fallbackCurrency, ...(data.currency ?? {}) };
  const store = activeStore();

  elements.subtitle.textContent = `${store.name || store.key} · 店铺端 ${selectedDate || "-"} · 店铺时区 ${data.storeTimezone || "America/Anchorage"} · 更新时间 ${formatTime(data.generatedAt)} · ${currency.rateLabel}`;
  setHealth(Boolean(health.ok), health.message || "等待首次抓取");
  renderDateSwitcher(data.availableDates ?? [], data.selectedDate || data.storeDate);
  elements.totalOrders.textContent = totals.orderCount ?? 0;
  elements.totalAmount.textContent = moneyGbp(totals.totalAmount ?? 0, currency);
  elements.totalUsd.textContent = moneyUsd(totals.totalAmount ?? 0, currency);
  elements.last60Orders.textContent = last60.orderCount ?? 0;
  elements.last60Amount.textContent = `${moneyGbp(last60.totalAmount ?? 0, currency)} / ${moneyUsd(last60.totalAmount ?? 0, currency)}`;
  elements.recognizedOrders.textContent = `${totals.recognizedOrders ?? 0} / ${totals.unrecognizedOrders ?? 0}`;
  renderProfitMetric(totals, currency, displayAdData, selectedDate);
  renderAdMetric(displayAdData, selectedDate);
  elements.scrapeInfo.textContent = scrapeInfo(data, activeSummary, last60, isCurrentDate);
  renderContinuing(activeSummary.continuingGroups ?? [], last60, currency);
  renderOrderChart(data, activeSummary, selectedUtmId);
  const adsByCampaignId = buildAdsByCampaignId(displayAdData, selectedDate);

  const groups = [...(activeSummary.groups ?? [])].sort((a, b) => {
    if (sortBy === "amount") return b.totalAmount - a.totalAmount || b.orderCount - a.orderCount;
    return b.orderCount - a.orderCount || b.totalAmount - a.totalAmount;
  });

  if (!groups.length) {
    elements.summaryRows.innerHTML = '<tr><td colspan="8">暂无数据</td></tr>';
    return;
  }

  elements.summaryRows.innerHTML = groups.map((group, index) => {
    const last60Group = last60.byUtmId?.[group.utmId];
    const adRow = adsByCampaignId.get(group.utmId);
    return `
      <tr>
        <td>
          <div class="utmCell">
            <span class="rank">${String(index + 1).padStart(2, "0")}</span>
            <button class="utmButton ${group.recognized ? "" : "unknown"}" data-utm-id="${escapeAttr(group.utmId)}" type="button">${escapeHtml(group.utmId)}</button>
            ${last60Group ? `<span class="continueBadge">60m ${last60Group.orderCount}单</span>` : ""}
          </div>
        </td>
        <td><strong>${group.orderCount}</strong></td>
        <td>
          <div class="moneyStack">
            <strong>${moneyGbp(group.totalAmount, currency)}</strong>
            <small>${moneyUsd(group.totalAmount, currency)}</small>
          </div>
        </td>
        <td>${renderAdSpend(adRow)}</td>
        <td>${renderAdStatus(adRow)}</td>
        <td>${renderAdCpcCtr(adRow)}</td>
        <td>${escapeHtml(group.latestOrderTime || "-")}</td>
        <td>${renderStatus(group.statusCounts)}</td>
      </tr>
    `;
  }).join("");
  bindUtmButtons(elements.summaryRows);
}

function renderDateSwitcher(dates, currentDate) {
  elements.selectedDateLabel.textContent = selectedDate || "-";
  elements.dateSwitcher.innerHTML = dates.map((date) => {
    const label = date === currentDate ? `${date} 今天` : date;
    return `<button class="${date === selectedDate ? "active" : ""}" data-date="${escapeAttr(date)}" type="button">${escapeHtml(label)}</button>`;
  }).join("");
}

function renderAdMetric(adData, currentDate) {
  if (!isAdDataAvailable(adData, currentDate)) {
    elements.adTotalSpend.textContent = "$0.00";
    elements.adSpendInfo.textContent = "等待广告数据";
    return;
  }

  elements.adTotalSpend.textContent = moneyAd(adData.totalSpend ?? 0);
  const sourceLabel = adData.totalSpendSource === "table-total" ? "页面总计" : "可见行合计";
  elements.adSpendInfo.textContent = `${sourceLabel} · 明细 ${adData.rowsChecked ?? 0} 个系列 · ${formatTime(adData.generatedAt)}`;
}

function renderProfitMetric(totals, currency, adData, currentDate) {
  const orderUsd = Number(totals.totalAmount ?? 0) * Number(currency.rate || 0);
  const adSpendUsd = isAdDataAvailable(adData, currentDate) ? Number(adData.totalSpend ?? 0) : 0;
  const profitCny = (orderUsd * 0.5 - adSpendUsd) * 7;

  elements.profitCny.textContent = moneyCny(profitCny);
  elements.profitInfo.textContent = `(${moneyAd(orderUsd)} × 0.5 - ${moneyAd(adSpendUsd)}) × 7`;
}

function buildAdsByCampaignId(adData, currentDate) {
  if (!isAdDataAvailable(adData, currentDate)) return new Map();
  return new Map((adData.rows ?? [])
    .filter((row) => row.campaignId)
    .map((row) => [String(row.campaignId), row]));
}

function isAdDataAvailable(adData, currentDate) {
  if (!adData || adData.status !== "ok") return false;
  if (adData.storeDate && currentDate && adData.storeDate !== currentDate) return false;
  return Array.isArray(adData.rows);
}

function renderAdSpend(adRow) {
  if (!adRow) return "-";
  return `
    <div class="moneyStack adSpendStack">
      <strong>${moneyAd(adRow.spend ?? 0)}</strong>
      <small>预算 ${adRow.budget ? moneyAd(adRow.budget) : "-"}</small>
    </div>
  `;
}

function renderAdStatus(adRow) {
  if (!adRow) return "-";
  return `<span class="adStatusPill">${escapeHtml(adRow.status || "-")}</span>`;
}

function renderAdCpcCtr(adRow) {
  if (!adRow) return "-";
  return `
    <div class="moneyStack">
      <strong>${moneyAd(adRow.cpc ?? 0)}</strong>
      <small>${formatNumber(adRow.ctr ?? 0)}%</small>
    </div>
  `;
}

function handleDateClick(event) {
  const button = event.target.closest("[data-date]");
  if (!button) return;
  selectedDate = button.dataset.date;
  refresh();
}

function renderContinuing(groups, last60, currency) {
  elements.continuingInfo.textContent = `${groups.length} 个 UTM ID 所选日和前一日都有出单`;

  if (!groups.length) {
    elements.continuingRows.innerHTML = '<div class="emptyState">暂无数据</div>';
    return;
  }

  elements.continuingRows.innerHTML = groups.map((group) => {
    const cumulativeOrders = Number(group.todayOrderCount || 0) + Number(group.yesterdayOrderCount || 0);
    return `
      <article class="continuingCard">
        <div class="continuingHead">
          <button class="utmButton" data-utm-id="${escapeAttr(group.utmId)}" type="button">${escapeHtml(group.utmId)}</button>
          <strong>店铺累计 ${cumulativeOrders}单</strong>
        </div>
        <div class="continuingStats">
          <div>
            <span>所选日</span>
            <strong>${group.todayOrderCount} 单</strong>
            <small>${moneyGbp(group.todayTotalAmount, currency)} / ${moneyUsd(group.todayTotalAmount, currency)}</small>
          </div>
          <div>
            <span>前一日</span>
            <strong>${group.yesterdayOrderCount} 单</strong>
            <small>${moneyGbp(group.yesterdayTotalAmount, currency)} / ${moneyUsd(group.yesterdayTotalAmount, currency)}</small>
          </div>
        </div>
      </article>
    `;
  }).join("");
  bindUtmButtons(elements.continuingRows);
}

function bindUtmButtons(root) {
  root.querySelectorAll("[data-utm-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedUtmId = button.dataset.utmId;
      if (latestData) {
        const activeSummary = latestData.dailySummaries?.[selectedDate] ?? latestData;
        renderOrderChart(latestData, activeSummary, selectedUtmId);
      }
      focusOrderChart();
    });
  });
}

function focusOrderChart() {
  elements.orderChart.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
  elements.orderChart.classList.remove("chartFocus");
  window.setTimeout(() => elements.orderChart.classList.add("chartFocus"), 0);
  window.setTimeout(() => elements.orderChart.classList.remove("chartFocus"), 1400);
}

function renderOrderChart(data, activeSummary, utmId) {
  if (!utmId) {
    elements.chartInfo.textContent = "点击任意 UTM ID 查看所选日期的订单时间序列";
    elements.orderChart.innerHTML = '<div class="emptyState">等待选择 UTM ID</div>';
    return;
  }

  const storeDate = activeSummary.date ?? selectedDate ?? "";
  const orders = (activeSummary.orders ?? []).filter((order) => order.utmId === utmId);
  const points = buildHourlySeries(orders);
  const totalOrders = points.reduce((sum, point) => sum + point.count, 0);
  const peak = points.reduce((best, point) => point.count > best.count ? point : best, points[0]);

  elements.chartInfo.textContent = `${utmId} · 店铺端 ${storeDate || "今天"} · 共 ${totalOrders} 单 · 峰值 ${peak.label} / 北京 ${toBeijingHourLabel(peak.hour)} ${peak.count} 单`;

  if (!orders.length) {
    elements.orderChart.innerHTML = '<div class="emptyState">该 UTM ID 今天暂无订单</div>';
    return;
  }

  elements.orderChart.innerHTML = lineChartSvg(points);
}

function buildHourlySeries(orders) {
  const points = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    beijingLabel: toBeijingHourLabel(hour),
    count: 0
  }));

  for (const order of orders) {
    const hour = Number(String(order.createdAt ?? "").slice(11, 13));
    if (Number.isInteger(hour) && points[hour]) points[hour].count += 1;
  }

  return points;
}

function lineChartSvg(points) {
  const width = 1040;
  const height = 330;
  const padding = { top: 24, right: 24, bottom: 70, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxCount = Math.max(...points.map((point) => point.count), 1);
  const xStep = chartWidth / (points.length - 1);
  const path = points.map((point, index) => {
    const x = padding.left + index * xStep;
    const y = padding.top + chartHeight - (point.count / maxCount) * chartHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const areaPath = `${path} L${padding.left + chartWidth},${padding.top + chartHeight} L${padding.left},${padding.top + chartHeight} Z`;

  return `
    <svg class="orderLineChart" viewBox="0 0 ${width} ${height}" role="img" aria-label="UTM ID 日内订单折线图">
      <defs>
        <linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#50d6ff" stop-opacity="0.28"></stop>
          <stop offset="100%" stop-color="#50d6ff" stop-opacity="0.02"></stop>
        </linearGradient>
      </defs>
      <line class="axis" x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}"></line>
      <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}"></line>
      <path class="lineArea" d="${areaPath}"></path>
      <path class="linePath" d="${path}"></path>
      ${points.map((point, index) => {
        const x = padding.left + index * xStep;
        const y = padding.top + chartHeight - (point.count / maxCount) * chartHeight;
        const labelY = Math.max(14, y - 10);
        return `
          <g>
            <circle class="linePoint" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${point.count ? 4 : 2.5}"></circle>
            ${point.count ? `<text class="pointLabel" x="${x.toFixed(2)}" y="${labelY.toFixed(2)}">${point.count}</text>` : ""}
            ${index % 3 === 0 ? `
              <text class="xLabel" x="${x.toFixed(2)}" y="${height - 34}">店 ${point.label.slice(0, 2)}</text>
              <text class="xLabel beijingLabel" x="${x.toFixed(2)}" y="${height - 14}">京 ${point.beijingLabel.slice(0, 2)}</text>
            ` : ""}
          </g>
        `;
      }).join("")}
      <text class="yLabel" x="6" y="${padding.top + 4}">${maxCount}单</text>
      <text class="yLabel" x="18" y="${padding.top + chartHeight}">0</text>
    </svg>
  `;
}

function toBeijingHourLabel(storeHour) {
  const beijingHour = (Number(storeHour) + 16) % 24;
  return `${String(beijingHour).padStart(2, "0")}:00`;
}

function setHealth(ok, message) {
  elements.health.classList.toggle("ok", ok);
  elements.health.innerHTML = `<span class="healthDot"></span><span>${escapeHtml(message)}</span>`;
}

function scrapeInfo(data, activeSummary, last60, isCurrentDate) {
  const meta = data.scrapeMeta ?? {};
  const pages = Array.isArray(meta.pageLogs) ? meta.pageLogs.length : 0;
  const duration = Number(meta.durationMs ?? 0);
  const modeText = meta.mode === "incremental" ? `增量抓取，新增 ${Number(meta.newOrders ?? 0)} 单` : "全量补数据";
  const windowText = isCurrentDate && last60.startAt && last60.endAt
    ? ` · 店铺时间60分钟窗口 ${last60.startAt.slice(11, 16)}-${last60.endAt.slice(11, 16)}`
    : " · 历史日期不计算实时60分钟";
  if (!pages && !duration) return `每 10 秒刷新前端数据${windowText}`;
  return `${modeText}，抓取 ${pages || "-"} 页，耗时 ${duration ? `${Math.round(duration / 1000)} 秒` : "-"}${windowText}`;
}

function emptyLast60() {
  return {
    orderCount: 0,
    totalAmount: 0,
    byUtmId: {}
  };
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

function moneyAd(value) {
  return `$${formatNumber(value)}`;
}

function moneyCny(value) {
  return `¥${formatNumber(value)}`;
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

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
