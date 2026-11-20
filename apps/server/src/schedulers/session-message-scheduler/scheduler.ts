import type { SessionMessageSchedulerOptions } from "./scheduler.type.ts";

/**
 * 和 Kit 进程一起起停的单飞循环。
 * 全局同时只跑一条：正在跑时再来通知，只记一个标记，当前这条结束后再看。
 * 领取、分页和写消息不在这里，由构造时传入的 recover / runOnce 完成。
 */
export class SessionMessageScheduler {
	private timer: ReturnType<typeof setInterval> | undefined;
	private started = false;
	private ready = false;
	private running = false;
	private again = false;
	private tail: Promise<void> = Promise.resolve();

	constructor(private readonly options: SessionMessageSchedulerOptions) {
		if (!(options.intervalMs > 0)) throw new Error("调度间隔必须大于 0");
	}

	/** 回收过期任务，然后开始看任务表。 */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		try {
			await this.options.recover();
		} catch (error) {
			this.started = false;
			throw error;
		}
		if (!this.started) return;
		this.ready = true;
		this.drain();
		this.timer = setInterval(() => this.drain(), this.options.intervalMs);
		this.timer.unref?.();
	}

	/** 停止再领新任务，并等当前这一条结束。 */
	async stop(): Promise<void> {
		this.started = false;
		this.ready = false;
		this.again = false;
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		while (this.running) await this.tail;
	}

	/** 回调写入任务后叫醒。循环没启动时无效。 */
	wake(): void {
		if (!this.ready) return;
		this.drain();
	}

	private drain(): void {
		if (!this.ready || this.running) {
			if (this.ready) this.again = true;
			return;
		}
		this.running = true;
		this.tail = this.execute();
	}

	private async execute(): Promise<void> {
		try {
			do {
				if (!this.ready) return;
				this.again = false;
				let worked = false;
				try {
					worked = await this.options.runOnce();
				} catch {
					// 这一条的失败状态由 runOnce 自己记下。下一轮间隔再看，避免失败后空转。
					return;
				}
				if (!worked && !this.again) return;
			} while (this.ready);
		} finally {
			this.running = false;
			if (this.ready && this.again) this.drain();
		}
	}
}
