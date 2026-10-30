/**
 * GET /api/history?limit=20
 * 返回最近的起名历史，按创建时间倒序。
 */
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key || url.includes('xxxxxxxx')) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(200).json({ success: true, data: [], note: '未配置 Supabase，历史记录功能已降级' });
  }

  const limit = Math.min(Number(req.query?.limit) || 20, 50);

  try {
    const { data, error } = await supabase
      .from('name_history')
      .select('id, user_requirement, name_result, model_name, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    return res.status(200).json({ success: true, data: data || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
