import { Router } from 'express';
import { z } from 'zod';
import { parse, wrap } from '../lib/http';
import { requirePerm } from '../middleware/auth';
import { audit } from '../services/audit';
import { ask } from '../services/assistant';

export const assistantRouter = Router();
assistantRouter.post('/ask', requirePerm('ai:use'), wrap(async (req, res) => {
  const b = parse(z.object({ question: z.string().trim().min(2, 'Type a question.').max(300) }), req.body);
  const out = await ask(req.user!, b.question);
  await audit(req, { action: 'ASSISTANT_ASKED', entityType: 'ASSISTANT', entityLabel: `${out.intent}: ${b.question.slice(0, 80)}` });
  res.json({ ...out, notice: 'Demo assistant: answers come from live data using built-in rules, not a language model.' });
}));
