# 拍照算热量 · Cloudflare Pages + Qwen3-VL-Flash

手机拍照 / 相册选图 → 确认并分析 → 输出「食物、估算克数、估算 kcal、合计热量」。

## 项目结构

```text
food-calorie-pages/
├── public/
│   ├── index.html     # 手机页面
│   ├── style.css
│   ├── app.js         # 图片压缩 + 上传 + 渲染
│   └── _headers       # 安全响应头
├── functions/
│   └── api/analyze.js # Cloudflare Pages Function, 调用阿里云百炼
├── .dev.vars.example  # 本地密钥示例（不包含真实密钥）
└── .gitignore
```

## API Key 填写在哪里？

**不要在 HTML 中填写，也不要把 Key 直接写进任何前端 JavaScript。**

部署到 Cloudflare 后：Workers & Pages → 选择你的 Pages 项目 → Settings → Variables and Secrets（或者 Environment variables）→ 添加：

- 名称：`DASHSCOPE_API_KEY`
- 类型：**Secret / Encrypt**
- 值：阿里云百炼【北京地域】的 API Key
- 环境：Production（如果需要预览版，Preview 也要配置）

也可以用 `npx wrangler pages secret put DASHSCOPE_API_KEY --project-name food-calorie-mini` 配置。

目前默认模型：`qwen3-vl-flash`，默认 API 地址：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`（阿里云北京地域兼容接口）。这两个常量在 `functions/api/analyze.js` 文件顶部。

如果使用**新加坡等其他地域**，需要按照该地域的百炼 API 文档更换 API_URL，并配套使用该地域的 API Key。

## 推荐部署步骤（无需单独购买服务器）

前提：安装 Node.js LTS，并有 Cloudflare 账号及阿里云百炼 API Key。

1. 解压整个项目，**进入解压出来的 `food-calorie-pages` 项目文件夹**。
2. 终端登录 Cloudflare：

   ```bash
   npx wrangler login
   ```

3. 创建 Pages 项目（项目名可自行更换，下文保持一致）：

   ```bash
   npx wrangler pages project create food-calorie-mini
   ```

4. 在终端安全地录入 API Key（命令执行后按提示输入，不必直接写到命令历史）：

   ```bash
   npx wrangler pages secret put DASHSCOPE_API_KEY --project-name food-calorie-mini
   ```

5. 部署（必须在项目根目录执行；此时同层必须有 `functions` 和 `public` 文件夹）：

   ```bash
   npx wrangler pages deploy public --project-name food-calorie-mini
   ```

6. 打开 Cloudflare 给出的 `.pages.dev` 地址，用手机访问即可。

**注意：控制台直接拖拽 ZIP 或 public 文件夹无法自动编译本项目的 `functions/` 接口。请用 Wrangler（如上）或 Git 仓库部署。**

## 本地测试（可选）

1. 把 `.dev.vars.example` 复制成 `.dev.vars`，填入你的真实北京地域 Key。
2. 在项目根目录执行：

   ```bash
   npx wrangler pages dev public
   ```

3. 打开终端提示的本地 URL，拍照或选图、确认分析即可。

`.dev.vars` 在 `.gitignore` 中，不要提交到 Git 仓库、分享或截图。网页不直接读取 Key。

## 可选的访问码保护

如果你只想自己或几个朋友试用，建议加一个简单访问码，避免公开网站被人随意消耗付费 API：

```bash
npx wrangler pages secret put SITE_ACCESS_CODE --project-name food-calorie-mini
```

前端页面底部展开「访问设置」，输入相同访问码即可。**此方式只适合小范围测试**；公开商业网站需要再接入登录鉴权、Cloudflare Turnstile、限流和每用户配额。

## 备注

- 图片会在浏览器内压缩到最长边 1600 px、JPEG 质量约 83%，上传后由 Function 转发给阿里云 AI；**本项目不会把图片或识别结果写入数据库或 OSS**。
- 模型仅根据照片估算重量和卡路里，无法精确称重、判断隐藏配料或烹饪用油；不是医疗或营养诊断工具。
- API 调用费按阿里云百炼实际 Token 使用量产生；Cloudflare Pages/Functions 用量取决于你的套餐。
- 若遇到 405 或返回 HTML，通常是只部署了静态文件而没部署 `functions/`。

## 参考文档

- 阿里云 OpenAI 兼容接口：https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- 阿里云结构化 JSON 输出：https://help.aliyun.com/zh/model-studio/qwen-structured-output
- Cloudflare Pages Functions：https://developers.cloudflare.com/pages/functions/get-started/
- Wrangler Pages 部署：https://developers.cloudflare.com/workers/wrangler/commands/pages/
