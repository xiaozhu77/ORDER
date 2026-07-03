import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { readJson, writeJson } from "./file-store.js";
import { saveScrapedOrders } from "./orders-store.js";
import { scrapeStoreTodayPages } from "./store-today.js";

export async function runScraper(config) {
  const scraper = config.scraper;
  const backend = scraper.backend;
  validateScraperConfig(scraper);

  const browser = await chromium.launch({ headless: scraper.headless });
  const context = await newContext(browser, scraper.storageStatePath);
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, context, scraper);

    while (true) {
      const startedAt = new Date();
      try {
        await gotoIgnoringAbort(page, backend.ordersUrl);
        const pageLogs = [];
        const { orders, storeDate } = await scrapeStoreTodayPages(page, backend, {
          log: (message) => {
            pageLogs.push(message);
            console.log(message);
          }
        });
        const { summary } = await saveScrapedOrders(scraper, orders, {
          storeDate,
          scrapeMeta: {
            pageLogs,
            durationMs: Date.now() - startedAt.getTime()
          }
        });
        console.log(`[${startedAt.toLocaleString()}] 店铺端今天 ${summary.totals.orderCount} 单，金额 ${summary.totals.totalAmount}`);
      } catch (error) {
        await writeHealth(scraper.dashboardDataPath, false, error);
        console.error(`[${startedAt.toLocaleString()}] 抓取失败:`, error.message);
      }

      await page.waitForTimeout(scraper.intervalSeconds * 1000);
    }
  } finally {
    await browser.close();
  }
}

export async function scrapeOrders(page, backend) {
  await page.waitForSelector(backend.selectors.orderRows, { timeout: 60000 });

  return page.$$eval(backend.selectors.orderRows, (rows, selectors) => {
    function text(row, selector) {
      const element = row.querySelector(selector);
      return element?.textContent?.trim() ?? "";
    }

    function landingUrl(row, selector) {
      const element = row.querySelector(selector);
      if (!element) return "";
      return element.getAttribute("href") || element.textContent?.trim() || "";
    }

    return rows.map((row) => ({
      orderNumber: text(row, selectors.orderNumber),
      createdAt: text(row, selectors.createdAt),
      amount: text(row, selectors.amount),
      status: text(row, selectors.status),
      landingUrl: landingUrl(row, selectors.landingUrl)
    })).filter((order) => order.orderNumber);
  }, backend.selectors);
}

export async function ensureLoggedIn(page, context, scraper) {
  const backend = scraper.backend;

  console.log("打开订单页，检查登录状态...");
  await gotoIgnoringAbort(page, backend.ordersUrl);
  await page.waitForTimeout(3000);

  if (await isLoggedIn(page, backend.selectors.loggedInMarker)) {
    console.log("已登录，进入订单抓取。");
    return;
  }

  console.log("未登录，打开登录页...");
  await gotoIgnoringAbort(page, backend.loginUrl);
  await page.waitForSelector(backend.selectors.usernameInput, { timeout: 60000 });
  await page.fill(backend.selectors.usernameInput, backend.username);
  await page.fill(backend.selectors.passwordInput, backend.password);
  await page.click(backend.selectors.loginButton);
  await page.waitForURL((url) => !String(url).includes("/login"), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);

  console.log("登录后进入订单页...");
  await gotoIgnoringAbort(page, backend.ordersUrl);
  await page.waitForSelector(backend.selectors.loggedInMarker, { timeout: 60000 });

  await fs.mkdir(path.dirname(path.resolve(scraper.storageStatePath)), { recursive: true });
  await context.storageState({ path: scraper.storageStatePath });
  console.log("登录态已保存。");
}

async function gotoIgnoringAbort(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (error) {
    if (!String(error.message || error).includes("ERR_ABORTED")) {
      throw error;
    }
  }
}

async function isLoggedIn(page, markerSelector) {
  if (!markerSelector) return false;
  return page.locator(markerSelector).first().isVisible({ timeout: 5000 }).catch(() => false);
}

async function newContext(browser, storageStatePath) {
  try {
    await fs.access(path.resolve(storageStatePath));
    return browser.newContext({ storageState: storageStatePath });
  } catch {
    return browser.newContext();
  }
}

async function writeHealth(filePath, ok, error) {
  const current = await readJson(filePath, {
    generatedAt: new Date().toISOString(),
    date: "",
    totals: {
      orderCount: 0,
      totalAmount: 0,
      recognizedOrders: 0,
      unrecognizedOrders: 0,
      recognitionRate: 0
    },
    groups: [],
    orders: []
  });

  await writeJson(filePath, {
    ...current,
    health: {
      ok,
      message: error.message,
      lastScrapeAt: new Date().toISOString()
    }
  });
}

function validateScraperConfig(scraper) {
  const required = [
    ["backend.loginUrl", scraper.backend.loginUrl],
    ["backend.ordersUrl", scraper.backend.ordersUrl],
    ["backend.username", scraper.backend.username],
    ["backend.password", scraper.backend.password],
    ["backend.selectors.usernameInput", scraper.backend.selectors.usernameInput],
    ["backend.selectors.passwordInput", scraper.backend.selectors.passwordInput],
    ["backend.selectors.loginButton", scraper.backend.selectors.loginButton],
    ["backend.selectors.loggedInMarker", scraper.backend.selectors.loggedInMarker],
    ["backend.selectors.orderRows", scraper.backend.selectors.orderRows],
    ["backend.selectors.orderNumber", scraper.backend.selectors.orderNumber],
    ["backend.selectors.createdAt", scraper.backend.selectors.createdAt],
    ["backend.selectors.amount", scraper.backend.selectors.amount],
    ["backend.selectors.status", scraper.backend.selectors.status],
    ["backend.selectors.landingUrl", scraper.backend.selectors.landingUrl]
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`config.json 缺少必要配置: ${missing.join(", ")}`);
  }
}
