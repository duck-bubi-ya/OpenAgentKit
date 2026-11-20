import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** 同域部署时由 KIT_CONSOLE_BASE=/console/ 挂到体验页旁边；本地开发保持根路径。 */
function consoleBase(): string {
	const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
	const raw = env?.KIT_CONSOLE_BASE?.trim();
	if (!raw || raw === "/") return "/";
	const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
	return prefixed.endsWith("/") ? prefixed : `${prefixed}/`;
}

export default defineConfig({
	base: consoleBase(),
	plugins: [react(), tailwindcss()],
	server: { port: 5174, proxy: { "/api": "http://localhost:8787" } },
	build: { outDir: "dist", sourcemap: true },
});
