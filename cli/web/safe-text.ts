/** Redacts anything that looks like a credential before text reaches stdout, stderr or a file. */
export function redact(text: string): string {
	return text
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "[redacted]")
		.replace(/\b(sk|rt|ak)-[A-Za-z0-9_-]{16,}/g, "[redacted]");
}

/** One safe line for an error: redacted, control characters removed, bounded. */
export function safeMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unexpected error.";
	const line = redact(raw).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
	return (line || "Unexpected error.").slice(0, 300);
}

/** Removes terminal control sequences and carriage returns from untrusted page-derived text. */
export function normalizeText(text: string): string {
	return text
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
