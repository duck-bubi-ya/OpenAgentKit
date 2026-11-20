import { UploadOutlined } from "@ant-design/icons";
import {
	BRANDING_LOGO_MAX_BYTES,
	BRANDING_LOGO_PATH,
	BRANDING_LOGO_TYPES,
	type BrandingView,
	DEFAULT_BRAND_PRODUCT_NAME,
} from "@openagentkit/sdk/protocol";
import { Alert, Button, Input, Result, Segmented, Skeleton, Space, Typography, Upload } from "antd";
import { useEffect, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi, getAdminClient, type WebhookSettingsView } from "../../lib/api.ts";
import { InnerLayout } from "../navigation/inner-layout.tsx";
import { WebhookFields } from "./webhook-settings.tsx";

type LogoMode = "upload" | "url";

function logoError(value: string): string | undefined {
	const logo = value.trim();
	if (!logo) return undefined;
	return (logo.startsWith("/") && !logo.startsWith("//")) || /^https?:\/\//i.test(logo)
		? undefined
		: "请输入以单个 / 开头的员工端本站路径，或 http(s) 在线地址";
}

function fileError(file: File): string | undefined {
	if (!(BRANDING_LOGO_TYPES as readonly string[]).includes(file.type)) return "仅支持 PNG、JPEG、WebP 或 SVG 图片";
	if (file.size > BRANDING_LOGO_MAX_BYTES) return `图片不能超过 ${Math.floor(BRANDING_LOGO_MAX_BYTES / 1024)}KB`;
	return undefined;
}

function BrandPreview({ productName, logoUrl }: { productName: string; logoUrl?: string }) {
	const [failed, setFailed] = useState(false);
	const name = productName.trim() || DEFAULT_BRAND_PRODUCT_NAME;
	return (
		<div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
			<Typography.Text type="secondary">员工端预览</Typography.Text>
			<div className="mt-3 flex items-center gap-3">
				{logoUrl && !failed ? (
					<img
						src={logoUrl}
						alt=""
						aria-hidden="true"
						className="size-10 rounded-md bg-white object-contain"
						onError={() => setFailed(true)}
					/>
				) : (
					<span
						aria-hidden="true"
						className="grid size-10 place-items-center rounded-md bg-neutral-900 text-sm font-semibold text-white"
					>
						{name.charAt(0).toUpperCase()}
					</span>
				)}
				<span className="min-w-0 break-words text-base font-semibold">{name}</span>
			</div>
		</div>
	);
}

function UploadLogoControl({
	file,
	hasLogo,
	disabled,
	error,
	onFile,
	onRemove,
}: {
	file: File | null;
	hasLogo: boolean;
	disabled: boolean;
	error?: string;
	onFile: (file: File) => void;
	onRemove: () => void;
}) {
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-3">
				<Upload
					accept={BRANDING_LOGO_TYPES.join(",")}
					showUploadList={false}
					disabled={disabled}
					beforeUpload={(next) => {
						onFile(next);
						return false;
					}}
				>
					<Button icon={<UploadOutlined />} disabled={disabled}>
						选择图片
					</Button>
				</Upload>
				{file ? <span className="min-w-0 break-all text-xs text-neutral-500">{file.name}</span> : null}
				{hasLogo && !file ? (
					<Button type="link" danger disabled={disabled} onClick={onRemove}>
						移除当前 Logo
					</Button>
				) : null}
			</div>
			<span className="block text-xs leading-5 text-neutral-500">
				支持 PNG、JPEG、WebP、SVG，最大 {Math.floor(BRANDING_LOGO_MAX_BYTES / 1024)}KB；不选择新图片时沿用当前 Logo。
			</span>
			{error ? <span className="block text-xs text-red-600">{error}</span> : null}
		</div>
	);
}

function useLogoEditor(initialUrl: string | undefined) {
	const [logoUrl, setLogoUrl] = useState(initialUrl ?? "");
	const [baseline, setBaseline] = useState(initialUrl ?? "");
	const [mode, setMode] = useState<LogoMode>("upload");
	const [file, setFile] = useState<File | null>(null);
	const [filePreviewUrl, setFilePreviewUrl] = useState<string>();
	const [uploadError, setUploadError] = useState<string>();
	const [removeLogo, setRemoveLogo] = useState(false);

	useEffect(() => {
		if (!file) {
			setFilePreviewUrl(undefined);
			return;
		}
		const url = URL.createObjectURL(file);
		setFilePreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	const clearDraft = () => {
		setMode("upload");
		setFile(null);
		setUploadError(undefined);
		setRemoveLogo(false);
	};
	const changeMode = (next: LogoMode) => {
		setMode(next);
		setFile(null);
		setUploadError(undefined);
		setRemoveLogo(false);
	};
	const chooseFile = (next: File) => {
		const error = fileError(next);
		setUploadError(error);
		if (error) return;
		setFile(next);
		setRemoveLogo(false);
	};
	const changeUrl = (next: string) => {
		setLogoUrl(next);
		setRemoveLogo(false);
	};
	const remove = () => {
		setFile(null);
		setUploadError(undefined);
		setRemoveLogo(true);
	};
	const restore = (nextUrl?: string) => {
		const value = nextUrl ?? baseline;
		setBaseline(value);
		setLogoUrl(value);
		clearDraft();
	};
	const previewUrl = removeLogo ? undefined : (filePreviewUrl ?? (logoUrl.trim() || undefined));
	const urlDirty = mode === "url" && logoUrl.trim() !== baseline;
	return {
		mode,
		logoUrl,
		file,
		uploadError,
		removeLogo,
		previewUrl,
		dirty: Boolean(file || removeLogo || urlDirty),
		hasLogo: Boolean((logoUrl || file) && !removeLogo),
		urlError: mode === "url" ? logoError(logoUrl) : undefined,
		changeMode,
		changeUrl,
		chooseFile,
		remove,
		restore,
	};
}

function LogoFields({ editor, disabled }: { editor: ReturnType<typeof useLogoEditor>; disabled: boolean }) {
	return (
		<div className="space-y-4 rounded-lg border border-neutral-200 p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="text-sm font-medium">Logo</span>
				<Segmented<LogoMode>
					options={[
						{ label: "上传图片", value: "upload" },
						{ label: "填写 URL", value: "url" },
					]}
					value={editor.mode}
					disabled={disabled}
					onChange={editor.changeMode}
				/>
			</div>
			{editor.mode === "upload" ? (
				<UploadLogoControl
					file={editor.file}
					hasLogo={editor.hasLogo}
					disabled={disabled}
					error={editor.uploadError}
					onFile={editor.chooseFile}
					onRemove={editor.remove}
				/>
			) : (
				<div className="space-y-3">
					<label htmlFor="branding-logo-url" className="text-sm font-medium">
						Logo 地址
					</label>
					<Input
						id="branding-logo-url"
						aria-label="Logo 地址"
						value={editor.logoUrl}
						placeholder={`${BRANDING_LOGO_PATH} 或 https://cdn.example.com/logo.svg`}
						maxLength={2048}
						status={editor.urlError ? "error" : undefined}
						disabled={disabled}
						onChange={(event) => editor.changeUrl(event.target.value)}
					/>
					<span className="block text-xs leading-5 text-neutral-500">
						支持员工端本站路径（以单个 / 开头）或在线 http(s) 地址；留空回退名称首字母。
					</span>
					{editor.urlError ? <span className="block text-xs text-red-600">{editor.urlError}</span> : null}
				</div>
			)}
		</div>
	);
}

function normalizeEndpoint(value: string) {
	return value.trim().replace(/\/+$/, "");
}

function endpointError(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) return "请填写端点 URL";
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "请填写 http 或 https 地址";
	} catch {
		return "请填写 http 或 https 地址";
	}
	return undefined;
}

function errorText(error: unknown) {
	return error instanceof Error ? error.message : "保存失败";
}

async function saveBrand(name: string, editor: ReturnType<typeof useLogoEditor>) {
	if (editor.mode === "upload") {
		if (editor.file) {
			await adminApi.branding.uploadLogo(editor.file);
			return adminApi.branding.update({ productName: name });
		}
		return adminApi.branding.update({ productName: name, ...(editor.removeLogo ? { logoUrl: null } : {}) });
	}
	return adminApi.branding.update({ productName: name, logoUrl: editor.logoUrl.trim() || null });
}

interface PersistResult<T> {
	saved?: T;
	note?: string;
	error?: string;
}

async function persistBrand(
	name: string,
	editor: ReturnType<typeof useLogoEditor>,
): Promise<PersistResult<BrandingView>> {
	if (!name.trim()) return { error: "产品名称不能为空" };
	if (editor.urlError || editor.uploadError) return { error: editor.urlError ?? editor.uploadError };
	try {
		const saved = await saveBrand(name.trim(), editor);
		return { saved, note: "品牌已保存，员工端刷新后生效。" };
	} catch (error) {
		return { error: errorText(error) };
	}
}

async function persistWebhook(publicUrl: string): Promise<PersistResult<WebhookSettingsView>> {
	const invalid = endpointError(publicUrl);
	if (!invalid) {
		try {
			const saved = await adminApi.webhook.update(publicUrl.trim());
			return { saved, ...(saved.status === "active" ? { note: "回调地址已登记。" } : {}) };
		} catch (error) {
			return { error: errorText(error) };
		}
	}
	return { error: invalid };
}

async function saveBrandSection(
	name: string,
	editor: ReturnType<typeof useLogoEditor>,
	apply: (saved: BrandingView) => void,
	fail: (message: string) => void,
) {
	const result = await persistBrand(name, editor);
	if (result.error) fail(result.error);
	if (!result.saved) return;
	apply(result.saved);
	return result.note;
}

async function saveWebhookSection(
	publicUrl: string,
	apply: (saved: WebhookSettingsView) => void,
	fail: (message: string) => void,
) {
	const result = await persistWebhook(publicUrl);
	if (result.error) fail(result.error);
	if (!result.saved) return;
	apply(result.saved);
	return result.note;
}

function SettingsForm({
	brand,
	webhook,
	canWrite,
	readOnly,
	onBrandSaved,
	onWebhookSaved,
}: {
	brand: BrandingView;
	webhook: WebhookSettingsView;
	canWrite: boolean;
	readOnly: boolean;
	onBrandSaved: () => void;
	onWebhookSaved: () => void;
}) {
	const [productName, setProductName] = useState(brand.productName);
	const [nameBaseline, setNameBaseline] = useState(brand.productName);
	const [publicUrl, setPublicUrl] = useState(webhook.publicUrl ?? "");
	const [webhookBase, setWebhookBase] = useState(webhook);
	const [brandError, setBrandError] = useState<string>();
	const [webhookError, setWebhookError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [pending, setPending] = useState(false);
	const [probing, setProbing] = useState(false);
	const editor = useLogoEditor(brand.logoUrl);
	const test = useAdminMutation(() => adminApi.webhook.test());
	const nameDirty = productName.trim() !== nameBaseline;
	const webhookDirty = normalizeEndpoint(publicUrl) !== normalizeEndpoint(webhookBase.publicUrl ?? "");
	const dirty = nameDirty || editor.dirty || webhookDirty;
	const testing = test.pending || probing;
	const disabled = !canWrite || pending || testing;
	const submit = async () => {
		if (disabled || !dirty) return;
		setPending(true);
		setBrandError(undefined);
		setWebhookError(undefined);
		setNotice(undefined);
		const brandNote =
			nameDirty || editor.dirty
				? await saveBrandSection(
						productName,
						editor,
						(saved) => {
							setProductName(saved.productName);
							setNameBaseline(saved.productName);
							editor.restore(saved.logoUrl);
							onBrandSaved();
						},
						setBrandError,
					)
				: undefined;
		const webhookNote = webhookDirty
			? await saveWebhookSection(
					publicUrl,
					(saved) => {
						setPublicUrl(saved.publicUrl ?? "");
						setWebhookBase(saved);
						onWebhookSaved();
					},
					setWebhookError,
				)
			: undefined;
		const notes = [brandNote, webhookNote].filter((note) => note);
		if (notes.length > 0) setNotice(notes.join(""));
		setPending(false);
	};
	return (
		<form
			className="max-w-2xl space-y-8"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<div className="space-y-6">
				<h2 className="text-base font-semibold">品牌配置</h2>
				<div className="space-y-2">
					<label htmlFor="branding-product-name" className="text-sm font-medium">
						产品名称
					</label>
					<Input
						id="branding-product-name"
						aria-label="产品名称"
						value={productName}
						maxLength={60}
						showCount
						status={!productName.trim() ? "error" : undefined}
						disabled={disabled}
						onChange={(event) => {
							setProductName(event.target.value);
							setNotice(undefined);
						}}
					/>
					{productName.trim() ? null : <span className="block text-xs text-red-600">产品名称不能为空</span>}
				</div>
				<LogoFields editor={editor} disabled={disabled} />
				<BrandPreview
					key={`${productName}:${editor.previewUrl ?? ""}`}
					productName={productName}
					logoUrl={editor.previewUrl}
				/>
				{brandError ? <Alert type="error" showIcon title="品牌保存失败" description={brandError} /> : null}
			</div>
			<WebhookFields
				value={publicUrl}
				saved={webhookBase}
				dirty={webhookDirty}
				disabled={disabled}
				testing={testing}
				error={webhookError || test.error || undefined}
				onChange={(next) => {
					setPublicUrl(next);
					setWebhookError(undefined);
					setNotice(undefined);
				}}
				onTest={() => {
					const invalid = endpointError(publicUrl);
					if (invalid) {
						setWebhookError(invalid);
						return;
					}
					if (!webhookDirty && webhookBase.status !== "unconfigured") {
						void test.run().then((saved) => {
							setWebhookBase(saved);
							setWebhookError(saved.status === "error" ? saved.detail : undefined);
						});
						return;
					}
					setProbing(true);
					setWebhookError(undefined);
					void adminApi.webhook
						.update(publicUrl.trim())
						.then((saved) => {
							setPublicUrl(saved.publicUrl ?? "");
							setWebhookBase(saved);
							setWebhookError(saved.status === "error" ? saved.detail : undefined);
							onWebhookSaved();
						})
						.catch((error: unknown) => setWebhookError(errorText(error)))
						.finally(() => setProbing(false));
				}}
			/>
			{readOnly ? <Alert type="info" showIcon title="当前身份只读，不能修改配置。" /> : null}
			{notice ? <Alert type="success" showIcon title={notice} /> : null}
			<Space className="pt-1">
				<Button type="primary" htmlType="submit" loading={pending} disabled={!canWrite || !dirty || test.pending}>
					保存
				</Button>
				<Button
					disabled={disabled}
					onClick={() => {
						setProductName(nameBaseline);
						setPublicUrl(webhookBase.publicUrl ?? "");
						editor.restore();
						setBrandError(undefined);
						setWebhookError(undefined);
						setNotice(undefined);
					}}
				>
					重置
				</Button>
			</Space>
		</form>
	);
}

/** 管理端配置：品牌与回调端点分块展示，页底统一保存。 */
export function BrandingPage() {
	const brand = useAdminQuery("branding:config", (signal) => adminApi.branding.get(signal));
	const webhook = useAdminQuery("webhook:settings", (signal) => adminApi.webhook.get(signal));
	const identity = useAdminQuery("branding:identity", (signal) => getAdminClient().identity(signal));
	const reload = () => {
		void brand.refresh();
		void webhook.refresh();
	};
	if (brand.error || webhook.error)
		return (
			<Result
				status="error"
				title="配置加载失败"
				subTitle={brand.error || webhook.error}
				extra={
					<Button aria-label="重试" onClick={reload}>
						重试
					</Button>
				}
			/>
		);
	if (!brand.data || !webhook.data) return <Skeleton active paragraph={{ rows: 8 }} />;
	return (
		<section aria-label="配置" className="space-y-6">
			<InnerLayout title="配置" description="员工端的产品名称、Logo，以及百炼回调的端点 URL。" />
			<SettingsForm
				brand={brand.data}
				webhook={webhook.data}
				canWrite={identity.data?.role === "admin"}
				readOnly={identity.data?.role === "auditor"}
				onBrandSaved={() => void brand.refresh()}
				onWebhookSaved={() => void webhook.refresh()}
			/>
		</section>
	);
}
