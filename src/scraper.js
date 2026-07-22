import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { playNewOrderAlert } from "./alert.js";
import { captureAdsPowerAdData } from "./ad-spend-monitor.js";
import { readJson, writeJson } from "./file-store.js";
import { loadStoredOrders, saveIncrementalOrders, saveScrapedOrders } from "./orders-store.js";
import { scrapeStoreIncremental, scrapeStoreRecentDays } from "./store-today.js";

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
        const storedOrders = await loadStoredOrders(scraper);
        const existingOrderNumbers = new Set(storedOrders.map((order) => String(order.orderNumber ?? "").trim()).filter(Boolean));
        const scrapeResult = existingOrderNumbers.size
          ? await scrapeStoreIncremental(page, backend, {
            days: 7,
            existingOrderNumbers,
            storeTimezone: scraper.storeTimezone,
            log: (message) => {
              pageLogs.push(message);
              console.log(message);
            }
          })
          : await scrapeStoreRecentDays(page, backend, {
            days: 7,
            storeTimezone: scraper.storeTimezone,
            log: (message) => {
              pageLogs.push(message);
              console.log(message);
            }
          });
        const saveFn = existingOrderNumbers.size ? saveIncrementalOrders : saveScrapedOrders;
        const { summary } = await saveFn(scraper, scrapeResult.orders, {
          currency: config.dashboard.currency,
          storeDate: scrapeResult.storeDate,
          yesterdayDate: scrapeResult.yesterdayDate,
          scrapeMeta: {
            pageLogs,
            mode: existingOrderNumbers.size ? "incremental" : "full",
            newOrders: scrapeResult.orders.length,
            durationMs: Date.now() - startedAt.getTime()
          }
        });
        if (existingOrderNumbers.size > 0 && scrapeResult.orders.length > 0) {
          await playNewOrderAlert(scraper.alerts, scrapeResult.orders.length);
          console.log(`检测到 ${scrapeResult.orders.length} 个新订单，已播放提示音。`);
        }
        await captureAdsAfterOrderScrape(scraper, summary);
        console.log(`[${startedAt.toLocaleString()}] 店铺端今天 ${summary.totals.orderCount} 单，最近60分钟 ${summary.last60Minutes.orderCount} 单`);
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

async function captureAdsAfterOrderScrape(scraper, summary) {
  if (scraper.adCapture?.enabled === false) return;

  try {
    const result = await captureAdsPowerAdData({
      outputPath: scraper.adCapture?.outputPath,
      refresh: scraper.adCapture?.refreshBeforeRead !== false,
      storeDate: summary?.selectedDate ?? summary?.storeDate ?? "",
      orderSummaryGeneratedAt: summary?.generatedAt ?? ""
    });

    if (result.status === "ok") {
      console.log(`广告端 ${result.rowsChecked} 个系列，总花费 $${formatMoney(result.totalSpend)}，已刷新后读取。`);
      return;
    }

    console.warn(`广告端读取跳过: ${result.health?.message || result.message || "未知原因"}`);
  } catch (error) {
    console.warn(`广告端读取失败: ${error.message}`);
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
  const sessionState = await detectSessionState(page, backend, 20000);

  if (sessionState === "loggedIn") {
    console.log("已登录，进入订单抓取。");
    return;
  }

  console.log("未登录，打开登录页...");
  await gotoIgnoringAbort(page, getLoginPageUrl(backend.loginUrl));
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

async function detectSessionState(page, backend, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isLoggedIn(page, backend.selectors.loggedInMarker)) {
      return "loggedIn";
    }

    if (await isLoginPage(page, backend.selectors.usernameInput)) {
      return "loginRequired";
    }

    await page.waitForTimeout(1000);
  }

  if (await isLoggedIn(page, backend.selectors.loggedInMarker)) {
    return "loggedIn";
  }

  if (await isLoginPage(page, backend.selectors.usernameInput)) {
    return "loginRequired";
  }

  if (!String(page.url()).includes("/login")) {
    await gotoIgnoringAbort(page, backend.ordersUrl);
    if (await isLoggedIn(page, backend.selectors.loggedInMarker)) {
      return "loggedIn";
    }
  }

  return "loginRequired";
}

async function isLoginPage(page, usernameSelector) {
  if (String(page.url()).includes("/login")) {
    return true;
  }

  return page.locator(usernameSelector).first().isVisible({ timeout: 1000 }).catch(() => false);
}

function getLoginPageUrl(loginUrl) {
  try {
    const url = new URL(loginUrl);
    if (!/\/login\/?$/.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/login`;
    }
    return url.toString();
  } catch {
    return loginUrl;
  }
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
