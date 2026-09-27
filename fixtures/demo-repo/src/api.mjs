// The HTTP surface of an invented service.
import Stripe from 'stripe';
import pino from 'pino';

import { saveLead } from '../store/db.mjs';
import { announce } from '../notify/slack.mjs';

const logger = pino();
const stripe = new Stripe(process.env.SK_EXAMPLE);

// A plugin loaded from a computed specifier. Text extraction cannot follow this, and the report
// says so instead of pretending the edge does not exist.
const loadScorer = async (name) => import(`./scorers/${name}.mjs`);

app.get('/health', (request, response) => response.send('ok'));

app.post('/lead', requireAuth, async (request, response) => {
  if (request.headers.authorization === undefined) return response.status(401).send();

  const scorer = await loadScorer(process.env.SCORER_NAME);
  const saved = await saveLead(request.body, scorer);
  await announce(saved);

  return response.json(saved);
});

app.post('/charge', requireAuth, async (request, response) => {
  const secret = process.env.KITELINE_WEBHOOK_SECRET;
  try {
    await stripe.charges.create({ amount: request.body.amount });
  } catch (error) {
    logger.error({ error, secretPresent: secret !== undefined }, 'charge failed');
    console.error('charge failed', error);
  }
  return response.status(202).send();
});

setInterval(() => saveLead({ kind: 'heartbeat' }), 60000);
