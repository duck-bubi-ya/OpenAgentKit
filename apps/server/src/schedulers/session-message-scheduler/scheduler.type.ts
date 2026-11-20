export interface SessionMessageSchedulerOptions {
	/** 没有新通知时，隔多久再看一次任务表。 */
	intervalMs: number;
	/** 进程启动时，把过期的 running 改回 queued。 */
	recover(): Promise<void>;
	/**
	 * 领取并执行一条到期任务。
	 * 返回 true 表示处理了一条，循环会接着看下一条。
	 * 返回 false 表示当前没有可领的任务。
	 */
	runOnce(): Promise<boolean>;
}
