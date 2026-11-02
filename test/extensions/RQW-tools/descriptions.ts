import { loadDescriptions } from "../../../extensions/RQW-tools/descriptions.ts";

/** The real tool descriptions, loaded once for the factories under test. */
export const descriptions = await loadDescriptions();
