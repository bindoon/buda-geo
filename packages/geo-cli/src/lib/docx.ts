import JSZip from "jszip";
import { readFile } from "node:fs/promises";

/** Extract plain text; keep paragraph breaks so section headings stay findable. */
export async function docxPlainText(docxPath: string): Promise<string> {
  const buf = await readFile(docxPath);
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");
  // Split on paragraph ends so "公司介绍" / "信任背书" don't glue to next sentence.
  const paras = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const para of paras) {
    const texts = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    const line = texts.join("").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export interface ProfileSections {
  intro: string;
  products_services: string;
  advantages: string;
  trust: string;
  pain_points: string[];
}

/** Heading → profile field. Order matters when scanning top-to-bottom. */
const SECTION_LABELS: { key: keyof Omit<ProfileSections, "pain_points"> | "pain_points"; labels: string[] }[] = [
  { key: "intro", labels: ["公司介绍", "企业简介", "品牌故事", "关于我们"] },
  {
    key: "products_services",
    labels: ["产品服务", "核心产品", "产品与服务", "主营产品"],
  },
  {
    key: "advantages",
    labels: [
      "核心优势",
      "产品核心优势",
      "产品优势",
      "产品特点",
      "工厂供应链优势",
      "工厂供应链",
      "全链条服务优势",
      "产品差异化优势",
      "市场销售优势",
      "服务优势",
    ],
  },
  {
    key: "trust",
    labels: ["信任背书", "资质认证", "客户案例", "合作案例", "客户口碑"],
  },
  { key: "pain_points", labels: ["用户痛点", "客户痛点", "行业痛点"] },
];

/** Contact / CTA belong in baseinfo — strip from profile body. */
const CONTACT_LEAK_RE =
  /联系我们[：:]?[^\n]*|联系店铺[：:]?[^\n]*|联系人[：:][^\n]*|地址[：:][^\n]*|电话[：:]?\s*\d[\d\s/-]{6,}|手机[：:]?\s*\d[\d\s/-]{6,}|优化关键词[：:][^\n]*|(?:1688|店铺|官网)?(?:网址|链接)[：:]?\s*https?:\/\/\S+|https?:\/\/(?:shop|detail|jm)\S+/gi;

export function stripContactLeak(text: string): string {
  return text
    .replace(CONTACT_LEAK_RE, "")
    .replace(/(?:^|\n)\s*公司\s*(?=\n|$)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findLabelHits(text: string): { key: string; pos: number; labelLen: number }[] {
  const hits: { key: string; pos: number; labelLen: number }[] = [];
  for (const { key, labels } of SECTION_LABELS) {
    for (const label of labels) {
      let from = 0;
      while (from < text.length) {
        const idx = text.indexOf(label, from);
        if (idx < 0) break;
        // Prefer label at line start or after punctuation / numbered prefix
        const before = idx === 0 ? "" : text[idx - 1]!;
        const ok =
          idx === 0 ||
          before === "\n" ||
          /[、．.：:\s]/.test(before) ||
          /[一二三四五六七八九十]/.test(before);
        if (ok) {
          hits.push({ key, pos: idx, labelLen: label.length });
        }
        from = idx + label.length;
      }
    }
  }
  hits.sort((a, b) => a.pos - b.pos || b.labelLen - a.labelLen);
  // Keep earliest hit per key; also allow multiple trust/pain chunks to merge later
  const out: typeof hits = [];
  const seenAt = new Set<number>();
  for (const h of hits) {
    // skip overlapping positions
    if ([...seenAt].some((p) => Math.abs(p - h.pos) < 2)) continue;
    seenAt.add(h.pos);
    out.push(h);
  }
  return out;
}

export function splitProfileSections(text: string): ProfileSections {
  const t = text.replace(/\r/g, "").trim();
  const empty: ProfileSections = {
    intro: "",
    products_services: "",
    advantages: "",
    trust: "",
    pain_points: [],
  };
  if (!t) return empty;

  // Numbered outline: 一、公司介绍 / 二、产品服务 …
  const numbered: { key: string; pos: number }[] = [];
  const numMap: [string, RegExp][] = [
    ["intro", /(?:^|\n)\s*[一二三四五六七八九十]?[、．.]\s*(?:公司介绍|企业简介)/g],
    ["products_services", /(?:^|\n)\s*[一二三四五六七八九十]?[、．.]\s*(?:产品服务|核心产品|产品与服务)/g],
    ["advantages", /(?:^|\n)\s*[一二三四五六七八九十]?[、．.]\s*(?:产品核心优势|核心优势|产品优势|产品特点|服务优势|全链条服务)/g],
    ["trust", /(?:^|\n)\s*[一二三四五六七八九十]?[、．.]\s*(?:信任背书|资质|客户案例)/g],
    ["pain_points", /(?:^|\n)\s*[一二三四五六七八九十]?[、．.]\s*(?:用户痛点|客户痛点|行业痛点)/g],
  ];
  for (const [key, pat] of numMap) {
    for (const m of t.matchAll(pat)) {
      if (m.index != null) numbered.push({ key, pos: m.index });
    }
  }

  const hits = findLabelHits(t);
  const starts =
    numbered.length >= 2
      ? numbered
      : hits.map((h) => ({ key: h.key, pos: h.pos }));

  if (starts.length === 0) {
    empty.intro = stripContactLeak(t.slice(0, 2000));
    return empty;
  }

  starts.sort((a, b) => a.pos - b.pos);

  const buckets: Record<string, string[]> = {
    intro: [],
    products_services: [],
    advantages: [],
    trust: [],
    pain_points: [],
  };

  for (let i = 0; i < starts.length; i++) {
    const { key, pos } = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]!.pos : t.length;
    let chunk = t.slice(pos, end).trim();
    // Drop the heading line itself when it is a short label-only first line
    chunk = chunk.replace(/^[^\n]{0,40}\n/, (first) => {
      const body = first.replace(/\n$/, "");
      return SECTION_LABELS.some((s) => s.labels.some((l) => body.includes(l)))
        ? ""
        : first;
    });
    // Also strip leading "公司介绍" glued without newline
    for (const { labels } of SECTION_LABELS) {
      for (const label of labels) {
        if (chunk.startsWith(label)) {
          chunk = chunk.slice(label.length).replace(/^[\s：:]+/, "");
          break;
        }
      }
    }
    chunk = stripContactLeak(chunk);
    if (!chunk) continue;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(chunk);
  }

  // Preamble before first heading → intro if thin
  const header = stripContactLeak(t.slice(0, starts[0]!.pos));
  if (header.length >= 40) {
    buckets.intro.unshift(header);
  }

  const join = (parts: string[]) =>
    stripContactLeak([...new Set(parts.map((p) => p.trim()).filter(Boolean))].join("\n\n"));

  const painText = join(buckets.pain_points ?? []);
  const pain_points = painText
    ? painText
        .split(/[；;\n]+/)
        .map((s) => s.replace(/^[\d一二三四五六七八九十]、\s*/, "").trim())
        .filter((s) => s.length >= 8)
        .slice(0, 12)
    : [];

  return {
    intro: join(buckets.intro ?? []),
    products_services: join(buckets.products_services ?? []),
    advantages: join(buckets.advantages ?? []),
    trust: join(buckets.trust ?? []),
    pain_points,
  };
}
