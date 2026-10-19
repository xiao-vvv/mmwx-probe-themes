import type {
	LoginUserResponse,
	MetricPeriod,
	MetricType,
	MonitorResponse,
	ServerGroupResponse,
	ServerMetricsResponse,
	ServiceResponse,
	SettingResponse,
} from "@/types/nezha-api";
import {
	isMmwxProbePayload,
	type MmwxPingSeriesResponse,
	type MmwxProbePayload,
	type MmwxSystemSeriesResponse,
	mmwxServerIndex,
	toMonitorResponse,
	toServerGroupResponse,
	toServerMetricsResponse,
	toServiceResponse,
} from "./mmwx-adapter";
import { getMmwxSkin } from "./mmwx-skin";

let cachedProbe: MmwxProbePayload | undefined;
let cachedAt = 0;
let pendingProbe: Promise<MmwxProbePayload> | undefined;
const systemSeriesCache = new Map<
	number,
	{ payload: MmwxSystemSeriesResponse; cachedAt: number }
>();
const pendingSystemSeries = new Map<
	number,
	Promise<MmwxSystemSeriesResponse>
>();

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		cache: "no-store",
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`MMWX request failed: HTTP ${response.status}`);
	}
	return response.json() as Promise<T>;
}

async function fetchOptionalJson<T>(url: string): Promise<T | undefined> {
	const response = await fetch(url, {
		cache: "no-store",
		headers: { Accept: "application/json" },
	});
	if (response.status === 404) return undefined;
	if (!response.ok) {
		throw new Error(`MMWX request failed: HTTP ${response.status}`);
	}
	return response.json() as Promise<T>;
}

async function fetchSystemSeries(serverIndex: number) {
	const cached = systemSeriesCache.get(serverIndex);
	if (cached && Date.now() - cached.cachedAt < 2000) return cached.payload;

	const pending = pendingSystemSeries.get(serverIndex);
	if (pending) return pending;

	const query = new URLSearchParams({
		server: String(serverIndex),
		range: "24h",
		metric: "system",
	});
	const request = fetchJson<MmwxSystemSeriesResponse>(`/api/series?${query}`)
		.then((payload) => {
			systemSeriesCache.set(serverIndex, { payload, cachedAt: Date.now() });
			return payload;
		})
		.finally(() => pendingSystemSeries.delete(serverIndex));
	pendingSystemSeries.set(serverIndex, request);
	return request;
}

export function rememberProbePayload(payload: MmwxProbePayload): void {
	cachedProbe = payload;
	cachedAt = Date.now();
}

export async function fetchProbePayload(options?: {
	force?: boolean;
}): Promise<MmwxProbePayload> {
	if (!options?.force && cachedProbe && Date.now() - cachedAt < 1500) {
		return cachedProbe;
	}
	if (pendingProbe) return pendingProbe;

	pendingProbe = fetchJson<unknown>("/api/probe")
		.then((payload) => {
			if (!isMmwxProbePayload(payload)) {
				throw new TypeError("MMWX probe returned an invalid payload");
			}
			rememberProbePayload(payload);
			return payload;
		})
		.finally(() => {
			pendingProbe = undefined;
		});
	return pendingProbe;
}

function configureThemeWindow(payload: MmwxProbePayload): void {
	const defaultLogo = `${import.meta.env.BASE_URL}apple-touch-icon.png`;
	const beautySkin = getMmwxSkin() === "beauty";
	// v3: 2026-08-18 gpt-image-2 生成的星露谷像素农场, 桌面横版+手机竖版成套(白猫彩蛋);
	// 带版本号文件名避开静态资源 1 天缓存
	const farmBackground = `${import.meta.env.BASE_URL}farm-background-desktop-v3.webp`;
	const farmMobileBackground = `${import.meta.env.BASE_URL}farm-background-mobile-v3.webp`;
	// v3: 2026-08-18 重画(v2 刘海是散乱粉线条糊在额头上); 同款 90s 少女漫风,
	// 发块干净、额头清爽, 顺带 PNG→webp 体积降 94%
	const beautyBackground = `${import.meta.env.BASE_URL}beauty-background-desktop-v3.webp`;
	const beautyMobileBackground = `${import.meta.env.BASE_URL}beauty-background-mobile-v3.webp`;
	Object.assign(window, {
		CustomLogo: payload.logo || defaultLogo,
		CustomDesc: "",
		ShowNetTransfer: true,
		FixedTopServerName: beautySkin,
	});

	const defaults: Record<string, unknown> = {
		CustomBackgroundImage: farmBackground,
		CustomMobileBackgroundImage: farmMobileBackground,
		DisableAnimatedMan: false,
		CustomIllustration: `${import.meta.env.BASE_URL}hoshino-ai-card-sitter.png`,
		CustomLinks: "",
		ForceTheme: "",
		ForceShowServices: false,
		ForceCardInline: false,
		ForceShowMap: false,
		ForcePeakCutEnabled: false,
		ForceUseSvgFlag: false,
	};
	const mutableWindow = window as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(defaults)) {
		if (mutableWindow[key] === undefined) mutableWindow[key] = value;
	}
	if (beautySkin) {
		mutableWindow.CustomBackgroundImage = beautyBackground;
		mutableWindow.CustomMobileBackgroundImage = beautyMobileBackground;
	}

	const colorMode = payload.appearance?.color_mode;
	if (
		(colorMode === "light" || colorMode === "dark" || colorMode === "system") &&
		!localStorage.getItem("vite-ui-theme")
	) {
		localStorage.setItem("vite-ui-theme", colorMode);
	}
}

export const fetchServerGroup = async (): Promise<ServerGroupResponse> => {
	return toServerGroupResponse(await fetchProbePayload());
};

export const fetchLoginUser = async (): Promise<LoginUserResponse> => {
	return {
		success: false,
		data: {
			id: 0,
			username: "",
			password: "",
			created_at: "",
			updated_at: "",
		},
	};
};

export type MonitorPeriod = "1d" | "7d" | "30d";

export const fetchMonitor = async (
	serverId: number,
	_period: MonitorPeriod = "1d",
): Promise<MonitorResponse> => {
	const payload = await fetchProbePayload();
	const serverIndex = mmwxServerIndex(serverId);
	const serverName =
		payload.servers?.[serverIndex]?.name?.trim() || `服务器 ${serverId}`;
	const query = new URLSearchParams({
		server: String(serverIndex),
		range: "24h",
		all: "1",
	});
	const series = await fetchOptionalJson<MmwxPingSeriesResponse>(
		`/api/series?${query}`,
	);
	return toMonitorResponse(
		series || { success: true, all_series: [] },
		serverId,
		serverName,
		"1d",
	);
};

export const fetchService = async (): Promise<ServiceResponse> => {
	return toServiceResponse(await fetchProbePayload());
};

export const fetchSetting = async (): Promise<SettingResponse> => {
	const payload = await fetchProbePayload();
	configureThemeWindow(payload);
	return {
		success: true,
		data: {
			config: {
				debug: false,
				language: "zh-CN",
				// 主控标题为空时不显示兜底文案(站长清空标题=不想显示站名)
				site_name: payload.title?.trim() || "",
				user_template: "mmwx-nezha-dash",
				admin_template: "",
				custom_code: "",
			},
			version: "MMWX",
			tsdb_enabled: true,
		},
	};
};

export const fetchServerMetrics = async (
	serverId: number,
	metric: MetricType,
	_period?: MetricPeriod,
): Promise<ServerMetricsResponse> => {
	const payload = await fetchProbePayload();
	const serverIndex = mmwxServerIndex(serverId);
	const serverName =
		payload.servers?.[serverIndex]?.name?.trim() || `服务器 ${serverId}`;
	const series = await fetchSystemSeries(serverIndex);
	return toServerMetricsResponse(series, serverId, serverName, metric);
};
