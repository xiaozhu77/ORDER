const sortBy = "count";
let selectedUtmId = "";
let selectedDate = "";
let latestData = null;
let latestAdData = null;
let draggedMetricId = "";
let adCapturePaused = false;
let stores = [];
let selectedStoreKey = localStorage.getItem("orderDashboard.selectedStore") || "";
const syncedAdCaptureTargetDates = {};
let storeDropdownOpen = false;
let storeDropdownOpenTl = null;
let storeDropdownCloseTl = null;

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
  storeDropdown: document.querySelector("#storeDropdown"),
  storeDropdownTrigger: document.querySelector("#storeDropdownTrigger"),
  storeDropdownLabel: document.querySelector("#storeDropdownLabel"),
  storeDropdownMenu: document.querySelector("#storeDropdownMenu"),
  storeDropdownArrow: document.querySelector(".storeDropdownArrow"),
  adCaptureToggle: document.querySelector("#adCaptureToggle"),
  testAlertSound: document.querySelector("#testAlertSound"),
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
  scrapeInfo: document.querySelector("#scrapeInfo")
};

elements.dateSwitcher.addEventListener("click", handleDateClick);
elements.adCaptureToggle.addEventListener("click", toggleAdCapture);
elements.testAlertSound?.addEventListener("click", testAlertSound);
elements.storeSwitcher?.addEventListener("change", handleStoreChange);
elements.storeDropdownTrigger?.addEventListener("click", toggleStoreDropdown);
document.addEventListener("click", closeStoreDropdownFromOutside);
initMetricSorting();
initMetricTilt();

init();
setInterval(refresh, 10000);

function gsapReady() {
  return window.gsap && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function er(easeName) {
  const gsap = window.gsap;
  const ease = gsap?.parseEase?.(easeName) || ((progress) => progress);
  return (progress) => 1 - ease(1 - progress);
}

function initMetricTilt() {
  const gsap = window.gsap;
  if (!gsapReady() || !elements.metrics) return;

  gsap.set(elements.metrics, { perspective: 650 });
  metricCards().forEach((card) => {
    const inner = card.querySelector(".metricInner");
    if (!inner) return;

    const outerRX = gsap.quickTo(card, "rotationX", { duration: 0.32, ease: "power3" });
    const outerRY = gsap.quickTo(card, "rotationY", { duration: 0.32, ease: "power3" });
    const innerX = gsap.quickTo(inner, "x", { duration: 0.32, ease: "power3" });
    const innerY = gsap.quickTo(inner, "y", { duration: 0.32, ease: "power3" });

    card.addEventListener("pointermove", (event) => {
      if (draggedMetricId) return;
      const rect = card.getBoundingClientRect();
      const xProgress = (event.clientX - rect.left) / rect.width;
      const yProgress = (event.clientY - rect.top) / rect.height;
      outerRX(gsap.utils.interpolate(7, -7, yProgress));
      outerRY(gsap.utils.interpolate(-7, 7, xProgress));
      innerX(gsap.utils.interpolate(-10, 10, xProgress));
      innerY(gsap.utils.interpolate(-8, 8, yProgress));
    });

    card.addEventListener("pointerleave", () => {
      outerRX(0);
      outerRY(0);
      innerX(0);
      innerY(0);
    });
  });
}

async function init() {
  await loadStores();
  latestAdData = readStoredAdData();
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
  renderStoreDropdown();
}

function renderStoreDropdown() {
  if (!elements.storeDropdownMenu || !elements.storeDropdownLabel) return;
  const active = activeStore();
  elements.storeDropdownLabel.textContent = active.name || active.key || "店铺";
  elements.storeDropdownTrigger?.setAttribute("aria-expanded", "false");
  elements.storeDropdownMenu.innerHTML = stores.map((store) => (
    `<button class="storeDropdownItem ${store.key === selectedStoreKey ? "active" : ""}" data-store-key="${escapeAttr(store.key)}" type="button">${escapeHtml(store.name || store.key)}</button>`
  )).join("");
  elements.storeDropdownMenu.querySelectorAll("[data-store-key]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectStore(button.dataset.storeKey);
    });
  });
  initStoreDropdownTimeline();
}

function initStoreDropdownTimeline() {
  if (!elements.storeDropdownMenu || !elements.storeDropdownArrow) return;
  const gsap = window.gsap;
  storeDropdownOpenTl?.kill();
  storeDropdownCloseTl?.kill();
  storeDropdownOpenTl = null;
  storeDropdownCloseTl = null;
  storeDropdownOpen = false;
  elements.storeDropdownMenu.classList.remove("open");

  if (!gsapReady()) return;
  document.body.classList.add("gsap-enhanced");
  gsap.set(elements.storeDropdownMenu, { autoAlpha: 0, yPercent: -24, scale: 0.72 });
  gsap.set(elements.storeDropdownArrow, { rotation: 0, transformOrigin: "50% 50%" });
  gsap.set(".storeDropdownItem", { opacity: 1, x: 0 });

  storeDropdownOpenTl = gsap.timeline({ paused: true })
    .to(elements.storeDropdownArrow, {
      rotation: 180,
      duration: 0.9,
      ease: "elastic.out(1.2, 0.3)"
    }, 0)
    .to(elements.storeDropdownMenu, {
      autoAlpha: 1,
      yPercent: 0,
      scale: 1,
      duration: 1,
      ease: "elastic.out(1.2, 0.3)"
    }, 0)
    .from(elements.storeDropdownMenu.querySelectorAll(".storeDropdownItem"), {
      opacity: 0,
      x: -20,
      duration: 0.5,
      ease: "back.out(3)",
      stagger: 0.07
    }, 0.1);

  storeDropdownCloseTl = gsap.timeline({
    paused: true,
    onComplete: () => elements.storeDropdownMenu.classList.remove("open")
  })
    .to(elements.storeDropdownMenu.querySelectorAll(".storeDropdownItem"), {
      opacity: 0,
      x: -12,
      duration: 0.2,
      ease: er("power2.out"),
      stagger: { each: 0.035, from: "end" }
    }, 0)
    .to(elements.storeDropdownArrow, {
      rotation: 0,
      duration: 0.38,
      ease: er("power2.inOut")
    }, 0)
    .to(elements.storeDropdownMenu, {
      autoAlpha: 0,
      yPercent: -24,
      scale: 0.72,
      duration: 0.36,
      ease: er("power3.out")
    }, 0.04);
}

function toggleStoreDropdown(event) {
  event.stopPropagation();
  if (storeDropdownOpen) {
    closeStoreDropdown();
  } else {
    openStoreDropdown();
  }
}

function openStoreDropdown() {
  if (!elements.storeDropdownMenu) return;
  storeDropdownOpen = true;
  elements.storeDropdownMenu.classList.add("open");
  elements.storeDropdownTrigger?.setAttribute("aria-expanded", "true");
  if (!storeDropdownOpenTl) return;
  storeDropdownCloseTl?.pause(0);
  storeDropdownOpenTl.timeScale(1).restart();
}

function closeStoreDropdown() {
  if (!storeDropdownOpen) return;
  storeDropdownOpen = false;
  elements.storeDropdownTrigger?.setAttribute("aria-expanded", "false");
  if (!storeDropdownCloseTl) {
    elements.storeDropdownMenu?.classList.remove("open");
    return;
  }
  storeDropdownOpenTl?.pause(0);
  storeDropdownCloseTl.timeScale(1).restart();
}

function closeStoreDropdownFromOutside(event) {
  if (!storeDropdownOpen) return;
  if (elements.storeDropdown?.contains(event.target)) return;
  closeStoreDropdown();
}

function selectStore(storeKey) {
  if (!storeKey || storeKey === selectedStoreKey) {
    closeStoreDropdown();
    return;
  }
  if (elements.storeSwitcher) {
    elements.storeSwitcher.value = storeKey;
  }
  handleStoreChange({ target: { value: storeKey } });
  closeStoreDropdown();
}

function handleStoreChange(event) {
  const previousStoreKey = selectedStoreKey;
  clearAdCaptureTargetDate(previousStoreKey);
  selectedStoreKey = event.target.value;
  localStorage.setItem("orderDashboard.selectedStore", selectedStoreKey);
  selectedDate = "";
  selectedUtmId = "";
  latestData = null;
  latestAdData = readStoredAdData();
  renderStoreDropdown();
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
    const control = await response.json();
    const payload = {
      paused,
      reason: control.reason || "",
      refreshRequestedAt: paused ? "" : new Date().toISOString()
    };
    await Promise.all(stores.map((store) => (
      fetch(`/api/ad-capture-control?store=${encodeURIComponent(store.key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      })
    )));
    renderAdCaptureControl({ ...control, ...payload });
  } catch (error) {
    elements.adCaptureToggle.textContent = `切换失败：${error.message}`;
  } finally {
    elements.adCaptureToggle.disabled = false;
  }
}

async function testAlertSound() {
  if (!elements.testAlertSound) return;
  elements.testAlertSound.disabled = true;
  elements.testAlertSound.textContent = "播放中...";
  try {
    const response = await fetch(`/api/test-alert-sound?store=${encodeURIComponent(activeStore().key)}`, {
      method: "POST"
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "QQ 提示音播放失败");
    }
    elements.testAlertSound.textContent = "已播放";
    window.setTimeout(() => {
      elements.testAlertSound.textContent = "测试提示音";
      elements.testAlertSound.disabled = false;
    }, 900);
  } catch (error) {
    elements.testAlertSound.textContent = `播放失败：${error.message}`;
    window.setTimeout(() => {
      elements.testAlertSound.textContent = "测试提示音";
      elements.testAlertSound.disabled = false;
    }, 1600);
  }
}

async function syncAdCaptureTargetDate(targetDate) {
  const store = activeStore();
  if (!store?.key || !targetDate) return;
  if (adCapturePaused) return;
  if (syncedAdCaptureTargetDates[store.key] === targetDate) return;
  syncedAdCaptureTargetDates[store.key] = targetDate;

  try {
    await fetch(`/api/ad-capture-control?store=${encodeURIComponent(store.key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetDate, refreshRequestedAt: new Date().toISOString() })
    });
  } catch {
    delete syncedAdCaptureTargetDates[store.key];
  }
}

async function clearAdCaptureTargetDate(storeKey) {
  if (!storeKey) return;
  delete syncedAdCaptureTargetDates[storeKey];

  try {
    await fetch(`/api/ad-capture-control?store=${encodeURIComponent(storeKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetDate: "" })
    });
  } catch {
    // The next active-store sync will repair the control file.
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
  syncAdCaptureTargetDate(selectedDate);
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
    const orderRoi = calculateOrderRoi(group, adRow);
    const roiLevel = getRoiLevel(orderRoi);
    return `
      <tr class="${roiLevel ? `${roiLevel}RoiRow` : ""}">
        <td>
          <div class="utmCell">
            <span class="rank">${String(index + 1).padStart(2, "0")}</span>
            <button class="utmButton ${group.recognized ? "" : "unknown"}" data-utm-id="${escapeAttr(group.utmId)}" type="button">${escapeHtml(group.utmId)}</button>
            ${last60Group ? `<span class="continueBadge">60m ${last60Group.orderCount}单</span>` : ""}
          </div>
        </td>
        <td><strong>${group.orderCount}</strong></td>
        <td>
          ${renderOrderAmountWithRoi(group, currency, orderRoi)}
        </td>
        <td>${renderAdSpend(adRow)}</td>
        <td>${renderAdStatus(adRow)}</td>
        <td>${renderAdCpcCtr(adRow)}</td>
        <td>${renderOrderTime(group.latestOrderTime, data.storeTimezone)}</td>
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

function calculateOrderRoi(group, adRow) {
  const orderAmountGbp = Number(group?.totalAmount ?? 0);
  const adSpend = Number(adRow?.spend ?? 0);
  if (!Number.isFinite(orderAmountGbp) || !Number.isFinite(adSpend) || adSpend <= 0) return null;
  return orderAmountGbp / adSpend;
}

function renderOrderAmountWithRoi(group, currency, orderRoi) {
  const roiLabel = orderRoi === null ? "ROI -" : `ROI ${formatNumber(orderRoi, 2)}`;
  const roiLevel = getRoiLevel(orderRoi);
  return `
    <div class="moneyStack orderAmountStack ${roiLevel ? `${roiLevel}RoiAmount` : ""}">
      <strong>${moneyGbp(group.totalAmount, currency)}</strong>
      <small>${moneyUsd(group.totalAmount, currency)} · ${escapeHtml(roiLabel)}</small>
    </div>
  `;
}

function getRoiLevel(orderRoi) {
  if (orderRoi === null) return "";
  if (orderRoi < 2) return "low";
  if (orderRoi < 2.2) return "warning";
  return "";
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
  const status = adRow?.status || "无数据";
  const statusLevel = classifyAdStatus(status);
  return `<span class="adStatusPill ${escapeAttr(statusLevel)}" title="${escapeAttr(status)}" aria-label="${escapeAttr(status)}"><span class="adStatusDot"></span></span>`;
}

function classifyAdStatus(status) {
  const value = String(status || "").toLowerCase();
  if (/(投放中|进行中|active|running|enabled|\bon\b)/i.test(value)) return "statusActive";
  return "statusIdle";
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
  syncAdCaptureTargetDate(selectedDate);
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

  elements.chartInfo.textContent = `${utmId} · 店铺端 ${storeDate || "今天"} · 共 ${totalOrders} 单 · 峰值 ${peak.label} / 本地 ${toLocalHourLabel(peak.hour, storeDate, latestData?.storeTimezone)} ${peak.count} 单`;

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
    localLabel: toLocalHourLabel(hour, selectedDate, latestData?.storeTimezone),
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
              <text class="xLabel localLabel" x="${x.toFixed(2)}" y="${height - 14}">本 ${point.localLabel.slice(0, 2)}</text>
            ` : ""}
          </g>
        `;
      }).join("")}
      <text class="yLabel" x="6" y="${padding.top + 4}">${maxCount}单</text>
      <text class="yLabel" x="18" y="${padding.top + chartHeight}">0</text>
    </svg>
  `;
}

function renderOrderTime(storeDateTime, storeTimezone) {
  if (!storeDateTime) return "-";
  const local = storeDateTimeToLocalDate(storeDateTime, storeTimezone);
  if (!local) return escapeHtml(storeDateTime);
  return `
    <div class="moneyStack orderTimeStack">
      <strong>${escapeHtml(formatLocalDateTime(local))}</strong>
      <small>店铺 ${escapeHtml(storeDateTime)}</small>
    </div>
  `;
}

function toLocalHourLabel(storeHour, storeDate, storeTimezone) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(storeDate ?? "")) ? storeDate : selectedDate;
  const storeDateTime = `${date} ${String(storeHour).padStart(2, "0")}:00:00`;
  const local = storeDateTimeToLocalDate(storeDateTime, storeTimezone);
  if (!local) return `${String(storeHour).padStart(2, "0")}:00`;
  return `${String(local.getHours()).padStart(2, "0")}:00`;
}

function storeDateTimeToLocalDate(storeDateTime, storeTimezone = "America/Anchorage") {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(storeDateTime ?? "").trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second = "00"] = match;
  const utcGuess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const offsetMs = timezoneOffsetMs(new Date(utcGuess), storeTimezone);
  return new Date(utcGuess - offsetMs);
}

function timezoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
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
