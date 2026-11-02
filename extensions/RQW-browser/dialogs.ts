import type { Dialog, Page } from "puppeteer-core";

// Adapted from oh-my-pi 18.8.9 (browser/dialogs.ts), MIT; see THIRD-PARTY-NOTICES.md.

/** Automatic JavaScript-dialog policy. */
export type DialogPolicy = "accept" | "dismiss";

/** JSON-safe description of the currently pending JavaScript dialog. */
export interface DialogState {
	/** Whether a confirm or prompt is waiting for a decision. */
	open: boolean;
	type?: string;
	message?: string;
	/** Prompt default. */
	defaultValue?: string;
}

/** Automatic and explicit handling of the JavaScript dialogs of one tab. */
export class DialogController {
	#page: Page | undefined;
	#policy: DialogPolicy | undefined;
	#pending: Dialog | undefined;

	/** Start listening to `page`; dialogs raised before this are not seen. */
	observe(page: Page): void {
		this.#page = page;
		page.on("dialog", this.#onDialog);
		page.on("framenavigated", this.#onFrameNavigated);
	}

	/** Stop listening and forget a dialog that can no longer be handled. */
	dispose(): void {
		this.#page?.off("dialog", this.#onDialog);
		this.#page?.off("framenavigated", this.#onFrameNavigated);
		this.#pending = undefined;
	}

	state(): DialogState {
		const dialog = this.#pending;
		if (!dialog) return { open: false };
		const type = dialog.type();
		return { open: true, type, message: dialog.message(), ...(type === "prompt" ? { defaultValue: dialog.defaultValue() } : {}) };
	}

	/** Change the automatic policy and settle an already pending dialog when one is set. */
	async setPolicy(policy: DialogPolicy | null): Promise<void> {
		this.#policy = policy ?? undefined;
		if (!this.#policy || !this.#pending) return;
		await this.#settle(this.#pending, this.#policy === "accept", undefined);
	}

	readonly #onDialog = (dialog: Dialog): void => {
		const policy = this.#policy;
		if (policy) {
			void this.#settle(dialog, policy === "accept", undefined).catch(() => {});
			return;
		}
		const type = dialog.type();
		if (type === "alert" || type === "beforeunload") {
			void this.#settle(dialog, true, undefined).catch(() => {});
			return;
		}
		this.#pending = dialog;
	};

	readonly #onFrameNavigated = (frame: unknown): void => {
		if (frame === this.#page?.mainFrame()) this.#pending = undefined;
	};

	async #settle(dialog: Dialog, accept: boolean, text: string | undefined): Promise<void> {
		try {
			if (accept) await dialog.accept(text);
			else await dialog.dismiss();
		} finally {
			if (this.#pending === dialog) this.#pending = undefined;
		}
	}
}
