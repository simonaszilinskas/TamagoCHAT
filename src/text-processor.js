// src/text-processor.js
class TextProcessor {
    constructor(engine, modelId) {
      this.engine = engine;
      this.modelId = modelId;
    }
  
    async processText(text, url, title) {
      console.log('Processing text:', { text, url, title });
      
      // Extract key insights
      const insights = await this.extractInsights(text);
      console.log('Generated insights:', insights);
  
      return {
        originalText: text,
        insights: insights.map(insight => ({
          content: insight,
          timestamp: Date.now()
        })),
        metadata: {
          url,
          title,
          timestamp: Date.now()
        }
      };
    }
  
    async extractInsights(text) {
      const prompt = `Summarize the following text into just the essential insights, information. It should be as short as possible without omitting potentially important factual information:
  
      "${text}"`;
  
      try {
        let response;
        if (this.engine.chat?.completions) {
          // For WebLLM
          response = await this.engine.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: this.modelId,
            temperature: 0.3,
            max_tokens: 150
          });
        } else if (this.engine.chat) {
          // For OpenAI
          response = await this.engine.chat([
            { role: "user", content: prompt }
          ]);
        }
  
        const content = response?.choices[0]?.message?.content || '';
        return content.split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);
  
      } catch (error) {
        console.error('Error extracting insights:', error);
        return [];
      }
    }
  }
  
  export default TextProcessor;