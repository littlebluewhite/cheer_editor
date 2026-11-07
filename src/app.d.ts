// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** 流程核心那包的指紋，建置時由 vite.config.ts 填（src/lib/core-fingerprint.ts）。 */
	const __CORE_FINGERPRINT__: string;
}

export {};
