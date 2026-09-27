// Where the invented service keeps its rows.
import { createClient } from '@supabase/supabase-js';

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function saveLead(lead) {
  const { data, error } = await client.from('leads').insert(lead).select().single();
  if (error !== null) console.error('insert failed', error);
  return data;
}
