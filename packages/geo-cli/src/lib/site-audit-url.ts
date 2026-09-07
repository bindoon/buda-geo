import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const FORBIDDEN_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan"];
const MARKETPLACE_HOSTS = [
  "1688.com",
  "taobao.com",
  "tmall.com",
  "jd.com",
  "jd.hk",
  "pinduoduo.com",
  "yangkeduo.com",
  "weidian.com",
  "xiaohongshu.com",
  "douyin.com",
  "kuaishou.com",
  "amazon.com",
  "amazon.cn",
  "aliexpress.com",
];

export type PublicUrlKind = "owned_website" | "marketplace_shop" | "invalid";

export interface ClassifiedPublicUrl {
  raw: string;
  normalized: string | null;
  host: string | null;
  kind: PublicUrlKind;
  marketplace: string | null;
}

export interface PublicPresence {
  website_or_shop_url: string;
  owned_website_url: string | null;
  shop_url: string | null;
  owned_website_kind: PublicUrlKind | null;
  shop_kind: PublicUrlKind | null;
  audit_eligible: boolean;
  skip_reason: string | null;
}

function hostnameOf(value: string): string | null {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function marketplaceFor(host: string): string | null {
  return MARKETPLACE_HOSTS.find((item) => host === item || host.endsWith(`.${item}`)) ?? null;
}

export function classifyPublicUrl(raw: string): ClassifiedPublicUrl {
  const value = raw.trim();
  if (!value) return { raw, normalized: null, host: null, kind: "invalid", marketplace: null };
  const host = hostnameOf(value);
  if (!host) return { raw, normalized: null, host: null, kind: "invalid", marketplace: null };
  const marketplace = marketplaceFor(host);
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withScheme);
    url.hash = "";
    return {
      raw,
      normalized: url.toString(),
      host,
      kind: marketplace ? "marketplace_shop" : "owned_website",
      marketplace,
    };
  } catch {
    return { raw, normalized: null, host, kind: "invalid", marketplace };
  }
}

export function classifyPublicPresence(websiteOrShop: string, conversionShop?: string | null): PublicPresence {
  const primary = classifyPublicUrl(websiteOrShop);
  const conversion = conversionShop ? classifyPublicUrl(conversionShop) : null;
  const owned = [primary, conversion].find((item) => item?.kind === "owned_website") ?? null;
  const shop = [primary, conversion].find((item) => item?.kind === "marketplace_shop") ?? null;
  if (owned?.normalized) {
    return {
      website_or_shop_url: websiteOrShop,
      owned_website_url: owned.normalized,
      shop_url: shop?.normalized ?? null,
      owned_website_kind: owned.kind,
      shop_kind: shop?.kind ?? null,
      audit_eligible: true,
      skip_reason: null,
    };
  }
  if (shop?.normalized) {
    return {
      website_or_shop_url: websiteOrShop,
      owned_website_url: null,
      shop_url: shop.normalized,
      owned_website_kind: null,
      shop_kind: shop.kind,
      audit_eligible: false,
      skip_reason: `当前公开链接是${shop.marketplace}店铺，不是可采集的自有官网`,
    };
  }
  return {
    website_or_shop_url: websiteOrShop,
    owned_website_url: null,
    shop_url: null,
    owned_website_kind: primary.kind === "invalid" ? "invalid" : null,
    shop_kind: null,
    audit_eligible: false,
    skip_reason: websiteOrShop.trim() ? "公开链接无法识别为自有官网" : "缺少官网或店铺链接",
  };
}

export function isForbiddenSsrfAddress(address: string): boolean {
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower.startsWith("fe80:")) return true;
    if (lower.startsWith("::ffff:")) return isForbiddenSsrfAddress(lower.slice(7));
    return false;
  }
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export async function normalizeAndValidateWebsiteUrl(raw: string, options: { skipAddressLookup?: boolean } = {}): Promise<string> {
  const value = raw.trim();
  if (!value) throw new Error("网址不能为空");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("网址格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("只允许 http 或 https 网址");
  if (url.username || url.password) throw new Error("网址中不能包含用户名或密码");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("只允许访问 80 或 443 端口");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || FORBIDDEN_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("不允许访问本机或内网域名");
  }
  if (!options.skipAddressLookup) {
    if (isIP(hostname)) {
      if (isForbiddenSsrfAddress(hostname)) throw new Error("不允许访问内网、保留或链路本地地址");
    } else {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some((item) => isForbiddenSsrfAddress(item.address))) {
        throw new Error("域名解析到了不允许访问的地址");
      }
    }
  }
  url.hash = "";
  return url.toString();
}
