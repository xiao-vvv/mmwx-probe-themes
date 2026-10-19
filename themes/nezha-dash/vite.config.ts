import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const UPSTREAM_GIT_HASH = "e0e90ac";

const getVendorChunkName = (moduleId: string) => {
	const normalizedId = moduleId.replace(/\\/g, "/");
	if (!normalizedId.includes("/node_modules/")) return undefined;
	const packagePath = normalizedId.split("/node_modules/").pop();
	if (!packagePath) return undefined;
	return packagePath.split("/")[0] || undefined;
};

export default defineConfig({
	base: "/themes/nezha-dash/",
	define: {
		"import.meta.env.VITE_GIT_HASH": JSON.stringify(UPSTREAM_GIT_HASH),
	},
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		proxy: {
			"/api/stream": {
				target: "ws://127.0.0.1:8787",
				changeOrigin: true,
				ws: true,
			},
			"/api": {
				target: "http://127.0.0.1:8787",
				changeOrigin: true,
			},
		},
		headers: {
			"Cache-Control": "no-store",
			Pragma: "no-cache",
		},
	},
	test: {
		environment: "jsdom",
		environmentOptions: {
			jsdom: {
				url: "https://localhost/",
			},
		},
		globals: true,
		setupFiles: ["./src/test/setup.ts"],
		css: true,
		include: ["src/test/**/*.{test,spec}.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			reportsDirectory: "./coverage",
			thresholds: {
				statements: 86,
				branches: 74,
				functions: 86,
				lines: 86,
			},
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.test.{ts,tsx}",
				"src/**/*.spec.{ts,tsx}",
				"src/test/**",
				"src/types/**",
				"src/main.tsx",
				"src/i18n.js",
				"src/vite-env.d.ts",
			],
		},
	},
	build: {
		outDir: "../../dist/themes/nezha-dash",
		emptyOutDir: false,
		target: ["es2020", "safari15"],
		cssTarget: ["safari15"],
		rollupOptions: {
			output: {
				entryFileNames: "assets/[name].[hash].js",
				chunkFileNames: "assets/[name].[hash].js",
				assetFileNames: "assets/[name].[hash].[ext]",
				manualChunks: getVendorChunkName,
			},
		},
		chunkSizeWarningLimit: 1500,
	},
});
