// packages/ai/src/selector.ts
export type Mode = "companion" | "planner" | "journal";

export type ModelChoice = {
    provider: "ollama" | "openai";
    model: string;
};

export type SelectorInput = {
    message: string;
    mode?: Mode;
};

export class ModelSelector {
    /** crude token estimate (~4 chars/token), good enough for guardrails */
    static estimateTokens(text: string): number {
        return Math.ceil(text.trim().length / 4);
    }

    /** Your multi-model Ollama strategy */
    static selectOllamaModel(input: SelectorInput): string {
        const complexity = this.analyzeComplexity(input.message);

        // big model for complex planner requests
        if (complexity === "high" && input.mode !== "companion") {
            return process.env.OLLAMA_MODEL_COMPLEX || "qwen3:30b"; // or "llama3.1:70b"
        }

        // fast model for companion (chatty) mode
        if (input.mode === "companion") {
            return process.env.OLLAMA_MODEL_COMPANION || "mistral:7b";
        }

        // balanced default
        return process.env.OLLAMA_MODEL_DEFAULT || "llama3.1:latest";
    }

    /** Keep your earlier complexity heuristic */
    static analyzeComplexity(message: string): "low" | "high" {
        const complexKeywords = [
            "analyze", "compare", "detailed", "comprehensive",
            "optimize", "itinerary", "budget", "constraints"
        ];
        const wc = message.trim().split(/\s+/).length;
        const hasComplex = complexKeywords.some(k => message.toLowerCase().includes(k));
        return hasComplex || wc > 120 ? "high" : "low";
    }

    /** What client.ts expects: returns a provider+model choice (Ollama primary) */
    static decidePrimary(message: string, mode: Mode = "planner"): ModelChoice {
        return {
            provider: "ollama",
            model: this.selectOllamaModel({ message, mode }),
        };
    }

    /** What client.ts expects: OpenAI fallback choice */
    static fallback(): ModelChoice {
        return {
            provider: "openai",
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        };
    }
}
