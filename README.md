# AI 起名平台

输入起名需求 → 选择大模型 → SSE 流式输出 3 组名字与寓意 → 自动存入 Supabase → 部署在 Vercel。
一套代码支持豆包 / DeepSeek / 通义千问 / Kimi 四家，加新模型只改配置。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | 原生 HTML + JS | 无框架、无构建，Vercel 直接托管 |
| 后端 | Vercel Serverless（Node 18+） | `api/name.js` 负责转发流式请求 |
| 模型 | OpenAI 兼容接口 | 四家都走 `/v1/chat/completions` |
| 存储 | Supabase（Postgres） | 起名历史 |

## 目录结构

```
ai-naming-platform/
├── api/
│   ├── name.js          # 起名接口：转发 SSE 流 + 写历史
│   └── history.js       # 历史记录查询
├── index.html           # 单页前端
├── supabase/schema.sql  # 建表 + RLS 策略
├── .env.example         # 环境变量模板
├── vercel.json          # 函数超时配置
└── .gitignore           # 确保 .env 不被提交
```

## 本地运行

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# 编辑 .env，填入 Supabase 与至少一个大模型的密钥
npx vercel dev            # 或 npm run dev
```

打开 http://localhost:3000 ，输入需求测试。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 是 | 形如 `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | 是 | `eyJ...` 开头的 anon public key |
| `DOUBAO_API_KEY` | 四选一 | 火山方舟密钥 |
| `DOUBAO_MODEL` | 用豆包时必填 | 推理接入点 ID `ep-2026xxxx-xxxxx`，或模型 ID `doubao-seed-1-6-250615` |
| `DOUBAO_BASE_URL` | 否 | 默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `DEEPSEEK_API_KEY` | 四选一 | DeepSeek 密钥 |
| `QWEN_API_KEY` | 四选一 | 阿里云百炼 / DashScope 密钥 |
| `KIMI_API_KEY` | 四选一 | 月之暗面密钥 |

没配 Supabase 也能跑，只是历史记录不保存（接口会返回 `saved: false`）。

## 部署到 Vercel

1. 推送到 GitHub（`.env` 已被 `.gitignore` 排除）
2. Vercel → Add New → Project → 导入仓库
3. Framework Preset 选 **Other**，Build Command 留空，Output Directory 留空
4. **Environment Variables** 里把 `.env` 的内容逐条加进去
5. Deploy，拿到 `xxx.vercel.app`

## 关键实现说明

**为什么一套代码能调四家模型？**
豆包、DeepSeek、Kimi、通义千问（compatible-mode）都提供 OpenAI 兼容网关，
`messages`、`stream: true`、SSE 分片结构、`Authorization: Bearer xxx` 鉴权头完全一致，
差异只有 `baseURL`、`apiKey`、`model` 三个值——正好就是 `modelConfigMap` 里的三个字段。

**流式怎么实现的？**
后端拿上游的 `ReadableStream`，按空行切分 SSE 事件，取出 `choices[0].delta.content`，
再原样以 `data: {"delta":"..."}` 写给浏览器；前端用 `fetch` + `getReader()` 边读边渲染。

**密钥安全**
所有密钥只从 `process.env` 读取；`.env` 在 `.gitignore` 里；Vercel 上用 Environment Variables 注入。
