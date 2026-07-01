/**
 * ApexLens - Groq AI Service
 * Uses the user's Groq API key to generate actionable insights from parsed logs.
 */

export class GroqAIService {
  constructor(apiKey, model = 'llama-3.1-8b-instant') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Add your Groq API key in Settings first.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: options.maxTokens || 700,
          messages: [
            {
              role: 'system',
              content: 'You are ApexLens AI, a helpful Salesforce Apex debugging assistant. Answer clearly, briefly, and specifically. Prefer practical advice over generic explanations. Always frame suggestions for Salesforce Apex and use Apex syntax. If you provide code, format it in fenced code blocks and keep it Apex-specific. Do not suggest Java, JavaScript, C#, or other languages unless the user explicitly asks. Only call out governor limits when the log values are actually close to a known Salesforce limit. For Salesforce Apex, the common limits are: 100 SOQL queries, 150 DML statements, and 50,000 rows retrieved. If the actual values are well below those thresholds, say they are within safe limits and focus on the real issue.'
            },
            { role: 'user', content: prompt }
          ]
        })
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Groq request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    } catch (err) {
      clearTimeout(timeout);
      if (err?.name === 'AbortError') {
        throw new Error('The AI request timed out. Please try again.');
      }
      throw new Error(err?.message || 'AI request failed.');
    }
  }
}
