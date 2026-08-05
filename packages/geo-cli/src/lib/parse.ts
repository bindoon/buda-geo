import path from "node:path";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { PASSWORD_RE, PLATFORMS, REGION_HINT } from "./constants.js";
import { cellStr, uniq } from "./util.js";

export interface BaseInfo {
  app_id: string;
  company_name: string;
  company_short_name: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  website_or_shop_url: string;
  region: string;
  media_accounts: { platform: string; account_id: string }[];
  conversion: { phone?: string; shop_url?: string };
  credentials: unknown[];
  source?: string;
}

export function readXlsxRows(xlsxPath: string): string[][] {
  const buf = readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  return rows.map((row) => (Array.isArray(row) ? row.map(cellStr) : []));
}

export function parseInfoForm(
  xlsxPath: string,
  appId: string,
): { baseinfo: BaseInfo; warnings: string[] } {
  const warnings: string[] = [];
  const rows = readXlsxRows(xlsxPath);
  const flat: Record<string, string> = {};
  const media: { platform: string; account_id: string }[] = [];

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      if (!cell) continue;
      const nxt = row[i + 1] ?? "";
      if (
        ["公司名称", "公司简称", "联系人", "联系方式", "公司地址"].includes(cell) &&
        nxt
      ) {
        flat[cell] = nxt;
      }
      if (cell.includes("官网") || cell.includes("店铺")) {
        if (nxt) flat.website_or_shop_url = nxt;
      }
      if (PLATFORMS.has(cell)) {
        const raw = nxt;
        if (PASSWORD_RE.test(raw) || raw.includes("密码")) {
          warnings.push(`password_stripped:${cell}`);
        }
        let accountId = raw.replace(/密码[：:].*/g, "");
        accountId = accountId.replace(/\s+/g, " ").trim().replace(/^[;；]+|[;；]+$/g, "");
        if (accountId) media.push({ platform: cell, account_id: accountId.slice(0, 200) });
      }
    }

    if (row.length >= 4 && row[0] === "公司名称") {
      flat["公司名称"] = row[1];
      if (row[2] === "公司简称") flat["公司简称"] = row[3];
    }
    if (row.length >= 4 && row[0] === "联系人") {
      flat["联系人"] = row[1];
      if (row[2]?.includes("联系方式")) flat["联系方式"] = row[3];
    }
    if (row.length >= 2 && row[0].startsWith("公司官网")) {
      flat.website_or_shop_url = row[1] || flat.website_or_shop_url || "";
    }
    if (row.length >= 2 && row[0] === "公司地址") {
      flat["公司地址"] = row[1];
      if (row[2] && !row[2].startsWith("其他")) flat.region = row[2];
    }
  }

  const baseinfo: BaseInfo = {
    app_id: appId,
    company_name: flat["公司名称"] ?? "",
    company_short_name: flat["公司简称"] ?? "",
    contact_name: flat["联系人"] ?? "",
    contact_phone: flat["联系方式"] ?? "",
    address: flat["公司地址"] ?? "",
    website_or_shop_url: flat.website_or_shop_url ?? "",
    region: flat.region ?? "",
    media_accounts: media,
    conversion: {
      phone: flat["联系方式"] ?? "",
      shop_url: flat.website_or_shop_url ?? "",
    },
    credentials: [],
    source: `xlsx:${path.basename(xlsxPath)}`,
  };

  return { baseinfo, warnings };
}

function looksLikeQuestion(val: string): boolean {
  return (
    /[吗麼呢？?]|哪家|哪些|怎么|如何|推荐|靠谱|有哪些|供应商/.test(val) ||
    val.length > 24
  );
}

export interface KeywordsJson {
  app_id: string;
  brand: { terms: string[]; questions: string[] };
  search: { terms: string[]; expanded: string[]; questions: string[] };
  qa: { questions: string[] };
  intent: { questions: string[] };
  source: string;
}

export function parseKeywords(xlsxPath: string, appId: string): KeywordsJson {
  const rows = readXlsxRows(xlsxPath);
  const searchTerms: string[] = [];
  const expanded: string[] = [];
  const qa: string[] = [];
  const intent: string[] = [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const joined = rows[i].join("");
    if (joined.includes("关键词") || joined.includes("问题")) {
      headerIdx = i;
      break;
    }
  }

  const header = rows[headerIdx] ?? [];
  const colRoles: string[] = header.map((h) => {
    if (h === "关键词" || h === "关键字") return "term";
    if (h.includes("拓展")) return "expanded";
    if (h.includes("问题")) return "question";
    return "other";
  });

  const skipVal = new Set(["问题", "关键词", "拓展词", "序号"]);

  const addQuestion = (val: string) => {
    if (!val || skipVal.has(val) || /^\d+$/.test(val)) return;
    if (REGION_HINT.test(val)) intent.push(val);
    else qa.push(val);
  };

  const addTerm = (val: string, bucket: string[]) => {
    if (!val || skipVal.has(val) || /^\d+$/.test(val)) return;
    if (looksLikeQuestion(val)) {
      addQuestion(val);
      return;
    }
    if (!bucket.includes(val)) bucket.push(val);
  };

  if (colRoles.filter((r) => r === "term").length === 0) {
    for (const row of rows.slice(headerIdx + 1)) {
      for (let i = 0; i < row.length; i += 2) {
        const term = row[i] ?? "";
        const q = row[i + 1] ?? "";
        if (term) addTerm(term, searchTerms);
        if (q) addQuestion(q);
      }
    }
  } else {
    for (const row of rows.slice(headerIdx + 1)) {
      for (let i = 0; i < colRoles.length; i++) {
        const role = colRoles[i];
        const val = row[i];
        if (!val) continue;
        if (role === "term") addTerm(val, searchTerms);
        else if (role === "expanded") addTerm(val, expanded);
        else if (role === "question") addQuestion(val);
      }
    }
  }

  return {
    app_id: appId,
    brand: { terms: [], questions: [] },
    search: { terms: uniq(searchTerms), expanded: uniq(expanded), questions: [] },
    qa: { questions: uniq(qa) },
    intent: { questions: uniq(intent) },
    source: `xlsx:${path.basename(xlsxPath)}`,
  };
}
