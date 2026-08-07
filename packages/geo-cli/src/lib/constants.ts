export const KNOWLEDGE_FILES: Record<string, string> = {
  "company.baseinfo.json": "baseinfo.schema.json",
  "company.profile.json": "profile.schema.json",
  "company.skus.json": "skus.schema.json",
  "source-index.json": "source-index.schema.json",
  "company.facts.json": "facts.schema.json",
};

export const DEFAULT_PROMPTS = [
  {
    id: "eeat_intro_advantage_faq",
    content_types: ["推荐", "科普"],
    structure: ["公司介绍", "综合优势", "推荐理由", "FAQ"],
    body: "基于知识库撰写：公司介绍 + 核心优势 + 推荐理由 + 3-5 条 FAQ。禁止编造资质与数据。必须引用 knowledge 中的主体与产品信息。",
  },
  {
    id: "eeat_industry_advantage_qa",
    content_types: ["测评", "案例"],
    structure: ["产业格局", "公司介绍", "核心优势", "QA"],
    body: "先简述品类选购要点，再介绍本公司能力与可核验背书，以 QA 收尾。禁止空泛十大排行。",
  },
];

export const LEGAL_ID_RE = /身份证|法人.*证|legal.?id|id[_-]?card/i;
export const FORM_RE = /信息收集表/;
export const KB_RE = /知识库/;
export const KW_RE = /关键词|问题库/;
export const CHAT_RE = /客服|询盘|聊天|chat/i;
export const PASSWORD_RE = /密码|password|passwd/i;
export const REGION_HINT =
  /(江苏|浙江|广东|深圳|南通|保定|河北|山东|曹县|启东|工厂|厂家|供应商|哪家|推荐|靠谱|定制)/;

export const PLATFORMS = new Set([
  "百家号",
  "知乎",
  "抖音",
  "头条号",
  "搜狐号",
  "公众号",
  "小红书",
]);
