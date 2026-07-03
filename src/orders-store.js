import { buildSummary } from "./aggregate.js";
import { writeJson } from "./file-store.js";

export async function saveScrapedOrders(scraperConfig, scrapedOrders, options = {}) {
  const summary = buildSummary(scrapedOrders, {
    timeZone: scraperConfig.timezone,
    includeAllDates: true,
    displayDate: options.storeDate ? `店铺端 ${options.storeDate}` : "店铺端今天"
  });

  await writeJson(scraperConfig.ordersOutputPath, scrapedOrders);
  await writeJson(scraperConfig.dashboardDataPath, {
    ...summary,
    currency: options.currency ?? {},
    storeDate: options.storeDate ?? "",
    scrapeMeta: options.scrapeMeta ?? {},
    health: {
      ok: true,
      message: "抓取正常",
      lastScrapeAt: new Date().toISOString()
    }
  });

  return { orders: scrapedOrders, summary };
}
