/**
 * POST /api/name
 * 请求体：{ requirement: string, model: 'doubao' | 'deepseek' | 'qwen' | 'kimi' }
 * 响应：SSE 流式输出，每个分片形如  data: {"delta":"张"}
 *       结束时              data: {"done":true,"saved":true}
 *       出错时              data: {"error":"..."}
 *
 * 设计要点：
 * 1. 四家平台都提供 OpenAI 兼容接口（/v1/chat/completions），
 *    入参、SSE 分片格式、鉴权头完全一致，所以只需要一份 fetch 代码。
 * 2. 差异全部收敛到 modelConfigMap：baseURL / apiKey / model 三个字段。
 *    以后加新模型 = 加一条配置，主调用代码一行都不用改。
 * 3. 密钥只从环境变量读，代码里不出现任何明文。
 */
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

/** 模型配置表：唯一需要维护的地方 */
export const modelConfigMap = {
  doubao: {
    label: '豆包（火山方舟）',
    // 注意：方舟的 OpenAI 兼容地址是 /api/v3，网上很多老教程写 /api/v1 会 404
    baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: process.env.DOUBAO_API_KEY || '',
    // 两种写法都行：推理接入点 ID（ep-2026xxxx-xxxxx）或模型 ID（doubao-seed-1-6-250615）
    model: process.env.DOUBAO_MODEL || '',
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: 'deepseek-chat',
  },
  qwen: {
    label: '通义千问',
    // 注意：必须用 compatible-mode 这个地址，普通 dashscope 地址不兼容 OpenAI 协议
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.QWEN_API_KEY || '',
    model: 'qwen-plus',
  },
  kimi: {
    label: 'Kimi（月之暗面）',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKey: process.env.KIMI_API_KEY || '',
    model: 'moonshot-v1-8k',
  },
};

const SYSTEM_PROMPT = `你是一位资深的中文起名顾问，精通姓名学、古典文学与现代审美。
请根据用户给出的需求（姓氏、性别、风格、寓意偏好等），给出 3 组名字方案。

输出格式（严格遵守，使用 Markdown）：
## 方案一
- **名字**：XXX
- **寓意**：2~3 句话，说明出处（诗句/典籍）与字义
- **风格**：一句话概括

## 方案二
（同上）

## 方案三
（同上）

要求：每组取两个或三个字，读音顺口、避免生僻字和谐音歧义；寓意解释要具体，不要空泛。`;

/** supabase 客户端（未配置时返回 null，功能降级为「不保存历史」） */
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key || url.includes('xxxxxxxx')) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed，请用 POST' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const requirement = String(body.requirement || '').trim().slice(0, 500);
  const modelKey = String(body.model || 'doubao').trim();

  if (!requirement) {
    return res.status(400).json({ error: '请先填写起名需求' });
  }

  const cfg = modelConfigMap[modelKey];
  if (!cfg) {
    return res.status(400).json({ error: `不支持的模型：${modelKey}` });
  }
  if (!cfg.apiKey) {
    return res.status(400).json({ error: `模型「${cfg.label}」的 API Key 未配置，请检查环境变量` });
  }
  if (!cfg.model) {
    return res.status(400).json({
      error: `模型「${cfg.label}」未指定 model：豆包请填推理接入点 ID（ep-2026xxxx-xxxxx）到 DOUBAO_MODEL`,
    });
  }

  // ---- 建立 SSE 通道 ----
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 让 Vercel / Nginx 不要缓冲
  res.write(': connected\n\n');

  const startedAt = Date.now();
  let fullText = '';
  let finished = false;

  try {
    const upstream = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        temperature: 0.9,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: requirement },
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      send(res, {
        error: `上游模型返回 ${upstream.status}：${errText.slice(0, 300) || '无响应体'}`,
      });
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE 事件之间用空行分隔，把 \r\n 统一成 \n 再切
      buffer = buffer.replace(/\r\n/g, '\n');
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 心跳或半包，跳过
          }

          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            send(res, { delta });
          }
        }
      }

      if (res.writableEnded) break; // 客户端已断开
    }

    finished = true;
    const saved = await saveHistory(requirement, fullText, cfg.model);
    send(res, { done: true, saved, model: cfg.model, costMs: Date.now() - startedAt });
    res.end();
  } catch (err) {
    if (!finished) {
      send(res, { error: `调用失败：${err.message || err}` });
      res.end();
    }
  }
}

/** 把这一次的起名记录写进 Supabase；失败不影响流式结果 */
async function saveHistory(userRequirement, nameResult, modelName) {
  if (!nameResult.trim()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;

  try {
    const { error } = await supabase.from('name_history').insert({
      user_requirement: userRequirement,
      name_result: nameResult,
      model_name: modelName,
    });
    if (error) {
      console.error('[supabase] insert failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[supabase] exception:', e.message);
    return false;
  }
}

function safeJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
