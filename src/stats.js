import { chromium } from "playwright";
import { buildSummary } from "./aggregate.js";
import { loadConfig } from "./config.js";
import { ensureLoggedIn } from "./scraper.js";
import { scrapeStoreTodayPages } from "./store-today.js";

const config = await loadConfig();
const { scraper } = config;
const { backend } = scraper;

const browser = await chromium.launch({ headless: scraper.headless });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await ensureLoggedIn(page, context, scraper);
  const { orders, storeDate } = await scrapeStoreTodayPages(page, backend, {
    log: (message) => console.log(message)
  });
  const summary = buildSummary(orders, {
    timeZone: scraper.timezone,
    includeAllDates: true,
    displayDate: storeDate ? `店铺端 ${storeDate}` : "店铺端今天"
  });

  console.log(`\n店铺端今天 ${storeDate || "-"} 的 UTM ID 统计结果：\n`);
  console.table(summary.groups.map((group) => ({
    utm_id: group.utmId,
    订单数量: group.orderCount,
    英镑金额: `£${formatMoney(group.totalAmount)}`,
    美元估算: `$${formatMoney(group.totalAmount * Number(config.dashboard.currency?.rate ?? 1.336))}`
  })));
  console.log(`合计：店铺端今天 ${summary.totals.orderCount} 单，识别到 utm_id ${summary.totals.recognizedOrders} 单，未识别 ${summary.totals.unrecognizedOrders} 单，订单总金额 £${formatMoney(summary.totals.totalAmount)} / $${formatMoney(summary.totals.totalAmount * Number(config.dashboard.currency?.rate ?? 1.336))}。`);
} finally {
  await browser.close();
}

function formatMoney(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
