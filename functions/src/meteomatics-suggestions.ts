import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { CONFIG } from './config.constant';
import { METEOMATICS_SUGGESTIONS_PROMPT } from './meteomatics-suggestions.constant';

const schema = z.object({ suggestions: z.array(z.string()) });
const ai = genkit({ plugins: [vertexAI({ projectId: CONFIG.projectId, location: CONFIG.vertexLocation })] });

export async function generateMeteomaticsSuggestions(): Promise<string[]> {
  const response = await ai.generate({ model: vertexAI.model(CONFIG.geminiModel), config: { maxOutputTokens: 2048 }, output: { schema }, system: METEOMATICS_SUGGESTIONS_PROMPT, prompt: `Today is ${new Date().toISOString().slice(0, 10)}. Generate the examples.` });
  const suggestions = response.output?.suggestions.map(item => item.trim()).filter(item => item.length >= 20 && item.length <= 250) ?? [];
  const unique = [...new Set(suggestions)];
  if (unique.length < 3) throw new Error('Suggestions are unavailable.');
  return unique.slice(0, 3);
}
