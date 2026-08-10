import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { diagnosisApiInternals } from "../lib/diagnosis-api.js";

test("OpenAI-compatible probe adapter sends an exact question and reads answer text", async () => {
  let requestBody = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf-8");
    request.on("data", (chunk) => { requestBody += chunk; });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "推荐测试品牌，并建议核验来源 https://example.com/evidence" } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  process.env.TEST_PROBE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.TEST_PROBE_API_KEY = "test-only-key";
  process.env.TEST_PROBE_MODEL = "test-model";
  try {
    const result = await diagnosisApiInternals.callOpenAICompatible({ id: "test", provider: "local", adapter: "openai-compatible", base_url_env: "TEST_PROBE_BASE_URL", api_key_env: "TEST_PROBE_API_KEY", model_env: "TEST_PROBE_MODEL" }, "哪个品牌值得推荐？");
    assert.equal(result.model, "test-model");
    assert(result.answer.includes("测试品牌"));
    assert.equal(JSON.parse(requestBody).messages[1].content, "哪个品牌值得推荐？");
  } finally {
    delete process.env.TEST_PROBE_BASE_URL;
    delete process.env.TEST_PROBE_API_KEY;
    delete process.env.TEST_PROBE_MODEL;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
