import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadConfig } from "./config.js";
import { readJson, writeJson } from "./file-store.js";

const DEFAULT_LOG_PATH = path.join(process.env.APPDATA ?? "", "adspower_global", "cwd_global", "log");
const DEFAULT_OUTPUT_PATH = "public/data/ad-summary.json";
const DEBUGGER_URL_PATTERN = /webSocketDebuggerUrl-\s+(ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/g;
let captureQueue = Promise.resolve();

export async function runAdSpendMonitor(options = {}) {
  const config = await loadConfig(options.configPath);
  const summaryPath = path.resolve(options.summaryPath ?? config.scraper.dashboardDataPath);
  const storeSummary = await readStoreSummaryMetadata(summaryPath);

  return captureAdsPowerAdData({
    logDirPath: options.logDirPath ?? DEFAULT_LOG_PATH,
    outputPath: options.outputPath,
    refresh: options.refresh !== false,
    adAccountId: options.adAccountId ?? config.scraper.adCapture.adAccountId,
    ctid: options.ctid ?? config.scraper.adCapture.ctid,
    campaignPageUrl: options.campaignPageUrl ?? config.scraper.adCapture.campaignPageUrl,
    storeDate: options.storeDate ?? storeSummary.storeDate,
    orderSummaryGeneratedAt: storeSummary.generatedAt
  });
}

export async function captureAdsPowerAdData(options = {}) {
  const run = captureQueue.then(() => captureAdsPowerAdDataOnce(options));
  captureQueue = run.catch(() => {});
  return run;
}

async function captureAdsPowerAdDataOnce(options = {}) {
  const logDirPath = path.resolve(options.logDirPath ?? DEFAULT_LOG_PATH);
  const debuggerEndpoint = await getLatestDebuggerEndpoint(logDirPath);

  let result;
  if (!debuggerEndpoint) {
    result = buildResult({
      status: "skip",
      storeDate: options.storeDate,
      orderSummaryGeneratedAt: options.orderSummaryGeneratedAt,
      reason: "未找到 AdsPower 当前浏览器调试地址"
    });
  } else {
    const browserResult = await readAdsPowerCampaignRows(debuggerEndpoint, {
      refresh: options.refresh !== false,
      adAccountId: options.adAccountId,
      ctid: options.ctid,
      campaignPageUrl: options.campaignPageUrl,
      openMissingPage: options.openMissingPage,
      storeDate: options.storeDate,
      connectTimeoutMs: options.connectTimeoutMs,
      readTimeoutMs: options.readTimeoutMs
    });

    if (!browserResult.ok || !browserResult.rows?.length) {
      result = buildResult({
        status: "skip",
        storeDate: options.storeDate,
        orderSummaryGeneratedAt: options.orderSummaryGeneratedAt,
        debuggerEndpoint,
        reason: browserResult.reason || "广告页面暂未加载到推广系列，保留上一次有效数据"
      });
    } else {
      result = buildResult({
        status: "ok",
        storeDate: browserResult.adDate || options.storeDate,
        orderSummaryGeneratedAt: options.orderSummaryGeneratedAt,
        debuggerEndpoint,
        adPageUrl: browserResult.adPageUrl,
        rows: browserResult.rows,
        totalSpend: browserResult.totalSpend,
        totalSpendSource: browserResult.totalSpendSource
      });
    }
  }

  if (options.outputPath && result.status === "ok") {
    await writeJson(options.outputPath, result);
  }

  return result;
}

export function normalizeCampaignRow(row) {
  const normalized = {
    campaignId: normalizeText(row?.campaign_id) || normalizeText(row?.campaignId) || normalizeText(row?.__rowId),
    campaignName: normalizeText(row?.campaign_name),
    status: normalizeStatus(row?.campaign_status),
    spend: normalizeAmount(row?.stat_cost),
    cpc: normalizeAmount(row?.cpc),
    ctr: normalizePercent(row?.ctr),
    raw: {}
  };

  for (const [key, value] of Object.entries(row ?? {})) {
    normalized.raw[key] = normalizeText(value);
  }

  const optionalAmountFields = {
    budget: ["budget", "daily_budget", "campaign_budget"],
    addBilling: ["add_billing", "billing", "addBilling", "time_attr_add_billing_count"],
    conversions: ["conversion", "conversions", "total_conversion", "time_attr_convert_cnt"],
    roas: ["roas", "time_attr_shopping_roas"],
    conversionCost: ["conversion_cost", "cost_per_conversion", "time_attr_conversion_cost"],
    cpm: ["cpm"],
    frequency: ["frequency"]
  };

  for (const [target, sourceKeys] of Object.entries(optionalAmountFields)) {
    const value = firstValue(row, sourceKeys);
    if (value !== "") {
      normalized[target] = target === "roas" || target === "frequency"
        ? normalizeNumber(value)
        : normalizeAmount(value);
    }
  }

  return normalized;
}

export function sumSpend(rows) {
  const total = rows.reduce((sum, row) => sum + normalizeAmount(row?.spend), 0);
  return Math.round(total * 100) / 100;
}

export function normalizeAmount(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizePercent(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function extractAdAccountId(url) {
  try {
    return new URL(url).searchParams.get("aadvid") ?? "";
  } catch {
    return "";
  }
}

export function extractAdDate(url) {
  try {
    const params = new URL(url).searchParams;
    const startDate = params.get("st") ?? "";
    const endDate = params.get("et") ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate === endDate ? startDate : "";
  } catch {
    return "";
  }
}

export function extractCtid(url) {
  try {
    return new URL(url).searchParams.get("ctid") ?? "";
  } catch {
    return "";
  }
}

export function updateCampaignPageDateUrl(url, storeDate, ctid = "") {
  const normalizedDate = normalizeText(storeDate);
  const normalizedCtid = normalizeText(ctid);

  try {
    const parsedUrl = new URL(url);
    if (normalizedCtid) parsedUrl.searchParams.set("ctid", normalizedCtid);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      parsedUrl.searchParams.set("relative_time", "custom");
      parsedUrl.searchParams.set("st", normalizedDate);
      parsedUrl.searchParams.set("et", normalizedDate);
    }
    parsedUrl.searchParams.set("sort_state", "stat_cost");
    parsedUrl.searchParams.set("sort_order", "1");
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

export function isTargetCampaignPage(url, adAccountId = "") {
  if (!/ads\.tiktok\.com\/i18n\/manage\/campaign/.test(url)) return false;
  const normalizedAdAccountId = normalizeText(adAccountId);
  return !normalizedAdAccountId || extractAdAccountId(url) === normalizedAdAccountId;
}

export function isTikTokAdAccountPage(url, adAccountId = "") {
  if (!/ads\.tiktok\.com\/i18n\/manage\//.test(url)) return false;
  const normalizedAdAccountId = normalizeText(adAccountId);
  return !normalizedAdAccountId || extractAdAccountId(url) === normalizedAdAccountId;
}

async function readStoreSummaryMetadata(summaryPath) {
  try {
    const summary = await readJson(summaryPath);
    return {
      storeDate: normalizeText(summary?.selectedDate) || normalizeText(summary?.storeDate),
      generatedAt: normalizeText(summary?.generatedAt)
    };
  } catch {
    return {
      storeDate: "",
      generatedAt: ""
    };
  }
}

async function getLatestDebuggerEndpoint(logDirPath) {
  let files;
  try {
    files = await fs.readdir(logDirPath);
  } catch {
    return "";
  }

  const logFiles = files
    .filter((name) => /^log\.\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .sort()
    .reverse();

  for (const logFile of logFiles) {
    const fullPath = path.join(logDirPath, logFile);
    const text = await fs.readFile(fullPath, "utf8");
    const matches = [...text.matchAll(DEBUGGER_URL_PATTERN)];
    if (matches.length) return matches.at(-1)[1];
  }

  return "";
}

async function readAdsPowerCampaignRows(debuggerEndpoint, options = {}) {
  const targetDate = normalizeText(options.storeDate);
  const canOpenMissingPage = options.openMissingPage !== false;
  if (options.campaignPageUrl && canOpenMissingPage) {
    const directResult = await readAdsPowerCampaignRowsViaPageCdp(debuggerEndpoint, {
      ...options,
      navigateUrl: updateCampaignPageDateUrl(options.campaignPageUrl, targetDate, options.ctid),
      forceRefresh: options.refresh !== false
    }).catch(() => null);
    if (directResult?.ok) return directResult;
  }

  if (options.refresh === false && !targetDate) {
    const quickResult = await readAdsPowerCampaignRowsViaPageCdp(debuggerEndpoint, options).catch(() => null);
    if (quickResult?.ok) return quickResult;
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(debuggerEndpoint, { timeout: Number(options.connectTimeoutMs ?? 5000) });
    const pages = browser
      .contexts()
      .flatMap((context) => context.pages());
    let page = pages.find((candidate) => isTargetCampaignPage(candidate.url(), options.adAccountId));
    if (!page && options.campaignPageUrl && canOpenMissingPage) {
      page = pages.find((candidate) => isTikTokAdAccountPage(candidate.url(), options.adAccountId));
      if (page) {
        await navigateToCampaignUrl(page, updateCampaignPageDateUrl(options.campaignPageUrl, targetDate, options.ctid));
      }
    }

    if (!page && options.campaignPageUrl && canOpenMissingPage) {
      const context = browser.contexts()[0] ?? await browser.newContext();
      page = await context.newPage();
      await navigateToCampaignUrl(page, updateCampaignPageDateUrl(options.campaignPageUrl, targetDate, options.ctid));
    }

    if (!page) {
      return {
        ok: false,
        reason: "未找到当前打开的 TikTok Ads 推广系列页面"
      };
    }

    const hasWrongDate = targetDate && extractAdDate(page.url()) !== targetDate;
    const hasWrongCtid = options.ctid && extractCtid(page.url()) !== normalizeText(options.ctid);
    if (hasWrongDate || hasWrongCtid) {
      await gotoCampaignDate(page, targetDate, options.ctid);
    }

    if (options.refresh !== false) {
      await refreshCampaignPage(page);
    } else {
      await page.waitForSelector("[slot^='cell-']", { timeout: Number(options.readTimeoutMs ?? 5000) });
    }

    const rows = await page.evaluate(() => {
      const grouped = {};
      for (const element of Array.from(document.querySelectorAll("[slot^='cell-']"))) {
        const slot = element.getAttribute("slot") || "";
        const match = /^cell-(.+?)_(.+)$/.exec(slot);
        if (!match) continue;
        const [, rowId, field] = match;
        grouped[rowId] ??= {};
        grouped[rowId].__rowId = rowId;
        grouped[rowId][field] = (element.textContent || "").replace(/\s+/g, " ").trim();
      }
      return Object.values(grouped);
    });
    const pageTotalSpend = await page.evaluate(() => {
      const table = document.querySelector("ks-virtual-table-1-1-1n, ks-virtual-table, .KsTable") || document.body;
      const moneyElements = Array.from(table.querySelectorAll("ks-text-1-1-1n, span, div"))
        .filter((element) => !element.closest("[slot^='cell-']"))
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => /^\d[\d,]*(?:\.\d+)?\s*USD$/i.test(text));
      return moneyElements[0] || "";
    });

    return {
      ok: true,
      adPageUrl: page.url(),
      adDate: extractAdDate(page.url()),
      totalSpend: normalizeAmount(pageTotalSpend),
      totalSpendSource: pageTotalSpend ? "table-total" : "visible-rows",
      rows: rows
        .map((row) => normalizeCampaignRow(row))
        .filter((row) => row.campaignId && row.campaignName)
    };
  } catch (error) {
    return {
      ok: false,
      reason: `读取 AdsPower 广告页面失败: ${error.message}`
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function readAdsPowerCampaignRowsViaPageCdp(debuggerEndpoint, options = {}) {
  const pages = await listDevtoolsPages(debuggerEndpoint, options.connectTimeoutMs ?? 5000);
  let pageInfo = pages.find((page) => page.type === "page" && isTargetCampaignPage(page.url, options.adAccountId))
    || (options.navigateUrl ? pages.find((page) => page.type === "page" && isRecoverableTikTokAdsPage(page, options.adAccountId)) : null);
  if (options.navigateUrl && (!pageInfo || !pageInfo.url)) {
    pageInfo = await openDevtoolsPage(debuggerEndpoint, options.navigateUrl, options.connectTimeoutMs ?? 5000);
    if (pageInfo?.webSocketDebuggerUrl) {
      await waitForCampaignRowsCdp(pageInfo.webSocketDebuggerUrl, options.navigateUrl, options.readTimeoutMs ?? 30000);
    }
  }
  if (!pageInfo?.webSocketDebuggerUrl) {
    return {
      ok: false,
      reason: "未找到当前打开的 TikTok Ads 推广系列页面"
    };
  }

  const needsNavigation = options.navigateUrl && (
    !isTargetCampaignPage(pageInfo.url, options.adAccountId)
    || extractAdDate(pageInfo.url) !== extractAdDate(options.navigateUrl)
    || extractCtid(pageInfo.url) !== extractCtid(options.navigateUrl)
  );
  if (needsNavigation) {
    await navigatePageCdp(pageInfo.webSocketDebuggerUrl, options.navigateUrl, options.readTimeoutMs ?? 30000).catch(async () => {
      await closeDevtoolsPage(debuggerEndpoint, pageInfo?.id, options.connectTimeoutMs ?? 5000).catch(() => {});
      pageInfo = await openDevtoolsPage(debuggerEndpoint, options.navigateUrl, options.connectTimeoutMs ?? 5000);
      if (pageInfo?.webSocketDebuggerUrl) {
        await waitForCampaignRowsCdp(pageInfo.webSocketDebuggerUrl, options.navigateUrl, options.readTimeoutMs ?? 30000);
      }
    });
  } else if (options.forceRefresh) {
    const clicked = await clickCampaignRefreshCdp(pageInfo.webSocketDebuggerUrl, options.readTimeoutMs ?? 5000).catch(() => false);
    if (clicked) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    } else {
      await navigatePageCdp(pageInfo.webSocketDebuggerUrl, options.navigateUrl, options.readTimeoutMs ?? 30000);
    }
  }

  const readPageData = (webSocketUrl) => evaluatePageCdp(webSocketUrl, `(() => {
    const grouped = {};
    for (const element of Array.from(document.querySelectorAll("[slot^='cell-']"))) {
      const slot = element.getAttribute("slot") || "";
      const match = /^cell-(.+?)_(.+)$/.exec(slot);
      if (!match) continue;
      const [, rowId, field] = match;
      grouped[rowId] ??= {};
      grouped[rowId].__rowId = rowId;
      grouped[rowId][field] = (element.textContent || "").replace(/\\s+/g, " ").trim();
    }
    const table = document.querySelector("ks-virtual-table-1-1-1n, ks-virtual-table, .KsTable") || document.body;
    const moneyElements = Array.from(table.querySelectorAll("ks-text-1-1-1n, span, div"))
      .filter((element) => !element.closest("[slot^='cell-']"))
      .map((element) => (element.textContent || "").replace(/\\s+/g, " ").trim())
      .filter((text) => /^\\d[\\d,]*(?:\\.\\d+)?\\s*USD$/i.test(text));
    return {
      url: location.href,
      rows: Object.values(grouped),
      pageTotalSpend: moneyElements[0] || ""
    };
  })()`, options.readTimeoutMs ?? 5000);
  let data;
  try {
    data = await readPageData(pageInfo.webSocketDebuggerUrl);
  } catch (error) {
    if (!options.navigateUrl) throw error;
    await closeDevtoolsPage(debuggerEndpoint, pageInfo?.id, options.connectTimeoutMs ?? 5000).catch(() => {});
    pageInfo = await openDevtoolsPage(debuggerEndpoint, options.navigateUrl, options.connectTimeoutMs ?? 5000);
    if (!pageInfo?.webSocketDebuggerUrl) throw error;
    await waitForCampaignRowsCdp(pageInfo.webSocketDebuggerUrl, options.navigateUrl, options.readTimeoutMs ?? 30000);
    data = await readPageData(pageInfo.webSocketDebuggerUrl);
  }

  return {
    ok: true,
    adPageUrl: data.url || pageInfo.url,
    adDate: extractAdDate(data.url || pageInfo.url),
    totalSpend: normalizeAmount(data.pageTotalSpend),
    totalSpendSource: data.pageTotalSpend ? "table-total" : "visible-rows",
    rows: (data.rows || [])
      .map((row) => normalizeCampaignRow(row))
      .filter((row) => row.campaignId && row.campaignName)
  };
}

function isRecoverableTikTokAdsPage(page, adAccountId = "") {
  const url = String(page?.url ?? "");
  if (isTikTokAdAccountPage(url, adAccountId)) return true;
  return !url && /tiktok ads|advertising on tiktok/i.test(String(page?.title ?? ""));
}

async function navigatePageCdp(webSocketUrl, url, timeoutMs) {
  const navigationToken = `codex-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await evaluatePageCdp(webSocketUrl, `(() => {
    window.__codexAdNavigationToken = ${JSON.stringify(navigationToken)};
    return true;
  })()`, 5000).catch(() => {});
  await sendPageCdpCommand(webSocketUrl, "Page.enable", {}, timeoutMs);
  await sendPageCdpCommand(webSocketUrl, "Page.navigate", { url }, timeoutMs);
  await waitForCampaignRowsCdp(webSocketUrl, url, timeoutMs, navigationToken);
}

async function clickCampaignRefreshCdp(webSocketUrl, timeoutMs) {
  return evaluatePageCdp(webSocketUrl, `(() => {
    const containers = Array.from(document.querySelectorAll(".cl-flex-none.cl-inline-flex.cl-items-center.cl-w-fit"));
    const container = containers.find((element) => (element.textContent || "").includes("刷新数据"));
    const button = container?.querySelector("ks-icon-button-1-1-1n, ks-icon-button, .KsIconButton, button");
    if (!button) return false;
    button.click();
    return true;
  })()`, timeoutMs);
}

async function waitForCampaignRowsCdp(webSocketUrl, url, timeoutMs, navigationToken = "") {
  const deadline = Date.now() + Math.max(15000, Number(timeoutMs));
  while (Date.now() < deadline) {
    const state = await evaluatePageCdp(webSocketUrl, `(() => ({
      url: location.href,
      hasRows: Boolean(document.querySelector("[slot^='cell-']")),
      navigationToken: window.__codexAdNavigationToken || ""
    }))()`, 5000).catch(() => null);
    const reachedNewDocument = !navigationToken || state?.navigationToken !== navigationToken;
    if (reachedNewDocument && state?.hasRows && isTargetCampaignPage(state.url) && extractAdDate(state.url) === extractAdDate(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function gotoCampaignDate(page, storeDate, ctid = "") {
  const nextUrl = updateCampaignPageDateUrl(page.url(), storeDate, ctid);
  if (nextUrl === page.url()) return;
  await navigateToCampaignUrl(page, nextUrl);
}

async function navigateToCampaignUrl(page, url) {
  try {
    await page.goto(url, { waitUntil: "commit", timeout: 15000 });
  } catch {
    await page.evaluate((nextUrl) => {
      window.location.assign(nextUrl);
    }, url).catch(() => {});
  }

  await page.waitForURL((currentUrl) => {
    const current = String(currentUrl);
    return /ads\.tiktok\.com\/i18n\/manage\/campaign/.test(current) && extractAdDate(current) === extractAdDate(url);
  }, { timeout: 45000 }).catch(() => {});
  await page.waitForSelector("[slot^='cell-']", { timeout: 30000 });
}

async function listDevtoolsPages(debuggerEndpoint, timeoutMs) {
  const baseUrl = devtoolsHttpBaseUrl(debuggerEndpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/json/list`, { signal: controller.signal });
    return response.ok ? await response.json() : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function openDevtoolsPage(debuggerEndpoint, url, timeoutMs) {
  const baseUrl = devtoolsHttpBaseUrl(debuggerEndpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      signal: controller.signal
    });
    return response.ok ? await response.json() : null;
  } finally {
    clearTimeout(timeout);
  }
}

async function closeDevtoolsPage(debuggerEndpoint, pageId, timeoutMs) {
  if (!pageId) return false;
  const baseUrl = devtoolsHttpBaseUrl(debuggerEndpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/json/close/${encodeURIComponent(pageId)}`, {
      signal: controller.signal
    });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}

function devtoolsHttpBaseUrl(debuggerEndpoint) {
  return debuggerEndpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "");
}

function evaluatePageCdp(webSocketUrl, expression, timeoutMs) {
  return sendPageCdpCommand(webSocketUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs).then((result) => result?.result?.value ?? {});
}

function sendPageCdpCommand(webSocketUrl, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`page CDP ${method} timeout ${timeoutMs}ms`));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method,
        params
      }));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) {
        reject(new Error(message.error.message || "page CDP evaluate failed"));
        return;
      }
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text || "page CDP evaluate exception"));
        return;
      }
      resolve(message.result);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("page CDP websocket error"));
    });
  });
}

async function refreshCampaignPage(page) {
  const clicked = await clickInPageRefreshButton(page);
  if (!clicked) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForSelector("[slot^='cell-']", { timeout: 30000 });
}

async function clickInPageRefreshButton(page) {
  const exactRefreshButton = page
    .locator(".cl-flex-none.cl-inline-flex.cl-items-center.cl-w-fit")
    .filter({ hasText: "刷新数据" })
    .locator("ks-icon-button-1-1-1n, ks-icon-button, .KsIconButton")
    .first();

  try {
    if (await exactRefreshButton.count()) {
      await exactRefreshButton.click({ timeout: 10000 });
      await page.waitForTimeout(3000);
      return true;
    }
  } catch {
    // Fall back to DOM click detection when TikTok's icon button swallows Playwright clicks.
  }

  const clicked = await page.evaluate(() => {
    const preferredClass = "cl-flex-none cl-inline-flex cl-items-center cl-w-fit";
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], .cl-flex-none.cl-inline-flex.cl-items-center.cl-w-fit"));
    const refreshButton = candidates.find((element) => {
      const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      const aria = (element.getAttribute("aria-label") || "").toLowerCase();
      const title = (element.getAttribute("title") || "").toLowerCase();
      const className = String(element.getAttribute("class") || "").toLowerCase();
      const testId = String(element.getAttribute("data-testid") || "").toLowerCase();
      const label = `${text} ${aria} ${title} ${className} ${testId}`;

      if (element.closest("[slot^='cell-']")) return false;
      if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
      if (preferredClass.split(" ").every((name) => element.classList.contains(name))) return true;
      return /刷新|refresh|reload|sync|rotate|refresh/.test(label);
    });

    if (!refreshButton) return false;
    refreshButton.scrollIntoView({ block: "center", inline: "center" });
    refreshButton.click();
    return true;
  }).catch(() => false);

  if (!clicked) return false;
  await page.waitForTimeout(3000);
  return true;
}

function buildResult({
  status,
  storeDate = "",
  orderSummaryGeneratedAt = "",
  debuggerEndpoint = "",
  adPageUrl = "",
  rows = [],
  totalSpend,
  totalSpendSource = "",
  reason = ""
}) {
  const ok = status === "ok";
  const rowsSpend = sumSpend(rows);
  const resolvedTotalSpend = Number.isFinite(Number(totalSpend)) && Number(totalSpend) > 0
    ? Math.round(Number(totalSpend) * 100) / 100
    : rowsSpend;
  return {
    status,
    generatedAt: new Date().toISOString(),
    storeDate: normalizeText(storeDate),
    orderSummaryGeneratedAt: normalizeText(orderSummaryGeneratedAt),
    debuggerEndpoint,
    adPageUrl,
    rowsChecked: rows.length,
    rowsSpend,
    totalSpend: resolvedTotalSpend,
    totalSpendSource: totalSpendSource || "visible-rows",
    rows,
    health: {
      ok,
      message: ok ? "" : reason,
      lastScrapeAt: new Date().toISOString()
    },
    message: ok ? `广告数据已刷新并读取 ${rows.length} 个系列，总花费 $${formatMoney(sumSpend(rows))}` : reason
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = normalizeText(row?.[key]);
    if (value) return value;
  }
  return "";
}

function normalizeStatus(value) {
  return normalizeText(value).replace(/\d+$/g, "");
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeNumber(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--summary") args.summaryPath = argv[index + 1];
    if (token === "--config") args.configPath = argv[index + 1];
    if (token === "--log-dir") args.logDirPath = argv[index + 1];
    if (token === "--output") args.outputPath = argv[index + 1];
    if (token === "--ad-account-id") args.adAccountId = argv[index + 1];
    if (token === "--ctid") args.ctid = argv[index + 1];
    if (token === "--no-refresh") args.refresh = false;
    if (["--summary", "--config", "--log-dir", "--output", "--ad-account-id", "--ctid"].includes(token)) {
      index += 1;
    }
  }
  return args;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentPath = fileURLToPath(import.meta.url);
if (entryPath === currentPath) {
  const result = await runAdSpendMonitor({
    outputPath: DEFAULT_OUTPUT_PATH,
    ...parseCliArgs(process.argv.slice(2))
  });
  console.log(JSON.stringify(result, null, 2));
}
