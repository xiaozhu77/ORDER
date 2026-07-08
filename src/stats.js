import { chromium } from "playwright";
import { buildStoreDashboardSummary } from "./aggregate.js";
import { loadConfig } from "./config.js";
import { ensureLoggedIn } from "./scraper.js";
import { scrapeStoreRecentDays } from "./store-today.js";

const config = await loadConfig();
const { scraper } = config;
const { backend } = scraper;
const rate = Number(config.dashboard.currency?.rate ?? 1.336);

const browser = await chromium.launch({ headless: scraper.headless });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await ensureLoggedIn(page, context, scraper);
  const { orders, storeDate, yesterdayDate } = await scrapeStoreRecentDays(page, backend, {
    days: 7,
    storeTimezone: scraper.storeTimezone,
    log: (message) => console.log(message)
  });
  const summary = buildStoreDashboardSummary(orders, {
    storeDate,
    yesterdayDate,
    storeTimezone: scraper.storeTimezone
  });

  console.log(`\n店铺端今天 ${storeDate || "-"} 的 UTM ID 统计结果：\n`);
  console.log("最近7天订单概览：\n");
  console.table(summary.availableDates.map((date) => {
    const daily = summary.dailySummaries[date];
    return {
      日期: date,
      订单数量: daily.totals.orderCount,
      英镑金额: `£${formatMoney(daily.totals.totalAmount)}`,
      美元估算: `$${formatMoney(daily.totals.totalAmount * rate)}`
    };
  }));
  console.table(summary.groups.map((group) => ({
    utm_id: summary.last60Minutes.byUtmId?.[group.utmId]
      ? `${group.utmId} 60m ${summary.last60Minutes.byUtmId[group.utmId].orderCount}单`
      : group.utmId,
    订单数量: group.orderCount,
    英镑金额: `£${formatMoney(group.totalAmount)}`,
    美元估算: `$${formatMoney(group.totalAmount * rate)}`
  })));
  console.log(`最近60分钟：${summary.last60Minutes.orderCount} 单，£${formatMoney(summary.last60Minutes.totalAmount)} / $${formatMoney(summary.last60Minutes.totalAmount * rate)}。`);
  if (summary.last60Minutes.startAt && summary.last60Minutes.endAt) {
    console.log(`店铺时间窗口：${summary.last60Minutes.startAt} - ${summary.last60Minutes.endAt}`);
  }
  console.log("\n今天和昨天都有出单的 UTM ID：\n");
  console.table(summary.continuingGroups.map((group) => ({
    utm_id: group.utmId,
    今日订单: group.todayOrderCount,
    今日英镑: `£${formatMoney(group.todayTotalAmount)}`,
    昨日订单: group.yesterdayOrderCount,
    昨日英镑: `£${formatMoney(group.yesterdayTotalAmount)}`,
    最近60分钟: `${summary.last60Minutes.byUtmId?.[group.utmId]?.orderCount ?? 0}单`
  })));
  console.log("\n店铺时间每小时订单：\n");
  console.table(summary.hourlyBuckets.map((bucket) => ({
    时间段: bucket.label,
    订单数量: bucket.orderCount,
    英镑金额: `£${formatMoney(bucket.totalAmount)}`,
    美元估算: `$${formatMoney(bucket.totalAmount * rate)}`
  })));
  console.log(`合计：店铺端今天 ${summary.totals.orderCount} 单，识别到 utm_id ${summary.totals.recognizedOrders} 单，未识别 ${summary.totals.unrecognizedOrders} 单，订单总金额 £${formatMoney(summary.totals.totalAmount)} / $${formatMoney(summary.totals.totalAmount * rate)}。`);
} finally {
  await browser.close();
}

function formatMoney(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
