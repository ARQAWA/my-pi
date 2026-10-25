// Source: extensions/RQW-codex/compression.ts @ a85b810e924010f35387045fc0cbbd9a1e7173cc
// Narrowed extraction: level-3 zstd request bytes for SSE, with no uncompressed fallback.
// Native: codex-rs/http-client/src/request.rs:184-240 (zstd::encode_all
// at level 3, Content-Encoding: zstd, body prepared once in into_prepared at :115-149) and codex-rs/features/src/lib.rs:1423-1428
// (enable_request_compression, default true). The caller prepares the body once and reuses the returned bytes on retry.
// Only Node's built-in zlib zstd is used (node:zlib zstdCompressSync with ZSTD_c_compressionLevel = 3). Node 22.19 and
// 24 and Bun 1.3.14 / 1.4.3 must provide it; the CI bun-check step is the proof for Bun. When it is missing the call
// throws; there is no uncompressed fallback.
import * as zlib from "node:zlib";

const REQUEST_ZSTD_LEVEL = 3;

class CompressionUnavailableError extends Error {
	name = "CompressionUnavailableError";
}

export function compressRequest(jsonUtf8: Uint8Array): Uint8Array {
	const zstdCompressSync = (zlib as { zstdCompressSync?: typeof zlib.deflateSync }).zstdCompressSync;
	const levelParam = (zlib.constants as Record<string, unknown>).ZSTD_c_compressionLevel;
	if (typeof zstdCompressSync !== "function" || typeof levelParam !== "number") {
		throw new CompressionUnavailableError(
			"zstd is not available in this runtime (node:zlib zstdCompressSync or ZSTD_c_compressionLevel missing); request compression refused",
		);
	}
	const compressed = zstdCompressSync(jsonUtf8, {
		params: { [levelParam]: REQUEST_ZSTD_LEVEL },
	} as zlib.ZlibOptions);
	return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
}
