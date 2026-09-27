// Added after the map was written, which is the whole point of this file.
import OpenAI from 'openai';

const ai = new OpenAI({ apiKey: process.env.OPENAI_KEY_EXAMPLE });

export async function explainInvoice(invoice) {
  const summary = await ai.chat.completions.create({ model: 'invented-model', messages: [] });
  await fetch('https://ledger.example.com/v1/entries', { method: 'POST', body: JSON.stringify(invoice) });
  return summary;
}
