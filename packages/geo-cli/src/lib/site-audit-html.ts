const DROP_TAGS = /<(script|style|noscript|template|svg|iframe|textarea)\b[\s\S]*?<\/\1>/gi;
const CHALLENGE_MARKERS = [
  "aliyun_waf",
  "_waf_",
  "renderdata",
  "cf-browser-verification",
  "cf_chl_",
  "challenge-platform",
  "incapsula",
  "_incap_",
  "distil_r_captcha",
  "wzws-waf",
  "tencent_waf",
  "百度安全验证",
  "安全验证",
  "滑动验证",
  "请开启javascript",
  "enable javascript to continue",
  "正在验证您的浏览器",
  "checking your browser",
];

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(DROP_TAGS, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function visibleText(html: string): string {
  return stripTags(html);
}

export function textLength(value: string): number {
  return value.replace(/\s/g, "").length;
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))
    ?? tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i"));
  return decodeHtmlEntities(match?.[1] ?? "").trim();
}

export function extractTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : "";
}

export function extractMetaDescription(html: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (/name\s*=\s*["']description["']/i.test(tag)) return attr(tag, "content");
  }
  return "";
}

export function extractCanonical(html: string): string {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (/rel\s*=\s*["'][^"']*canonical[^"']*["']/i.test(tag)) return attr(tag, "href");
  }
  return "";
}

export function extractHeadings(html: string): { h1: string[]; sequence: string[]; questionHeadingCount: number } {
  const h1: string[] = [];
  const sequence: string[] = [];
  let questionHeadingCount = 0;
  const matches = html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi);
  for (const match of matches) {
    const level = match[1].toLowerCase();
    const text = stripTags(match[2]);
    sequence.push(level);
    if (level === "h1" && text) h1.push(text);
    if (/[?？]|什么|如何|怎么|为什么|哪/.test(text)) questionHeadingCount += 1;
  }
  return { h1, sequence, questionHeadingCount };
}

function mainHtml(html: string): string {
  const withoutChrome = html
    .replace(DROP_TAGS, " ")
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  for (const pattern of [
    /<article\b[\s\S]*?<\/article>/i,
    /<main\b[\s\S]*?<\/main>/i,
    /<[^>]+role=["']main["'][^>]*>[\s\S]*?<\/[a-z0-9]+>/i,
  ]) {
    const match = withoutChrome.match(pattern);
    if (match && textLength(stripTags(match[0])) > 120) return match[0];
  }
  const body = withoutChrome.match(/<body\b[\s\S]*<\/body>/i);
  return body?.[0] ?? withoutChrome;
}

export function extractParagraphs(html: string): string[] {
  return [...mainHtml(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
}

export function countTags(html: string, tag: string): number {
  return (mainHtml(html).match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;
}

export function imageStats(html: string): { imageCount: number; imagesMissingAlt: number } {
  const images = [...mainHtml(html).matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  return {
    imageCount: images.length,
    imagesMissingAlt: images.filter((tag) => !attr(tag, "alt")).length,
  };
}

export function extractLinks(html: string, base: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let host = "";
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return [];
  }
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || /^(javascript:|mailto:|tel:)/i.test(href)) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, base);
      absolute.hash = "";
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(absolute.protocol) || absolute.hostname.toLowerCase() !== host) continue;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|rar|mp4|mp3|css|js)(?:\?|$)/i.test(absolute.pathname)) continue;
    const hrefText = absolute.toString();
    if (!seen.has(hrefText)) {
      seen.add(hrefText);
      result.push(hrefText);
    }
    if (result.length >= 500) break;
  }
  return result;
}

export function extractJsonLd(html: string): { types: string[]; objects: Record<string, unknown>[] } {
  const types: string[] = [];
  const objects: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if ("@type" in record) {
      const raw = record["@type"];
      types.push(...(Array.isArray(raw) ? raw.map(String) : [String(raw)]));
      objects.push(record);
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      /* ignore broken JSON-LD */
    }
  }
  return { types: [...new Set(types)].sort(), objects };
}

export function extractDates(text: string): string[] {
  return [...text.matchAll(/\b(?:20\d{2})[-/.年](?:0?[1-9]|1[0-2])[-/.月](?:0?[1-9]|[12]\d|3[01])日?\b/g)]
    .map((match) => match[0])
    .slice(0, 20);
}

export function detectChallenge(html: string): { challenged: boolean; marker: string } {
  const head = html.slice(0, 8000).toLowerCase();
  for (const marker of CHALLENGE_MARKERS) {
    if (head.includes(marker.toLowerCase())) return { challenged: true, marker };
  }
  const text = visibleText(html);
  const anchors = (html.match(/<a\s/gi) ?? []).length;
  if (html.length > 20000 && textLength(text) < 120 && anchors < 3) {
    return { challenged: true, marker: "页面体积大但无正文无链接" };
  }
  return { challenged: false, marker: "" };
}

export function csrHeuristic(html: string, visibleChars: number): { suspected: boolean; reason: string } {
  const spaRoot = /id=["'](?:app|root|__next|__nuxt)["']/i.test(html);
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  if (spaRoot && visibleChars < 80 && scriptCount >= 4) {
    return { suspected: true, reason: "首页存在 SPA 根节点、脚本多且原始正文很少" };
  }
  if (visibleChars < 40 && scriptCount >= 6 && html.length > 8000) {
    return { suspected: true, reason: "原始 HTML 几乎没有可读正文，疑似客户端渲染空壳" };
  }
  return { suspected: false, reason: "" };
}

export function pageMetricsFromHtml(html: string, baseUrl: string): {
  title: string;
  metaDescription: string;
  canonical: string;
  h1: string[];
  headingSequence: string[];
  rawVisibleTextCharacters: number;
  mainTextCharacters: number;
  paragraphCount: number;
  longParagraphCount: number;
  listCount: number;
  tableCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  questionHeadingCount: number;
  schemaTypes: string[];
  schemaObjects: Record<string, unknown>[];
  datesFound: string[];
  challenge: boolean;
  challengeMarker: string;
  internalLinks: number;
  csrSuspected: boolean;
  csrReason: string;
} {
  const main = mainHtml(html);
  const headings = extractHeadings(main);
  const paragraphs = extractParagraphs(html);
  const images = imageStats(html);
  const schema = extractJsonLd(html);
  const challenge = detectChallenge(html);
  const rawVisible = textLength(visibleText(html));
  const csr = csrHeuristic(html, rawVisible);
  return {
    title: extractTitle(html),
    metaDescription: extractMetaDescription(html),
    canonical: extractCanonical(html),
    h1: headings.h1,
    headingSequence: headings.sequence,
    rawVisibleTextCharacters: rawVisible,
    mainTextCharacters: textLength(stripTags(main)),
    paragraphCount: paragraphs.length,
    longParagraphCount: paragraphs.filter((item) => item.length > 300).length,
    listCount: countTags(html, "ul") + countTags(html, "ol"),
    tableCount: countTags(html, "table"),
    imageCount: images.imageCount,
    imagesMissingAlt: images.imagesMissingAlt,
    questionHeadingCount: headings.questionHeadingCount,
    schemaTypes: schema.types,
    schemaObjects: schema.objects,
    datesFound: extractDates(visibleText(html)),
    challenge: challenge.challenged,
    challengeMarker: challenge.marker,
    internalLinks: extractLinks(html, baseUrl).length,
    csrSuspected: csr.suspected,
    csrReason: csr.reason,
  };
}

export interface RobotsGroup {
  agents: string[];
  rules: Array<{ type: string; value: string }>;
}

export function parseRobots(text: string): {
  groups: RobotsGroup[];
  globalRootDisallow: boolean;
  botRootDisallow: Record<string, boolean>;
} {
  const groups: RobotsGroup[] = [];
  let currentAgents: string[] = [];
  let currentRules: Array<{ type: string; value: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line || !line.includes(":")) continue;
    const separator = line.indexOf(":");
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (currentRules.length) {
        groups.push({ agents: currentAgents, rules: currentRules });
        currentAgents = [];
        currentRules = [];
      }
      currentAgents.push(value.toLowerCase());
    } else if (["allow", "disallow", "crawl-delay"].includes(key) && currentAgents.length) {
      currentRules.push({ type: key, value });
    }
  }
  if (currentAgents.length) groups.push({ agents: currentAgents, rules: currentRules });

  const rootBlocked = (token: string): boolean => {
    const applicable = groups.filter((group) => group.agents.includes(token.toLowerCase()));
    const used = applicable.length ? applicable : groups.filter((group) => group.agents.includes("*"));
    return used.some((group) => group.rules.some((rule) => rule.type === "disallow" && rule.value.trim() === "/"));
  };

  return {
    groups,
    globalRootDisallow: rootBlocked("*"),
    botRootDisallow: {},
  };
}

export function sitemapLocs(xml: string, root: string): string[] {
  let host = "";
  try {
    host = new URL(root).hostname.toLowerCase();
  } catch {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
    const url = decodeHtmlEntities(match[1].trim());
    try {
      if (new URL(url).hostname.toLowerCase() !== host) continue;
    } catch {
      continue;
    }
    if (!seen.has(url)) {
      seen.add(url);
      found.push(url);
    }
    if (found.length >= 1000) break;
  }
  return found;
}
