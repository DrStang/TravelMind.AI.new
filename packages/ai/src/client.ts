// packages/ai/src/client.ts
import OpenAI from "openai";
import { ModelSelector, type Mode } from "./selector.js";

export type ChatOptions = {
    mode?: Mode;
    maxDurationMs?: number;
    maxOutputTokens?: number;
    retryOllama?: number;
    system?: string;
};

type ChatMessage = { role: "system"|"user"|"assistant"; content: string };

const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const defaultOpts = {
    maxDurationMs: Number(process.env.AI_MAX_DURATION_MS || 280_000),
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 800),
    retryOllama: Number(process.env.AI_RETRY_OLLAMA || 1),
};

function withTimeout<T>(p: Promise<T>, ms: number, label = "op"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const id = setTimeout(() => reject(new Error(`timeout:${label}:${ms}`)), ms);
        p.then(v => { clearTimeout(id); resolve(v); }, e => { clearTimeout(id); reject(e); });
    });
}

// Very small “tokens” cap: clamp stop if we exceed
function enforceTokenGuard(prompt: string, maxOutputTokens: number) {
    const estIn = ModelSelector.estimateTokens(prompt);
    if (estIn + maxOutputTokens > 8192) {
        // crude: trim prompt to leave room for output
        const allowedChars = Math.max(0, (8192 - maxOutputTokens) * 4);
        return prompt.slice(-allowedChars);
    }
    return prompt;
}

async function callOllamaChat(model: string, msgs: ChatMessage[], maxTokens: number, signal?: AbortSignal) {
    // Streaming or non-streaming; here we do non-streaming JSON for simplicity
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
            model,
            messages: msgs,
            options: { num_predict: maxTokens }, // cap output tokens
            stream: false,
        }),
    });
    if (!r.ok) throw new Error(`ollama_http_${r.status}`);
    const j = await r.json();
    // Ollama formats: { message: {content}, done: true, eval_count/prompt_eval_count... }
    const content = j?.message?.content ?? j?.response ?? "";
    return String(content);
}

async function callOpenAIChat(model: string, msgs: ChatMessage[], maxTokens: number, client?: OpenAI) {
    const openai = client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.chat.completions.create({
        model,
        messages: msgs,
        temperature: 0.3,
        max_tokens: maxTokens,
    });
    return r.choices?.[0]?.message?.content ?? "";
}

export async function smartChat(
    userPrompt: string,
    opts: ChatOptions = {},
): Promise<string> {
    const { mode = "planner", system, maxDurationMs, maxOutputTokens, retryOllama } =
        { ...defaultOpts, ...opts };

    // 1) Select model
    const primary = ModelSelector.decidePrimary(userPrompt, mode);
    const fallback = ModelSelector.fallback();

    // 2) Build messages
    const boundedPrompt = enforceTokenGuard(userPrompt, maxOutputTokens);
    const messages: ChatMessage[] = [
        ...(system ? [{ role: "system", content: system as string } as ChatMessage] : []),
        { role: "user", content: boundedPrompt },
    ];

    // 3) Try Ollama (with quick retry + timeout)
    const controller = new AbortController();
    const doOllama = () =>
        withTimeout(
            callOllamaChat(primary.model || OLLAMA_MODEL, messages, maxOutputTokens, controller.signal),
            maxDurationMs,
            "ollama",
        );

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retryOllama; attempt++) {
        try {
            if (primary.provider === "ollama") {
                return await doOllama();
            }
            break; // if primary isn't ollama (not our case), skip
        } catch (e) {
            lastErr = e;
            // Abort immediately if timeout — no point retrying slow host
            if (String(e?.toString?.() || "").startsWith("Error: timeout:ollama")) break;
        }
    }

    // 4) Fallback to OpenAI (if key present)
    if (!process.env.OPENAI_API_KEY) {
        throw new Error(`ollama_failed_and_no_openai_fallback: ${String(lastErr)}`);
    }
    return await callOpenAIChat(OPENAI_MODEL, messages, maxOutputTokens);
}
