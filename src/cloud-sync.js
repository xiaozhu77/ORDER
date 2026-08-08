import path from "node:path";
import { readJson } from "./file-store.js";

const DEFAULT_INTERVAL_SECONDS = 30;

export function loadCloudSyncSettings() {
  try {
    process.loadEnvFile?.(path.resolve(".env.cloud"));
  } catch {
    // Cloud sync remains disabled until the private local environment file exists.
  }

  return {
    baseUrl: String(process.env.ORDER_DASHBOARD_CLOUD_URL ?? "").replace(/\/+$/, ""),
    syncToken: String(process.env.ORDER_DASHBOARD_SYNC_TOKEN ?? ""),
    sitesAuthorization: String(process.env.ORDER_DASHBOARD_SITES_AUTH ?? ""),
    intervalSeconds: Math.max(15, Number(process.env.ORDER_DASHBOARD_CLOUD_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS))
  };
}

export function startCloudSync(config) {
  const settings = loadCloudSyncSettings();
  if (!settings.baseUrl || !settings.syncToken) return null;
  return runCloudSyncLoop(config, settings);
}

export async function runCloudSyncLoop(config, settings = loadCloudSyncSettings()) {
  let lastSignature = "";
  while (true) {
    try {
      const snapshots = (await Promise.all((config.stores ?? []).map(buildStoreSnapshot))).filter(Boolean);
      const signature = snapshots.map((snapshot) => `${snapshot.storeKey}:${snapshot.generatedAt}`).join("|");
      if (snapshots.length && signature !== lastSignature) {
        await uploadSnapshots(settings, snapshots);
        lastSignature = signature;
        console.log(`云端看板已同步 ${snapshots.length} 个店铺。`);
      }
    } catch (error) {
      console.warn(`云端看板同步失败，将自动重试：${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, settings.intervalSeconds * 1000));
  }
}

async function buildStoreSnapshot(store) {
  const summary = await readJson(store.scraper?.dashboardDataPath, null);
  if (!summary?.generatedAt) return null;
  const dates = Array.isArray(summary.availableDates) ? summary.availableDates.slice(0, 8) : [];
  const adSummaries = {};

  await Promise.all(dates.map(async (date) => {
    const filePath = adSummaryPathForDate(
      store.scraper?.adCapture?.outputPath,
      date,
      summary.selectedDate || summary.storeDate
    );
    const adSummary = await readJson(filePath, null);
    if (adSummary?.status === "ok" && (!adSummary.storeDate || adSummary.storeDate === date)) {
      adSummaries[date] = sanitizeAdSummary(adSummary);
    }
  }));

  return {
    storeKey: String(store.key ?? "store"),
    storeName: String(store.name ?? store.key ?? "店铺"),
    storeDate: String(summary.storeDate ?? ""),
    generatedAt: String(summary.generatedAt),
    summary: sanitizeSummary(summary),
    adSummary: adSummaries[summary.selectedDate || summary.storeDate] ?? null,
    adSummaries
  };
}

function adSummaryPathForDate(basePath, targetDate, currentDate) {
  if (!basePath || !targetDate || targetDate === currentDate) return basePath;
  const parsed = path.parse(basePath);
  return path.join(parsed.dir, `${parsed.name}-${targetDate}${parsed.ext || ".json"}`);
}

export function sanitizeSummary(summary = {}) {
  const dailySummaries = Object.fromEntries(Object.entries(summary.dailySummaries ?? {})
    .slice(0, 8)
    .map(([date, daily]) => [date, sanitizeDailySummary(daily)]));

  return {
    generatedAt: text(summary.generatedAt),
    storeTimezone: text(summary.storeTimezone),
    storeDate: text(summary.storeDate),
    selectedDate: text(summary.selectedDate),
    availableDates: array(summary.availableDates).slice(0, 8).map(text),
    currency: {
      rate: number(summary.currency?.rate),
      rateLabel: text(summary.currency?.rateLabel)
    },
    dailySummaries,
    ...sanitizeDailySummary(summary),
    health: {
      ok: Boolean(summary.health?.ok),
      message: text(summary.health?.message).slice(0, 180),
      lastScrapeAt: text(summary.health?.lastScrapeAt)
    }
  };
}

function sanitizeDailySummary(daily = {}) {
  return {
    totals: sanitizeTotals(daily.totals),
    groups: array(daily.groups).map((group) => ({
      utmId: text(group?.utmId),
      recognized: Boolean(group?.recognized),
      orderCount: number(group?.orderCount),
      totalAmount: number(group?.totalAmount),
      latestOrderTime: text(group?.latestOrderTime)
    })),
    last60Minutes: {
      orderCount: number(daily.last60Minutes?.orderCount),
      totalAmount: number(daily.last60Minutes?.totalAmount)
    },
    hourlyBuckets: array(daily.hourlyBuckets).slice(0, 24).map((bucket, index) => ({
      hour: index,
      orderCount: number(bucket?.orderCount),
      totalAmount: number(bucket?.totalAmount)
    }))
  };
}

function sanitizeTotals(totals = {}) {
  return {
    orderCount: number(totals.orderCount),
    totalAmount: number(totals.totalAmount),
    recognizedOrders: number(totals.recognizedOrders),
    unrecognizedOrders: number(totals.unrecognizedOrders)
  };
}

export function sanitizeAdSummary(adSummary = {}) {
  return {
    status: text(adSummary.status),
    generatedAt: text(adSummary.generatedAt),
    storeDate: text(adSummary.storeDate),
    totalSpend: number(adSummary.totalSpend),
    rowsChecked: number(adSummary.rowsChecked),
    rows: array(adSummary.rows).map((row) => ({
      campaignId: text(row?.campaignId),
      campaignName: text(row?.campaignName),
      status: text(row?.status),
      spend: number(row?.spend),
      budget: number(row?.budget),
      cpc: number(row?.cpc),
      ctr: number(row?.ctr)
    }))
  };
}

async function uploadSnapshots(settings, snapshots) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${settings.syncToken}`
  };
  if (settings.sitesAuthorization) {
    headers["OAI-Sites-Authorization"] = `Bearer ${settings.sitesAuthorization}`;
  }

  try {
    const response = await fetch(`${settings.baseUrl}/api/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({ snapshots }),
      signal: controller.signal
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? "").trim(); }
function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
