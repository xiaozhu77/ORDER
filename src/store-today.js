import { scrapeOrders } from "./scraper.js";
import { formatDateInZone } from "./utm.js";

export async function scrapeStoreRecentDays(page, backend, options = {}) {
  const days = options.days ?? 7;
  const allOrders = [];
  const storeTimezone = options.storeTimezone ?? "America/Anchorage";
  const storeDate = options.storeDate ?? formatDateInZone(new Date(), storeTimezone);
  const oldestDate = addDays(storeDate, -(days - 1));
  const maxPages = options.maxPages ?? 100;
  const log = options.log ?? (() => {});

  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    await page.waitForSelector(backend.selectors.orderRows, { timeout: 60000 });
    await page.waitForTimeout(1500);

    const activePage = await getActivePage(page);
    const orders = await scrapeOrders(page, backend);

    const scopedOrders = orders.filter((order) => {
      const date = getOrderDate(order);
      return date && date >= oldestDate && date <= storeDate;
    });
    allOrders.push(...scopedOrders);

    const todayCount = scopedOrders.filter((order) => getOrderDate(order) === storeDate).length;
    const yesterdayCount = scopedOrders.length - todayCount;
    log(`已抓取第 ${activePage || pageIndex} 页：本页 ${orders.length} 单，今天 ${todayCount} 单，昨天 ${yesterdayCount} 单`);

    if (!(await canGoNext(page))) break;
    if (orders.length > 0 && getOrderDate(orders.at(-1)) < oldestDate) break;

    const firstOrderNumber = orders[0]?.orderNumber ?? "";
    await page.locator(".pagination .btn-next").click();
    await waitForPageChanged(page, backend, firstOrderNumber);
  }

  return {
    orders: allOrders,
    storeDate,
    yesterdayDate: addDays(storeDate, -1),
    oldestDate
  };
}

export async function scrapeStoreTodayPages(page, backend, options = {}) {
  const result = await scrapeStoreRecentDays(page, backend, { ...options, days: 1 });
  return { orders: result.orders, storeDate: result.storeDate };
}

export function getOrderDate(order) {
  return String(order?.createdAt ?? "").trim().slice(0, 10);
}

export async function scrapeStoreIncremental(page, backend, options = {}) {
  const days = options.days ?? 7;
  const existingOrderNumbers = options.existingOrderNumbers ?? new Set();
  const storeTimezone = options.storeTimezone ?? "America/Anchorage";
  const storeDate = options.storeDate ?? formatDateInZone(new Date(), storeTimezone);
  const oldestDate = addDays(storeDate, -(days - 1));
  const maxPages = options.maxPages ?? 20;
  const log = options.log ?? (() => {});
  const allOrders = [];
  let stoppedByExisting = false;
  let stoppedByOldDate = false;

  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    await page.waitForSelector(backend.selectors.orderRows, { timeout: 60000 });
    await page.waitForTimeout(1200);

    const activePage = await getActivePage(page);
    const orders = await scrapeOrders(page, backend);
    let newOnPage = 0;

    for (const order of orders) {
      const date = getOrderDate(order);
      if (date && date < oldestDate) {
        stoppedByOldDate = true;
        break;
      }
      if (!date || date > storeDate) continue;
      if (existingOrderNumbers.has(order.orderNumber)) {
        stoppedByExisting = true;
        break;
      }
      allOrders.push(order);
      newOnPage += 1;
    }

    log(`增量抓取第 ${activePage || pageIndex} 页：本页 ${orders.length} 单，新增 ${newOnPage} 单`);

    if (stoppedByExisting || stoppedByOldDate) break;
    if (!(await canGoNext(page))) break;

    const firstOrderNumber = orders[0]?.orderNumber ?? "";
    await page.locator(".pagination .btn-next").click();
    await waitForPageChanged(page, backend, firstOrderNumber);
  }

  return {
    orders: allOrders,
    storeDate,
    yesterdayDate: addDays(storeDate, -1),
    oldestDate,
    stoppedByExisting,
    stoppedByOldDate
  };
}

function addDays(dateString, offset) {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
}

async function getActivePage(page) {
  return page.locator(".pagination .el-pager .number.active").innerText({ timeout: 3000 }).catch(() => "");
}

async function canGoNext(page) {
  return page.locator(".pagination .btn-next").evaluate((button) => {
    return !button.disabled && !button.classList.contains("disabled");
  }).catch(() => false);
}

async function waitForPageChanged(page, backend, previousFirstOrderNumber) {
  if (!previousFirstOrderNumber) {
    await page.waitForTimeout(2500);
    return;
  }

  await page.waitForFunction(
    ({ rowSelector, orderSelector, previous }) => {
      const firstRow = document.querySelector(rowSelector);
      const orderCell = firstRow?.querySelector(orderSelector);
      const current = orderCell?.textContent?.trim() ?? "";
      return current && current !== previous;
    },
    {
      rowSelector: backend.selectors.orderRows,
      orderSelector: backend.selectors.orderNumber,
      previous: previousFirstOrderNumber
    },
    { timeout: 30000 }
  ).catch(() => page.waitForTimeout(2500));
}
