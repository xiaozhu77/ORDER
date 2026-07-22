import path from "node:path";
import { readJson, writeJson } from "./file-store.js";

const DEFAULT_SUMMARY_PATH = "public/data/summary.json";
const DEFAULT_STATE_PATH = "data/order-alert-state.json";

export async function checkForNewOrders(options = {}) {
  const summaryPath = path.resolve(options.summaryPath ?? DEFAULT_SUMMARY_PATH);
  const statePath = path.resolve(options.statePath ?? DEFAULT_STATE_PATH);

  let summary;
  try {
    summary = await readJson(summaryPath);
  } catch (error) {
    return buildSkipResult(`无法读取 summary.json: ${error.message}`);
  }

  if (!summary || typeof summary !== "object") {
    return buildSkipResult("summary.json 内容为空或格式不正确");
  }

  const storeDate = normalizeText(summary.selectedDate) || normalizeText(summary.storeDate);
  const generatedAt = normalizeText(summary.generatedAt);
  if (!storeDate) {
    return buildSkipResult("summary.json 缺少 selectedDate/storeDate");
  }

  const orders = extractDailyOrders(summary, storeDate);
  if (!orders) {
    return buildSkipResult(`summary.json 缺少 ${storeDate} 对应的订单列表`);
  }

  const normalizedOrders = dedupeOrders(orders);
  let state;
  try {
    state = await readJson(statePath, null);
  } catch (error) {
    return buildSkipResult(`无法读取提醒状态: ${error.message}`);
  }

  const seenOrderNumbers = new Set(Array.isArray(state?.seenOrderNumbers) ? state.seenOrderNumbers.map(normalizeText).filter(Boolean) : []);
  const isInitialized = Boolean(state && typeof state === "object");
  const isSameStoreDate = normalizeText(state?.storeDate) === storeDate;
  const baselineSeen = isInitialized && isSameStoreDate ? seenOrderNumbers : new Set();
  const newOrders = normalizedOrders.filter((order) => !baselineSeen.has(order.orderNumber));

  const nextState = {
    storeDate,
    generatedAt,
    updatedAt: new Date().toISOString(),
    seenOrderNumbers: normalizedOrders.map((order) => order.orderNumber)
  };

  if (!isInitialized) {
    await writeJson(statePath, nextState);
    return {
      status: "init",
      storeDate,
      generatedAt,
      totalOrdersToday: normalizedOrders.length,
      newOrders: [],
      message: ""
    };
  }

  if (!newOrders.length) {
    await writeJson(statePath, nextState);
    return {
      status: "quiet",
      storeDate,
      generatedAt,
      totalOrdersToday: normalizedOrders.length,
      newOrders: [],
      message: ""
    };
  }

  await writeJson(statePath, nextState);
  return {
    status: "notify",
    storeDate,
    generatedAt,
    totalOrdersToday: normalizedOrders.length,
    newOrders,
    message: formatNotificationMessage({
      storeDate,
      generatedAt,
      totalOrdersToday: normalizedOrders.length,
      newOrders
    })
  };
}

export function extractDailyOrders(summary, storeDate) {
  const dailyOrders = summary.dailySummaries?.[storeDate]?.orders;
  if (Array.isArray(dailyOrders)) return dailyOrders;

  if (!Array.isArray(summary.orders)) return null;
  return summary.orders.filter((order) => normalizeText(order?.createdAt).slice(0, 10) === storeDate);
}

export function dedupeOrders(orders) {
  const seen = new Set();
  const normalized = [];

  for (const rawOrder of Array.isArray(orders) ? orders : []) {
    const orderNumber = normalizeText(rawOrder?.orderNumber);
    if (!orderNumber || seen.has(orderNumber)) continue;
    seen.add(orderNumber);
    normalized.push({
      orderNumber,
      createdAt: normalizeText(rawOrder?.createdAt),
      amount: normalizeAmount(rawOrder?.amount),
      status: normalizeText(rawOrder?.status),
      utmId: normalizeText(rawOrder?.utmId)
    });
  }

  return normalized.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.orderNumber.localeCompare(right.orderNumber));
}

export function formatNotificationMessage({ storeDate, generatedAt, totalOrdersToday, newOrders }) {
  const totalAmount = newOrders.reduce((sum, order) => sum + order.amount, 0);
  const orderList = newOrders
    .map((order) => `${order.orderNumber}${order.amount ? ` (£${formatMoney(order.amount)})` : ""}`)
    .join("，");

  return [
    "店铺出单提醒",
    `店铺日期：${storeDate}`,
    `本次新增 ${newOrders.length} 单`,
    `订单号：${orderList}`,
    `新增金额合计：£${formatMoney(totalAmount)}`,
    `当日累计单量：${totalOrdersToday}`,
    generatedAt ? `summary.json 生成时间：${generatedAt}` : ""
  ].filter(Boolean).join("\n");
}

function buildSkipResult(reason) {
  return {
    status: "skip",
    reason,
    message: ""
  };
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeAmount(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--summary") args.summaryPath = argv[index + 1];
    if (token === "--state") args.statePath = argv[index + 1];
    if (token === "--summary" || token === "--state") index += 1;
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = await checkForNewOrders(parseCliArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
