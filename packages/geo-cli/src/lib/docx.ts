import JSZip from "jszip";
import { readFile } from "node:fs/promises";

export async function docxPlainText(docxPath: string): Promise<string> {
  const buf = await readFile(docxPath);
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");
  const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  return texts.join("");
}

export function splitProfileSections(text: string): {
  intro: string;
  products_services: string;
  advantages: string;
  trust: string;
} {
  const t = text.replace(/\r/g, "");
  const patterns: [keyof ReturnType<typeof splitProfileSections>, RegExp][] = [
    ["intro", /一[、．.].*?公司介绍/],
    ["products_services", /二[、．.].*?(产品|服务)/],
    ["advantages", /三[、．.].*?(优势|核心)/],
    ["trust", /四[、．.].*?(信任|背书|资质)/],
  ];

  const starts: { key: keyof ReturnType<typeof splitProfileSections>; pos: number }[] = [];
  for (const [key, pat] of patterns) {
    const m = t.match(pat);
    if (m?.index != null) starts.push({ key, pos: m.index });
  }

  if (starts.length === 0) {
    for (const [key, label] of [
      ["intro", "公司介绍"],
      ["products_services", "产品服务"],
      ["products_services", "核心产品"],
      ["advantages", "产品优势"],
      ["advantages", "核心优势"],
      ["trust", "信任背书"],
    ] as const) {
      const idx = t.indexOf(label);
      if (idx >= 0) starts.push({ key, pos: idx });
    }
  }

  starts.sort((a, b) => a.pos - b.pos);
  const uniqueStarts: typeof starts = [];
  const seenKeys = new Set<string>();
  for (const s of starts) {
    if (!seenKeys.has(s.key)) {
      seenKeys.add(s.key);
      uniqueStarts.push(s);
    }
  }

  const sections = {
    intro: "",
    products_services: "",
    advantages: "",
    trust: "",
  };

  if (uniqueStarts.length === 0) {
    sections.intro = t.slice(0, 2000);
    return sections;
  }

  for (let i = 0; i < uniqueStarts.length; i++) {
    const { key, pos } = uniqueStarts[i];
    const end = i + 1 < uniqueStarts.length ? uniqueStarts[i + 1].pos : t.length;
    let chunk = t.slice(pos, end).trim();
    if (chunk.slice(0, 40).includes("\n")) {
      chunk = chunk.replace(/^.*?[\n：:]/, "");
    }
    sections[key] = sections[key] ? `${sections[key]}\n${chunk}` : chunk;
  }

  const header = t.slice(0, uniqueStarts[0].pos).trim();
  if (header && sections.intro.length < 80) {
    sections.intro = `${header}\n${sections.intro}`.trim();
  }

  return sections;
}
