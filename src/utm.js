export const UNKNOWN_NO_URL = "未识别-无落地页URL";
export const UNKNOWN_NO_UTM = "未识别-无utm_id";
export const UNKNOWN_URL_PARSE = "未识别-URL解析失败";

export function extractUtmId(rawUrl) {
  const value = normalizeUrlValue(rawUrl);
  if (!value) {
    return { utmId: UNKNOWN_NO_URL, recognized: false, reason: "no_url" };
  }

  try {
    const parsed = new URL(value, "https://placeholder.local");
    const utmId = parsed.searchParams.get("utm_id");

    if (!utmId) {
      return { utmId: UNKNOWN_NO_UTM, recognized: false, reason: "no_utm_id" };
    }

    return { utmId, recognized: true, reason: "ok" };
  } catch {
    return { utmId: UNKNOWN_URL_PARSE, recognized: false, reason: "url_parse_failed" };
  }
}

function normalizeUrlValue(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return "";
  const match = value.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : value;
}

export function parseAmount(input) {
  const text = String(input ?? "").replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function isSameLocalDate(dateLike, targetDate = new Date(), timeZone = "Asia/Shanghai") {
  const date = parseOrderDate(dateLike);
  if (!date) return false;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date) === formatter.format(targetDate);
}

export function parseOrderDate(dateLike) {
  const value = String(dateLike ?? "").trim();
  if (!value) return null;

  const normalized = value.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, "$1-$2-$3");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
