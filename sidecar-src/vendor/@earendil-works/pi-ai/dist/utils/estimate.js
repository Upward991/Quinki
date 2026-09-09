const CHARS_PER_TOKEN = 4;
const ESTIMATED_IMAGE_CHARS = 4800;
export function calculateContextTokens(usage) {
    return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value) ?? "undefined";
    }
    catch {
        return "[unserializable]";
    }
}
// PATCH (Quinki): BPE tokenizer — same rationale as our compaction.js patch: the
// chars/4 heuristic overestimates code/repetitive prose by ~30% and that error
// propagates into 0.84.x clampMaxTokensToContext (a bad estimate clamps max_tokens
// to ~1 and the model cannot answer at all). Real token counts fix the clamp.
let _encoder = null;
function getEncoder() { if (!_encoder) { try { const m = require("gpt-tokenizer"); _encoder = m.encode; } catch { _encoder = null; } } return _encoder; }
function bpeTokens(text) { const enc = getEncoder(); if (enc && typeof text === "string" && text.length > 0) return enc(text).length; return Math.ceil((text || "").length / 4); }
function estimateTextAndImageContentChars(content) {
    if (typeof content === "string")
        return content.length;
    let chars = 0;
    for (const block of content)
        chars += block.type === "text" ? block.text.length : ESTIMATED_IMAGE_CHARS;
    return chars;
}
export function estimateTextTokens(text) {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}
export function estimateTextAndImageContentTokens(content) {
    // PATCH (Quinki): BPE-based (see bpeTokens above)
    if (typeof content === "string")
        return bpeTokens(content);
    let tokens = 0;
    for (const block of content)
        tokens += block.type === "text" ? bpeTokens(block.text) : Math.ceil(ESTIMATED_IMAGE_CHARS / 4);
    return tokens;
}
export function estimateMessageTokens(message) {
    // PATCH (Quinki): BPE-based estimate (see bpeTokens above)
    if (message.role === "user" || message.role === "toolResult")
        return estimateTextAndImageContentTokens(message.content);
    let tokens = 0;
    for (const block of message.content) {
        if (block.type === "text") {
            tokens += bpeTokens(block.text);
        }
        else if (block.type === "thinking") {
            tokens += bpeTokens(block.thinking);
        }
        else {
            tokens += bpeTokens(block.name) + bpeTokens(safeJsonStringify(block.arguments));
        }
    }
    return tokens;
}
function getLastAssistantUsageInfo(messages) {
    let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
    let usageInfo;
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.role === "assistant") {
            const assistant = message;
            // A newer prefix message was inserted after this response (for example, a
            // compaction summary), so its usage cannot describe the current prefix.
            const usageAppliesToPrefix = assistant.timestamp >= latestPrefixTimestamp;
            if (usageAppliesToPrefix &&
                assistant.stopReason !== "aborted" &&
                assistant.stopReason !== "error" &&
                // PATCH (Quinki): guard usage — hand-written/error entries (e.g. injectErrorExchange)
                // can be well-formed messages without usage; never crash reading totalTokens.
                assistant.usage &&
                calculateContextTokens(assistant.usage) > 0) {
                usageInfo = { usage: assistant.usage, index: i };
            }
        }
        latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
    }
    return usageInfo;
}
function estimateMessages(messages) {
    const usageInfo = getLastAssistantUsageInfo(messages);
    if (usageInfo) {
        const usageTokens = calculateContextTokens(usageInfo.usage);
        let trailingTokens = 0;
        for (let i = usageInfo.index + 1; i < messages.length; i++) {
            trailingTokens += estimateMessageTokens(messages[i]);
        }
        return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: usageInfo.index };
    }
    let tokens = 0;
    for (const message of messages)
        tokens += estimateMessageTokens(message);
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}
function estimateToolsTokens(tools) {
    if (!tools || tools.length === 0)
        return 0;
    return estimateTextTokens(safeJsonStringify(tools));
}
function isMessageArray(value) {
    return Array.isArray(value);
}
export function estimateContextTokens(context) {
    if (isMessageArray(context))
        return estimateMessages(context);
    const estimate = estimateMessages(context.messages);
    if (estimate.lastUsageIndex !== null) {
        const addedNames = new Set(context.messages
            .slice(estimate.lastUsageIndex + 1)
            .filter((message) => message.role === "toolResult")
            .flatMap((message) => message.addedToolNames ?? []));
        const addedToolTokens = estimateToolsTokens(context.tools?.filter((tool) => addedNames.has(tool.name)));
        return {
            tokens: estimate.tokens + addedToolTokens,
            usageTokens: estimate.usageTokens,
            trailingTokens: estimate.trailingTokens + addedToolTokens,
            lastUsageIndex: estimate.lastUsageIndex,
        };
    }
    const prefixTokens = (context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0) + estimateToolsTokens(context.tools);
    return {
        tokens: estimate.tokens + prefixTokens,
        usageTokens: estimate.usageTokens,
        trailingTokens: estimate.trailingTokens + prefixTokens,
        lastUsageIndex: estimate.lastUsageIndex,
    };
}
//# sourceMappingURL=estimate.js.map