export type Mode = "planner" | "companion" | "journal";
export type SelectorInput = { message: string; mode: Mode; locale?: string; };

export class ModelSelector {
    static analyzeComplexity(message: string) {
        const wc = message.trim().split(/\s+/).length;
        const complexKeywords = [
            "analyze","compare","detailed","comprehensive","optimize",
            "multi-city","constraints","budget","weather","reschedule"
        ];
        const hasComplex = complexKeywords.some(k => message.toLowerCase().includes(k));
        if (wc > 120 || hasComplex) return "high";
        if (wc > 60) return "medium";
        return "low";
    }

    static selectOllamaModel(input: SelectorInput) {
        const c = this.analyzeComplexity(input.message);
        if (c === "high") return "qwen3:30b";       // big model llama3.1:70b"
        if (input.mode === "companion") return "mistral:7b"; // fast RT
        return "llama3.1:latest";                          // balanced default
    }

    static openaiFallbackFor(input: SelectorInput) {
        const c = this.analyzeComplexity(input.message);
        if (c === "high") return process.env.OPENAI_MODEL || "gpt-4o";
        return process.env.OPENAI_MODEL || "gpt-4o-mini";
    }
}
