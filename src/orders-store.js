import { buildStoreDashboardSummary } from "./aggregate.js";
import { readJson, writeJson } from "./file-store.js";
import { formatDateInZone } from "./utm.js";

export async function saveScrapedOrders(scraperConfig, scrapedOrders, options = {}) {
  const summary = buildStoreDashboardSummary(scrapedOrders, {
    storeDate: options.storeDate,
    yesterdayDate: options.yesterdayDate,
    storeTimezone: scraperConfig.storeTimezone,
    days: 7
  });

  await writeJson(scraperConfig.ordersOutputPath, scrapedOrders);
  await writeJson(scraperConfig.dashboardDataPath, {
    ...summary,
    currency: options.currency ?? {},
    scrapeMeta: options.scrapeMeta ?? {},
    health: {
      ok: true,
      message: "抓取正常",
      lastScrapeAt: new Date().toISOString()
    }
  });

  return { orders: scrapedOrders, summary };
}

export async function saveIncrementalOrders(scraperConfig, newOrders, options = {}) {
  const existingOrders = await readJson(scraperConfig.ordersOutputPath, []);
  const storeTimezone = scraperConfig.storeTimezone ?? "America/Anchorage";
  const storeDate = options.storeDate ?? formatDateInZone(new Date(), storeTimezone);
  const oldestDate = addDays(storeDate, -6);
  const mergedOrders = mergeOrders(newOrders, existingOrders)
    .filter((order) => {
      const date = String(order.createdAt ?? "").trim().slice(0, 10);
      return date && date >= oldestDate && date <= storeDate;
    });

  return saveScrapedOrders(scraperConfig, mergedOrders, {
    ...options,
    storeDate
  });
}

export async function loadStoredOrders(scraperConfig) {
  return readJson(scraperConfig.ordersOutputPath, []);
}

function mergeOrders(primaryOrders, secondaryOrders) {
  const seen = new Set();
  const merged = [];

  for (const order of [...primaryOrders, ...secondaryOrders]) {
    const orderNumber = String(order.orderNumber ?? "").trim();
    if (!orderNumber || seen.has(orderNumber)) continue;
    seen.add(orderNumber);
    merged.push(order);
  }

  return merged;
}

function addDays(dateString, offset) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
}
