// Types for display.mjs (pinned port of @earendil-works/pi-ai 1.4.0 processResponsesStream, MIT).
import type { Api, AssistantMessage, AssistantMessageEventStream, Model, StreamOptions, Usage } from "@earendil-works/pi-ai";

/** Same literal union as the OpenAI Responses `service_tier` parameter used by pi-ai 1.4.0. */
export type ResponsesServiceTier = "auto" | "default" | "flex" | "scale" | "priority" | null;

export interface OpenAIResponsesStreamOptions {
	onProviderStreamEvent?: StreamOptions["onProviderStreamEvent"];
	serviceTier?: ResponsesServiceTier;
	grammarToolInputProperties?: ReadonlyMap<string, string>;
	resolveServiceTier?: (
		responseServiceTier: ResponsesServiceTier | undefined,
		requestServiceTier: ResponsesServiceTier | undefined,
	) => ResponsesServiceTier | undefined;
	applyServiceTierPricing?: (usage: Usage, serviceTier: ResponsesServiceTier | undefined) => void;
}

export declare function processResponsesStream<TApi extends Api>(
	openaiStream: AsyncIterable<unknown>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): Promise<void>;
