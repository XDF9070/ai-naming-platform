/**
 * GET /api/models
 * 返回四个模型的可用状态，前端据此禁用没配密钥的选项。
 * 只暴露「有没有配」，不暴露任何密钥内容。
 */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const list = [
    { key: 'doubao', label: '豆包（火山方舟）', available: Boolean(process.env.DOUBAO_API_KEY && process.env.DOUBAO_MODEL) },
    { key: 'deepseek', label: 'DeepSeek', available: Boolean(process.env.DEEPSEEK_API_KEY) },
    { key: 'qwen', label: '通义千问', available: Boolean(process.env.QWEN_API_KEY) },
    { key: 'kimi', label: 'Kimi（月之暗面）', available: Boolean(process.env.KIMI_API_KEY) },
  ];
  return res.status(200).json({ models: list });
}
