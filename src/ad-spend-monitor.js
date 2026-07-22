import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadConfig } from "./config.js";
import { readJson, writeJson } from "./file-store.js";

const DEFAULT_LOG_PATH = path.join(process.env.APPDATA ?? "", "adspower_global", "cwd_global", "log");
const DEFAULT_OUTPUT_PATH = "public/data/ad-summary.json";
const DEBUGGER_URL_PATTERN = /webSocketDebuggerUrl-\s+(ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/g;

export async function runAdSpendMonitor(options = {}) {
  const config = await loadConfig(options.configPath);
  const summaryPath = path.resolve(options.summaryPath ?? config.scraper.dashboardDataPath);
  const storeSummary = await readStoreSummaryMetadata(summaryPath);

  return captureAdsPowerAdData({
    logDirPath: options.logDirPath ?? DEFAULT_LOG_PATH,
    outputPath: options.outputPath,
    refresh: options.refresh !== false,
    storeDate: options.storeDate ?? storeSummary.storeDate,
    orderSummaryGeneratedAt: storeSummary.generatedAt
  });
}

export async function captureAdsPowerAdData(options = {}) {
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
      refresh: options.refresh !== false
    });

    if (!browserResult.ok) {
      result = buildResult({
        status: "skip",
        storeDate: options.storeDate,
        orderSummaryGeneratedAt: options.orderSummaryGeneratedAt,
        debuggerEndpoint,
        reason: browserResult.reason
      });
    } else {
      result = buildResult({
        status: "ok",
        storeDate: options.storeDate,
        orderSummaryGeneratedAt: options.orderSummaryGeneratedAt,
        debuggerEndpoint,
        adPageUrl: browserResult.adPageUrl,
        rows: browserResult.rows
      });
    }
  }

  if (options.outputPath) {
    await writeJson(options.outputPath, result);
  }

  return result;
}

export function normalizeCampaignRow(row) {
  const normalized = {
    campaignId: normalizeText(row?.campaign_id),
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
  let browser;
  try {
    browser = await chromium.connectOverCDP(debuggerEndpoint);
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => /ads\.tiktok\.com\/i18n\/manage\/campaign/.test(candidate.url()));

    if (!page) {
      return {
        ok: false,
        reason: "未找到当前打开的 TikTok Ads 推广系列页面"
      };
    }

    if (options.refresh !== false) {
      await refreshCampaignPage(page);
    } else {
      await page.waitForSelector("[slot^='cell-']", { timeout: 30000 });
    }

    const rows = await page.evaluate(() => {
      const grouped = {};
      for (const element of Array.from(document.querySelectorAll("[slot^='cell-']"))) {
        const slot = element.getAttribute("slot") || "";
        const match = /^cell-(.+?)_(.+)$/.exec(slot);
        if (!match) continue;
        const [, rowId, field] = match;
        grouped[rowId] ??= {};
        grouped[rowId][field] = (element.textContent || "").replace(/\s+/g, " ").trim();
      }
      return Object.values(grouped);
    });

    return {
      ok: true,
      adPageUrl: page.url(),
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

async function refreshCampaignPage(page) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForSelector("[slot^='cell-']", { timeout: 30000 });
}

function buildResult({
  status,
  storeDate = "",
  orderSummaryGeneratedAt = "",
  debuggerEndpoint = "",
  adPageUrl = "",
  rows = [],
  reason = ""
}) {
  const ok = status === "ok";
  return {
    status,
    generatedAt: new Date().toISOString(),
    storeDate: normalizeText(storeDate),
    orderSummaryGeneratedAt: normalizeText(orderSummaryGeneratedAt),
    debuggerEndpoint,
    adPageUrl,
    rowsChecked: rows.length,
    totalSpend: sumSpend(rows),
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
    if (token === "--no-refresh") args.refresh = false;
    if (["--summary", "--config", "--log-dir", "--output"].includes(token)) {
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
