// Pinned Pi display parser for the RQW-codex live Responses pump. Only root pi-ai exports are imported,
// so this works under Pi's extension loader and plain Node without runtime dist subpaths.
//
// Source (MIT): @earendil-works/pi-ai 1.5.0, copyright Mario Zechner and contributors / Earendil.
// dist/api/openai-responses-shared.js: processResponsesStream and its display helpers.
// SHA-256: 00796997da00cd4cb77ae8c1c4bb92a3d4a4a4dd5bea18524de7173e4f877e4c
// dist/api/constrained-sampling.js: streaming grammar input helpers.
// SHA-256: 94a6f3bda4e1270f7ae524c2d343deec2f89abf5d74d9471103eefd3227c41fe
// Bodies are copied from the published JavaScript. Unrelated conversion and wire helpers are omitted.
// The unreachable fallback in the provider error expression is omitted for lint.
import { calculateCost, ToolCallArgumentsStream } from "@earendil-works/pi-ai";

function encodeTextSignatureV1(id, phase) {
    const payload = { v: 1, id };
    if (phase)
        payload.phase = phase;
    return JSON.stringify(payload);
}
function appendGrammarToolInputJsonDelta(buffer, inputProperty, inputDelta) {
    if (buffer.closed) {
        throw new Error(`grammar tool input for property "${inputProperty}" changed after it was closed`);
    }
    if (inputDelta.length === 0)
        return undefined;
    buffer.input += inputDelta;
    return grammarToolInputJsonStart(buffer, inputProperty) + JSON.stringify(inputDelta).slice(1, -1);
}
/**
 * Close a streaming grammar tool input and return the rest of its JSON arguments text. `finalInput` is the complete
 * input when the provider sends one; it must continue the input streamed so far. Closing again with the same input
 * returns `undefined`.
 */
function closeGrammarToolInputJson(buffer, inputProperty, finalInput) {
    if (buffer.closed) {
        if (finalInput === undefined || finalInput === buffer.input)
            return undefined;
        throw new Error(`grammar tool input for property "${inputProperty}" changed after it was closed`);
    }
    if (finalInput !== undefined && !finalInput.startsWith(buffer.input)) {
        throw new Error(`grammar tool input for property "${inputProperty}" changed non-monotonically`);
    }
    const rest = finalInput === undefined ? "" : finalInput.slice(buffer.input.length);
    if (finalInput !== undefined)
        buffer.input = finalInput;
    buffer.closed = true;
    return `${grammarToolInputJsonStart(buffer, inputProperty)}${JSON.stringify(rest).slice(1, -1)}"}`;
}
/** The opening of the JSON arguments text, once. */
function grammarToolInputJsonStart(buffer, inputProperty) {
    if (buffer.started)
        return "";
    buffer.started = true;
    return `{${JSON.stringify(inputProperty)}:"`;
}
export async function processResponsesStream(openaiStream, output, stream, model, options) {
    let sawTerminalResponseEvent = false;
    const outputSlots = new Map();
    // Tool calls whose output_item.done has not arrived yet.
    const unfinishedToolCalls = new Set();
    const reasoningBlocksById = new Map();
    const applyMessagePhaseStopReason = (item) => {
        if (item.type === "message" && item.phase === "final_answer") {
            output.stopReason = "stop";
        }
    };
    const getSlot = (outputIndex, type) => {
        const slot = outputSlots.get(outputIndex);
        return slot?.type === type ? slot : undefined;
    };
    const pushToolCallDelta = (slot, delta) => {
        if (delta === undefined)
            return;
        stream.push({
            type: "toolcall_delta",
            contentIndex: slot.contentIndex,
            delta,
            partial: output,
        });
    };
    const createSlot = (outputIndex, item) => {
        if (item.type === "reasoning") {
            const block = { type: "thinking", thinking: "" };
            output.content.push(block);
            const slot = {
                type: "thinking",
                block,
                contentIndex: output.content.length - 1,
            };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "thinking_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }
        if (item.type === "message") {
            applyMessagePhaseStopReason(item);
            const block = { type: "text", text: "" };
            output.content.push(block);
            const slot = { type: "text", block, contentIndex: output.content.length - 1 };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "text_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }
        if (item.type === "function_call") {
            const args = new ToolCallArgumentsStream();
            const block = {
                type: "toolCall",
                id: `${item.call_id}|${item.id}`,
                name: item.name,
                arguments: item.arguments ? args.append(item.arguments) : {},
                ...(item.namespace !== undefined ? { namespace: item.namespace } : {}),
            };
            output.content.push(block);
            unfinishedToolCalls.add(block);
            const slot = {
                type: "toolCall",
                block,
                contentIndex: output.content.length - 1,
                input: { kind: "json", arguments: args },
            };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }
        if (item.type === "custom_tool_call") {
            const inputProperty = options?.grammarToolInputProperties?.get(item.name) ?? "input";
            const input = item.input || "";
            const block = {
                type: "toolCall",
                id: `${item.call_id}|${item.id}`,
                name: item.name,
                arguments: { [inputProperty]: input },
                ...(item.namespace !== undefined ? { namespace: item.namespace } : {}),
            };
            output.content.push(block);
            unfinishedToolCalls.add(block);
            const slot = {
                type: "toolCall",
                block,
                contentIndex: output.content.length - 1,
                input: customInput(inputProperty, input),
            };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }
        return undefined;
    };
    const getOrCreateSlot = (outputIndex, item) => {
        return outputSlots.get(outputIndex) ?? createSlot(outputIndex, item);
    };
    // Azure OpenAI can omit reasoning.encrypted_content from response.output_item.done
    // and provide it only in response.completed.response.output. Backfill the
    // persisted reasoning signature from the terminal response to keep store:false
    // multi-turn replay stateless. See https://github.com/earendil-works/pi/issues/6409.
    const backfillReasoningSignatures = (responseOutput) => {
        for (const item of responseOutput) {
            if (item.type !== "reasoning" || !item.encrypted_content)
                continue;
            const block = reasoningBlocksById.get(item.id);
            if (!block?.thinkingSignature)
                continue;
            const storedItem = JSON.parse(block.thinkingSignature);
            if (storedItem.encrypted_content)
                continue;
            block.thinkingSignature = JSON.stringify({
                ...storedItem,
                encrypted_content: item.encrypted_content,
            });
        }
    };
    const finalizeResponse = (response) => {
        sawTerminalResponseEvent = true;
        backfillReasoningSignatures(response.output ?? []);
        if (response?.id) {
            output.responseId = response.id;
        }
        if (response?.usage) {
            const inputDetails = response.usage.input_tokens_details;
            const cachedTokens = inputDetails?.cached_tokens || 0;
            const cacheWriteTokens = inputDetails?.cache_write_tokens || 0;
            output.usage = {
                // OpenAI includes cached and cache-write tokens in input_tokens, so subtract both.
                input: Math.max(0, (response.usage.input_tokens || 0) - cachedTokens - cacheWriteTokens),
                output: response.usage.output_tokens || 0,
                cacheRead: cachedTokens,
                cacheWrite: cacheWriteTokens,
                reasoning: response.usage.output_tokens_details?.reasoning_tokens || 0,
                totalTokens: response.usage.total_tokens || 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            };
        }
        calculateCost(model, output.usage);
        if (options?.applyServiceTierPricing) {
            const serviceTier = options.resolveServiceTier
                ? options.resolveServiceTier(response?.service_tier, options.serviceTier)
                : (response?.service_tier ?? options.serviceTier);
            options.applyServiceTierPricing(output.usage, serviceTier);
        }
        // Map status to stop reason. For incomplete responses, retain the provider's
        // specific reason so max-output truncation and content filtering stay distinct.
        const status = response?.status;
        const incompleteDetails = response?.incomplete_details;
        const incompleteReason = typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : undefined;
        output.rawStopReason = incompleteReason ? `${status}.${incompleteReason}` : status;
        const mappedStop = mapStopReason(status, incompleteReason);
        output.stopReason = mappedStop.stopReason;
        if (mappedStop.errorMessage === undefined)
            delete output.errorMessage;
        else
            output.errorMessage = mappedStop.errorMessage;
        if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
            output.stopReason = "toolUse";
        }
    };
    for await (const event of openaiStream) {
        await options?.onProviderStreamEvent?.(event, model);
        if (event.type === "response.created") {
            output.responseId = event.response.id;
        }
        else if (event.type === "response.output_item.added") {
            createSlot(event.output_index, event.item);
        }
        else if (event.type === "response.reasoning_summary_text.delta") {
            const slot = getSlot(event.output_index, "thinking");
            if (!slot)
                continue;
            slot.block.thinking += event.delta;
            stream.push({
                type: "thinking_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.reasoning_summary_part.done") {
            const slot = getSlot(event.output_index, "thinking");
            if (!slot)
                continue;
            slot.block.thinking += "\n\n";
            stream.push({
                type: "thinking_delta",
                contentIndex: slot.contentIndex,
                delta: "\n\n",
                partial: output,
            });
        }
        else if (event.type === "response.reasoning_text.delta") {
            const slot = getSlot(event.output_index, "thinking");
            if (!slot)
                continue;
            slot.block.thinking += event.delta;
            stream.push({
                type: "thinking_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.output_text.delta") {
            const slot = getSlot(event.output_index, "text");
            if (!slot)
                continue;
            slot.block.text += event.delta;
            stream.push({
                type: "text_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.refusal.delta") {
            const slot = getSlot(event.output_index, "text");
            if (!slot)
                continue;
            slot.block.text += event.delta;
            stream.push({
                type: "text_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.function_call_arguments.delta") {
            const slot = getSlot(event.output_index, "toolCall");
            if (slot?.input.kind !== "json")
                continue;
            slot.block.arguments = slot.input.arguments.append(event.delta);
            pushToolCallDelta(slot, event.delta);
        }
        else if (event.type === "response.function_call_arguments.done") {
            const slot = getSlot(event.output_index, "toolCall");
            if (slot?.input.kind !== "json")
                continue;
            const replaced = slot.input.arguments.replace(event.arguments);
            slot.block.arguments = replaced.arguments;
            if (replaced.delta)
                pushToolCallDelta(slot, replaced.delta);
        }
        else if (event.type === "response.custom_tool_call_input.delta") {
            const slot = getSlot(event.output_index, "toolCall");
            if (slot?.input.kind !== "custom")
                continue;
            pushToolCallDelta(slot, appendCustomInput(slot.block, slot.input, event.delta));
        }
        else if (event.type === "response.custom_tool_call_input.done") {
            const slot = getSlot(event.output_index, "toolCall");
            if (slot?.input.kind !== "custom")
                continue;
            pushToolCallDelta(slot, closeCustomInput(slot.block, slot.input, event.input));
        }
        else if (event.type === "response.output_item.done") {
            const item = event.item;
            applyMessagePhaseStopReason(item);
            const slot = getOrCreateSlot(event.output_index, item);
            if (item.type === "reasoning" && slot?.type === "thinking") {
                const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
                const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
                slot.block.thinking = summaryText || contentText || slot.block.thinking;
                slot.block.thinkingSignature = JSON.stringify(item);
                reasoningBlocksById.set(item.id, slot.block);
                stream.push({
                    type: "thinking_end",
                    contentIndex: slot.contentIndex,
                    content: slot.block.thinking,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }
            else if (item.type === "message" && slot?.type === "text") {
                slot.block.text = item.content?.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("") || "";
                slot.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? undefined);
                stream.push({
                    type: "text_end",
                    contentIndex: slot.contentIndex,
                    content: slot.block.text,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }
            else if (item.type === "function_call" && slot?.type === "toolCall" && slot.input.kind === "json") {
                if (item.arguments)
                    slot.input.arguments.replace(item.arguments);
                Object.assign(slot.block, slot.input.arguments.finish());
                if (item.namespace !== undefined)
                    slot.block.namespace = item.namespace;
                unfinishedToolCalls.delete(slot.block);
                stream.push({
                    type: "toolcall_end",
                    contentIndex: slot.contentIndex,
                    toolCall: slot.block,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }
            else if (item.type === "custom_tool_call" && slot?.type === "toolCall" && slot.input.kind === "custom") {
                pushToolCallDelta(slot, closeCustomInput(slot.block, slot.input, item.input));
                if (item.namespace !== undefined)
                    slot.block.namespace = item.namespace;
                unfinishedToolCalls.delete(slot.block);
                stream.push({
                    type: "toolcall_end",
                    contentIndex: slot.contentIndex,
                    toolCall: slot.block,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }
        }
        else if (event.type === "response.completed" || event.type === "response.incomplete") {
            finalizeResponse(event.response);
        }
        else if (event.type === "error") {
            throw new Error(`Error Code ${event.code}: ${event.message}`);
        }
        else if (event.type === "response.failed") {
            sawTerminalResponseEvent = true;
            output.rawStopReason = event.response?.status;
            const error = event.response?.error;
            const details = event.response?.incomplete_details;
            const msg = error
                ? `${error.code || "unknown"}: ${error.message || "no message"}`
                : details?.reason
                    ? `incomplete: ${details.reason}`
                    : "Unknown error (no error details in response)";
            throw new Error(msg);
        }
    }
    if (!sawTerminalResponseEvent) {
        throw new Error("OpenAI Responses stream ended before a terminal response event");
    }
    // The agent runs every tool call in the final message. Refuse to hand over calls whose
    // output_item.done never arrived: their arguments may be cut off or mixed up, e.g. when a
    // non-compliant server omits output_index.
    if (output.stopReason === "toolUse") {
        for (const toolCall of unfinishedToolCalls) {
            throw new Error(`OpenAI Responses stream completed with an unfinished tool call: ${toolCall.name} (${toolCall.id})`);
        }
    }
}
/** Stream state of a custom tool call that starts with `initialInput`. */
function customInput(property, initialInput) {
    const buffer = { input: "", started: false, closed: false };
    return {
        kind: "custom",
        property,
        buffer,
        unsent: appendGrammarToolInputJsonDelta(buffer, property, initialInput) ?? "",
    };
}
/** Append to a streaming custom tool input; returns the matching piece of its JSON arguments text. */
function appendCustomInput(block, input, delta) {
    return sendCustomInput(block, input, appendGrammarToolInputJsonDelta(input.buffer, input.property, delta));
}
/** Close a custom tool input with the provider's complete input, if it sent one. */
function closeCustomInput(block, input, finalInput) {
    return sendCustomInput(block, input, closeGrammarToolInputJson(input.buffer, input.property, finalInput));
}
function sendCustomInput(block, input, jsonDelta) {
    block.arguments = { [input.property]: input.buffer.input };
    if (input.unsent === "")
        return jsonDelta;
    const sent = input.unsent + (jsonDelta ?? "");
    input.unsent = "";
    return sent;
}
function mapStopReason(status, incompleteReason) {
    if (!status)
        return { stopReason: "stop" };
    switch (status) {
        case "completed":
            return { stopReason: "stop" };
        case "incomplete":
            if (incompleteReason === "max_output_tokens") {
                return { stopReason: "length" };
            }
            return {
                stopReason: "error",
                errorMessage: incompleteReason
                    ? `Response incomplete: ${incompleteReason}`
                    : "Response incomplete without a provider reason",
            };
        case "failed":
        case "cancelled":
            return { stopReason: "error" };
        // These two are wonky ...
        case "in_progress":
        case "queued":
            return { stopReason: "stop" };
        default: {
            const _exhaustive = status;
            throw new Error(`Unhandled stop reason: ${_exhaustive}`);
        }
    }
}
