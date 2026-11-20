import { describe, expect, it, vi } from "vitest";
import { SessionMessageScheduler } from "./index.ts";

function deferred() {
	let resolve: (value: boolean) => void = () => undefined;
	const promise = new Promise<boolean>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("会话消息调度器", () => {
	it("启动时先回收，再领一条", async () => {
		const order: string[] = [];
		const scheduler = new SessionMessageScheduler({
			intervalMs: 60_000,
			recover: async () => {
				order.push("recover");
			},
			runOnce: async () => {
				order.push("run");
				return false;
			},
		});
		await scheduler.start();
		await scheduler.stop();
		expect(order).toEqual(["recover", "run"]);
	});

	it("正在跑时再叫醒，不会并行，结束后再看一次", async () => {
		const gate = deferred();
		let calls = 0;
		const scheduler = new SessionMessageScheduler({
			intervalMs: 60_000,
			recover: async () => undefined,
			runOnce: async () => {
				calls += 1;
				if (calls === 1) return gate.promise;
				return false;
			},
		});
		await scheduler.start();
		scheduler.wake();
		scheduler.wake();
		expect(calls).toBe(1);
		gate.resolve(false);
		await gate.promise;
		await vi.waitFor(() => expect(calls).toBe(2));
		await scheduler.stop();
		scheduler.wake();
		expect(calls).toBe(2);
	});

	it("停掉之后不再领任务", async () => {
		const gate = deferred();
		let calls = 0;
		const scheduler = new SessionMessageScheduler({
			intervalMs: 60_000,
			recover: async () => undefined,
			runOnce: async () => {
				calls += 1;
				return gate.promise;
			},
		});
		await scheduler.start();
		const stopping = scheduler.stop();
		gate.resolve(true);
		await stopping;
		scheduler.wake();
		expect(calls).toBe(1);
	});

	it("到了间隔会再看一次", async () => {
		vi.useFakeTimers();
		try {
			let calls = 0;
			const scheduler = new SessionMessageScheduler({
				intervalMs: 2_000,
				recover: async () => undefined,
				runOnce: async () => {
					calls += 1;
					return false;
				},
			});
			await scheduler.start();
			expect(calls).toBe(1);
			await vi.advanceTimersByTimeAsync(2_000);
			expect(calls).toBe(2);
			await scheduler.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it("回收失败时不开始看任务", async () => {
		let calls = 0;
		const scheduler = new SessionMessageScheduler({
			intervalMs: 60_000,
			recover: async () => {
				throw new Error("回收失败");
			},
			runOnce: async () => {
				calls += 1;
				return false;
			},
		});
		await expect(scheduler.start()).rejects.toThrow("回收失败");
		scheduler.wake();
		expect(calls).toBe(0);
	});
});
