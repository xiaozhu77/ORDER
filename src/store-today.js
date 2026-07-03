import { scrapeOrders } from "./scraper.js";

export async function scrapeStoreTodayPages(page, backend, options = {}) {
  const allOrders = [];
  let storeDate = "";
  const maxPages = options.maxPages ?? 100;
  const log = options.log ?? (() => {});

  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    await page.waitForSelector(backend.selectors.orderRows, { timeout: 60000 });
    await page.waitForTimeout(1500);

    const activePage = await getActivePage(page);
    const orders = await scrapeOrders(page, backend);
    if (!storeDate) {
      storeDate = getOrderDate(orders[0]?.createdAt);
    }

    const todayOrders = orders.filter((order) => getOrderDate(order.createdAt) === storeDate);
    allOrders.push(...todayOrders);
    log(`已抓取第 ${activePage || pageIndex} 页：本页 ${orders.length} 单，店铺端今天 ${todayOrders.length} 单`);

    if (!(await canGoNext(page))) break;
    if (orders.length > 0 && getOrderDate(orders.at(-1)?.createdAt) !== storeDate) break;

    const firstOrderNumber = orders[0]?.orderNumber ?? "";
    await page.locator(".pagination .btn-next").click();
    await waitForPageChanged(page, backend, firstOrderNumber);
  }

  return { orders: allOrders, storeDate };
}

export function getOrderDate(createdAt) {
  return String(createdAt ?? "").trim().slice(0, 10);
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
