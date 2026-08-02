import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.ts';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export const MODEL = env.ANTHROPIC_MODEL;

/** Concatène les blocs texte d'une réponse Messages API. */
export function textFromResponse(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}
