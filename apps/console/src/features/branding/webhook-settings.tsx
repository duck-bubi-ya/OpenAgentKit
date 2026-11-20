import { Button, Input } from "antd";
import type { WebhookSettingsView } from "../../lib/api.ts";

type ConnectionTone = "gray" | "yellow" | "green" | "red";

const toneClass: Record<ConnectionTone, string> = {
	gray: "bg-neutral-300",
	yellow: "bg-amber-400",
	green: "bg-green-500",
	red: "bg-red-500",
};

const toneLabel: Record<ConnectionTone, string> = {
	gray: "未测试",
	yellow: "测试中",
	green: "已连通",
	red: "连通失败",
};

function connectionTone(
	testing: boolean,
	error: string | undefined,
	saved: WebhookSettingsView,
	dirty: boolean,
): ConnectionTone {
	if (testing) return "yellow";
	if (error || (!dirty && saved.status === "error")) return "red";
	if (!dirty && saved.status === "active") return "green";
	return "gray";
}

/** Webhook 区块只展示端点 URL 和测试连通，保存交给整页按钮。 */
export function WebhookFields({
	value,
	onChange,
	saved,
	dirty,
	disabled,
	testing,
	error,
	onTest,
}: {
	value: string;
	onChange: (value: string) => void;
	saved: WebhookSettingsView;
	dirty: boolean;
	disabled: boolean;
	testing: boolean;
	error?: string;
	onTest: () => void;
}) {
	const tone = connectionTone(testing, error, saved, dirty);
	const detail = error || (!dirty && saved.status === "error" ? saved.detail : undefined);
	return (
		<div className="max-w-2xl space-y-4">
			<h2 className="text-base font-semibold">Webhook</h2>
			<div className="space-y-2">
				<label htmlFor="webhook-public-url" className="text-sm font-medium">
					端点 URL
				</label>
				<div className="flex flex-wrap items-start gap-3">
					<div className="min-w-64 flex-1">
						<Input
							id="webhook-public-url"
							aria-label="端点 URL"
							value={value}
							placeholder="http://公网IP:8787 或 https://映射到本服务的域名"
							maxLength={2048}
							status={tone === "red" ? "error" : undefined}
							disabled={disabled}
							onChange={(event) => onChange(event.target.value)}
						/>
					</div>
					<span className="inline-flex h-8 items-center gap-2 text-sm text-neutral-600">
						<span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${toneClass[tone]}`} />
						<span>{toneLabel[tone]}</span>
					</span>
					<Button disabled={disabled || testing} loading={testing} onClick={onTest}>
						测试连通
					</Button>
				</div>
				<span className="block text-xs leading-5 text-neutral-500">
					填部署这台服务的公网 IP 加端口，或映射到该服务的域名。签名密钥由服务保存，不在这里填写。
				</span>
				{detail ? <span className="block text-xs text-red-600">{detail}</span> : null}
			</div>
			{saved.callbackUrl && !dirty ? (
				<p className="text-xs leading-5 text-neutral-500">登记地址：{saved.callbackUrl}</p>
			) : null}
		</div>
	);
}
