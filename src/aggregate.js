import { extractUtmId, isSameLocalDate, parseAmount } from "./utm.js";

export function normalizeOrder(rawOrder) {
  const extracted = extractUtmId(rawOrder.landingUrl);

  return {
    orderNumber: String(rawOrder.orderNumber ?? "").trim(),
    createdAt: String(rawOrder.createdAt ?? "").trim(),
    amount: parseAmount(rawOrder.amount),
    status: String(rawOrder.status ?? "").trim() || "未知",
    landingUrl: String(rawOrder.landingUrl ?? "").trim(),
    utmId: extracted.utmId,
    recognized: extracted.recognized,
    reason: extracted.reason
  };
}

export function buildSummary(rawOrders, options = {}) {
  const timeZone = options.timeZone ?? "Asia/Shanghai";
  const targetDate = options.targetDate ?? new Date();
  const includeAllDates = Boolean(options.includeAllDates);
  const displayDate = options.displayDate ?? (includeAllDates ? "当前订单页" : formatDate(targetDate, timeZone));
  const seen = new Set();
  const orders = [];

  for (const rawOrder of rawOrders) {
    const order = normalizeOrder(rawOrder);
    if (!order.orderNumber || seen.has(order.orderNumber)) continue;
    seen.add(order.orderNumber);
    if (!includeAllDates && !isSameLocalDate(order.createdAt, targetDate, timeZone)) continue;
    orders.push(order);
  }

  const groupsById = new Map();
  for (const order of orders) {
    const current = groupsById.get(order.utmId) ?? {
      utmId: order.utmId,
      recognized: order.recognized,
      orderCount: 0,
      totalAmount: 0,
      latestOrderTime: "",
      statusCounts: {}
    };

    current.orderCount += 1;
    current.totalAmount += order.amount;
    current.statusCounts[order.status] = (current.statusCounts[order.status] ?? 0) + 1;
    if (!current.latestOrderTime || new Date(order.createdAt) > new Date(current.latestOrderTime)) {
      current.latestOrderTime = order.createdAt;
    }
    groupsById.set(order.utmId, current);
  }

  const groups = [...groupsById.values()]
    .map((group) => ({ ...group, totalAmount: roundMoney(group.totalAmount) }))
    .sort((a, b) => b.orderCount - a.orderCount || b.totalAmount - a.totalAmount);

  const totalAmount = roundMoney(orders.reduce((sum, order) => sum + order.amount, 0));
  const recognizedOrders = orders.filter((order) => order.recognized).length;
  const unrecognizedOrders = orders.length - recognizedOrders;

  return {
    generatedAt: new Date().toISOString(),
    date: displayDate,
    totals: {
      orderCount: orders.length,
      totalAmount,
      recognizedOrders,
      unrecognizedOrders,
      recognitionRate: orders.length ? Number((recognizedOrders / orders.length).toFixed(4)) : 0
    },
    groups,
    orders
  };
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
