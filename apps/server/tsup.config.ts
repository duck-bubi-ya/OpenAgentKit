import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	entry: { app: "src/app.ts", bin: "src/bin.ts" },
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	// 迁移 SQL 从产物旁边的 dist/migrations 读取，db 不能被拆进子目录 chunk。
	splitting: false,
	target: "node24",
	external: [/^node:/],
	esbuildOptions: (options) => {
		options.packages = "external";
	},
	onSuccess() {
		cpSync(join(root, "src/store/migrations"), join(root, "dist/migrations"), {
			recursive: true,
			filter: (source) => !source.endsWith(".ts"),
		});
	},
});
