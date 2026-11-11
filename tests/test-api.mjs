import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../functions/api/analyze.js', import.meta.url), 'utf8');
const { onRequestPost } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
const image = 'data:image/jpeg;base64,AAAA';
function request(data = { image }, code = '') {
  return new Request('https://example.pages.dev/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Code': code },
    body: JSON.stringify(data)
  });
}
function upstream(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
async function check(req, env) {
  const res = await onRequestPost({ request: req, env });
  return [res.status, await res.json()];
}

let calls = 0;
globalThis.fetch = async (url, init) => {
  calls++;
  assert.equal(url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  const data = JSON.parse(init.body);
  assert.equal(data.model, 'qwen3-vl-flash');
  assert.equal(data.response_format.type, 'json_object');
  assert.equal(data.messages[1].content[1].image_url.url, image);
  assert.equal(init.headers.Authorization, 'Bearer sk-test');
  return upstream(200, { choices: [{ message: { content: '{"is_food":true,"items":[{"name":"鸡胸肉","grams":80,"kcal":132},{"name":"米饭","grams":150,"kcal":174}]}' } }] });
};
{
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-test' });
  assert.equal(status, 200);
  assert.equal(data.total_kcal, 306);
  assert.equal(data.items.length, 2);
  assert.equal(calls, 1);
}
{
  const [status] = await check(request(), {});
  assert.equal(status, 503);
}
{
  const [status] = await check(request(), { DASHSCOPE_API_KEY: 'sk-test', SITE_ACCESS_CODE: '1234' });
  assert.equal(status, 403);
}
{
  const [status] = await check(request({ image: 'bad-image' }), { DASHSCOPE_API_KEY: 'sk-test' });
  assert.equal(status, 400);
}
{
  globalThis.fetch = async () => upstream(429, {error: {message:'rate limited'}});
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-test' });
  assert.equal(status, 429);
  assert.match(data.error, /频繁/);
}
{
  globalThis.fetch = async () => upstream(200, { choices: [{ message: { content: '{"is_food":false,"items":[]}' } }] });
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-test' });
  assert.equal(status, 200);
  assert.equal(data.is_food, false);
}
{
  globalThis.fetch = async () => upstream(200, { choices: [{ message: { content: 'invalid json' } }] });
  const [status, data] = await check(request(), { DASHSCOPE_API_KEY: 'sk-test' });
  assert.equal(status, 502);
  assert.match(data.error, /格式异常/);
}
console.log('All 7 API tests passed');
