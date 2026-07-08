import { extractUtmId, formatDateInZone, formatDateTimeInZone, isSameLocalDate, parseAmount, parseOrderDate } from "./utm.js";

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
  const displayDate = options.displayDate ?? (includeAllDates ? "当前订单页" : formatDateInZone(targetDate, timeZone));
  const orders = normalizeUniqueOrders(rawOrders).filter((order) => {
    return includeAllDates || isSameLocalDate(order.createdAt, targetDate, timeZone);
  });

  return {
    generatedAt: new Date().toISOString(),
    date: displayDate,
    totals: buildTotals(orders),
    groups: buildGroups(orders),
    orders
  };
}

export function buildStoreDashboardSummary(rawOrders, options = {}) {
  const timeZone = options.timeZone ?? options.storeTimezone ?? "America/Anchorage";
  const storeDate = options.storeDate ?? formatDateInZone(options.now ?? new Date(), timeZone);
  const yesterdayDate = options.yesterdayDate ?? previousDate(storeDate);
  const now = options.now ?? new Date();
  const days = options.days ?? 7;
  const availableDates = buildAvailableDates(storeDate, days);
  const orders = normalizeUniqueOrders(rawOrders);
  const dailySummaries = Object.fromEntries(
    availableDates.map((date) => [date, buildDateSummary(orders, date, timeZone, now, date === storeDate)])
  );
  const selectedSummary = dailySummaries[storeDate] ?? buildDateSummary(orders, storeDate, timeZone, now, true);
  const previousSummary = dailySummaries[yesterdayDate] ?? buildDateSummary(orders, yesterdayDate, timeZone, now, false);
  const continuingGroups = buildContinuingGroups(selectedSummary.groups, previousSummary.groups);

  return {
    generatedAt: new Date().toISOString(),
    date: storeDate ? `店铺端 ${storeDate}` : "店铺端今天",
    storeTimezone: timeZone,
    storeDate,
    selectedDate: storeDate,
    availableDates,
    yesterdayDate,
    dailySummaries,
    totals: selectedSummary.totals,
    groups: selectedSummary.groups,
    todayGroups: selectedSummary.groups,
    yesterdayGroups: previousSummary.groups,
    continuingUtmIds: continuingGroups.map((group) => group.utmId),
    continuingGroups,
    last60Minutes: selectedSummary.last60Minutes,
    hourlyBuckets: selectedSummary.hourlyBuckets,
    orders
  };
}

function buildDateSummary(orders, date, timeZone, now, isCurrentDate) {
  const dateOrders = orders.filter((order) => getOrderDate(order.createdAt) === date);
  const previousGroups = buildGroups(orders.filter((order) => getOrderDate(order.createdAt) === previousDate(date)));
  const groups = buildGroups(dateOrders);
  const continuingGroups = buildContinuingGroups(groups, previousGroups);

  return {
    date,
    label: date ? `店铺端 ${date}` : "店铺端日期",
    totals: buildTotals(dateOrders),
    groups,
    continuingGroups,
    continuingUtmIds: continuingGroups.map((group) => group.utmId),
    last60Minutes: isCurrentDate ? buildLast60Minutes(dateOrders, timeZone, now) : emptyLast60(timeZone),
    hourlyBuckets: buildHourlyBuckets(dateOrders, date),
    orders: dateOrders
  };
}

function normalizeUniqueOrders(rawOrders) {
  const seen = new Set();
  const orders = [];

  for (const rawOrder of rawOrders) {
    const order = normalizeOrder(rawOrder);
    if (!order.orderNumber || seen.has(order.orderNumber)) continue;
    seen.add(order.orderNumber);
    orders.push(order);
  }

  return orders;
}

function buildGroups(orders) {
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
    if (!current.latestOrderTime || compareStoreDateTime(order.createdAt, current.latestOrderTime) > 0) {
      current.latestOrderTime = order.createdAt;
    }
    groupsById.set(order.utmId, current);
  }

  return [...groupsById.values()]
    .map((group) => ({ ...group, totalAmount: roundMoney(group.totalAmount) }))
    .sort((a, b) => b.orderCount - a.orderCount || b.totalAmount - a.totalAmount);
}

function buildTotals(orders) {
  const totalAmount = roundMoney(orders.reduce((sum, order) => sum + order.amount, 0));
  const recognizedOrders = orders.filter((order) => order.recognized).length;
  const unrecognizedOrders = orders.length - recognizedOrders;

  return {
    orderCount: orders.length,
    totalAmount,
    recognizedOrders,
    unrecognizedOrders,
    recognitionRate: orders.length ? Number((recognizedOrders / orders.length).toFixed(4)) : 0
  };
}

function buildContinuingGroups(todayGroups, yesterdayGroups) {
  const yesterdayById = new Map(
    yesterdayGroups.filter((group) => group.recognized).map((group) => [group.utmId, group])
  );

  return todayGroups
    .filter((group) => group.recognized && yesterdayById.has(group.utmId))
    .map((todayGroup) => {
      const yesterdayGroup = yesterdayById.get(todayGroup.utmId);
      return {
        utmId: todayGroup.utmId,
        todayOrderCount: todayGroup.orderCount,
        todayTotalAmount: todayGroup.totalAmount,
        yesterdayOrderCount: yesterdayGroup.orderCount,
        yesterdayTotalAmount: yesterdayGroup.totalAmount,
        latestOrderTime: todayGroup.latestOrderTime
      };
    })
    .sort((a, b) => b.todayOrderCount - a.todayOrderCount || b.todayTotalAmount - a.todayTotalAmount);
}

function buildLast60Minutes(todayOrders, timeZone, now) {
  const storeNow = parseStoreLocalDateTime(formatDateTimeInZone(now, timeZone));
  const datedOrders = todayOrders
    .map((order) => ({ order, date: parseStoreLocalDateTime(order.createdAt) }))
    .filter((item) => item.date);

  const endDate = storeNow;
  const startDate = new Date(endDate.getTime() - 60 * 60 * 1000);
  const windowOrders = datedOrders
    .filter((item) => item.date >= startDate && item.date <= endDate)
    .map((item) => item.order);
  const groups = buildGroups(windowOrders);

  return {
    orderCount: windowOrders.length,
    totalAmount: roundMoney(windowOrders.reduce((sum, order) => sum + order.amount, 0)),
    utmIds: groups.filter((group) => group.recognized).map((group) => group.utmId),
    groups,
    byUtmId: Object.fromEntries(groups.map((group) => [group.utmId, {
      orderCount: group.orderCount,
      totalAmount: group.totalAmount
    }])),
    startAt: formatStoreDateTime(startDate),
    endAt: formatStoreDateTime(endDate),
    timeZone,
    label: "店铺时间"
  };
}

function emptyLast60(timeZone = "America/Anchorage") {
  return {
    orderCount: 0,
    totalAmount: 0,
    utmIds: [],
    groups: [],
    byUtmId: {},
    startAt: "",
    endAt: "",
    timeZone,
    label: "店铺时间"
  };
}

function buildHourlyBuckets(todayOrders, date) {
  const buckets = new Map();
  for (let hour = 0; hour < 24; hour += 1) {
    const hourText = String(hour).padStart(2, "0");
    const key = `${date} ${hourText}`;
    buckets.set(key, {
      key,
      label: `${hourText}:00-${hourText}:59`,
      orderCount: 0,
      totalAmount: 0,
      recognizedOrders: 0,
      unrecognizedOrders: 0
    });
  }

  for (const order of todayOrders) {
    const key = getOrderHourKey(order.createdAt);
    if (!buckets.has(key)) continue;
    const bucket = buckets.get(key);
    bucket.orderCount += 1;
    bucket.totalAmount += order.amount;
    if (order.recognized) {
      bucket.recognizedOrders += 1;
    } else {
      bucket.unrecognizedOrders += 1;
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, totalAmount: roundMoney(bucket.totalAmount) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function previousDate(dateString) {
  if (!dateString) return "";
  return addDays(dateString, -1);
}

function getOrderDate(createdAt) {
  return String(createdAt ?? "").trim().slice(0, 10);
}

function getOrderHourKey(createdAt) {
  const value = String(createdAt ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}/.test(value)) return "";
  return value.slice(0, 13);
}

function compareStoreDateTime(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildAvailableDates(storeDate, days) {
  if (!storeDate) return [];
  return Array.from({ length: days }, (_, index) => addDays(storeDate, -index));
}

function addDays(dateString, offset) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
}

function parseStoreLocalDateTime(value) {
  const normalized = String(value ?? "").trim().replace(" ", "T");
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatStoreDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
