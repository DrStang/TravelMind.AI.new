import OpenAI from "openai";
import { ModelSelector, type Mode } from "./selector.js";

type Msg = { role: "system" | "user" | "assistant"; content: string };

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function callOllama(model: string, messages: Msg[], temperature = 0.3) {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false, messages, options: { temperature } })
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || "";
}

async function callOpenAI(model: string, messages: Msg[], temperature = 0.3) {
    if (!openai) throw new Error("OPENAI_API_KEY missing");
    const resp = await openai.chat.completions.create({ model, messages, temperature });
    return resp.choices?.[0]?.message?.content || "";
}

export async function smartChat(messages: Msg[], mode: Mode = "planner", temperature = 0.3) {
    const userMsg = messages.slice().reverse().find(m => m.role === "user")?.content || "";
    const ollamaModel = ModelSelector.selectOllamaModel({ message: userMsg, mode });
    try {
        return await callOllama(ollamaModel, messages, temperature);
    } catch (e) {
        const openaiModel = ModelSelector.openaiFallbackFor({ message: userMsg, mode });
        if (!openai) throw e;
        return await callOpenAI(openaiModel, messages, temperature);
    }
}
