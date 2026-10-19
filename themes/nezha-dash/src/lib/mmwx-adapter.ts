import type {
	CycleTransferStats,
	MetricType,
	MonitorResponse,
	NezhaServer,
	NezhaWebsocketResponse,
	ServerGroupResponse,
	ServerMetricsResponse,
	ServiceData,
	ServiceResponse,
} from "@/types/nezha-api";
import { PLAN_TAG_RULES, type PlanTagRule } from "@/plan-tags.config";

export interface MmwxProbeBucket {
	ms: number;
	loss: number;
}

export interface MmwxProbePingSeries {
	key?: string;
	label: string;
	isp?: string;
	current_ms: number;
	loss_pct: number;
	buckets: MmwxProbeBucket[];
}

export interface MmwxProbeServer {
	name?: string;
	region?: string;
	region_country?: string;
	region_name?: string;
	region_city?: string;
	online: boolean;
	upload_speed?: number;
	download_speed?: number;
	traffic_used?: number;
	traffic_limit?: number;
	traffic_used_up?: number;
	traffic_used_down?: number;
	traffic_used_total?: number;
	period_start?: string;
	period_end?: string;
	cumulative_up?: number;
	cumulative_down?: number;
	cpu_pct?: number;
	loadavg?: string;
	mem_used?: number;
	mem_total?: number;
	disk_used?: number;
	disk_total?: number;
	uptime?: number;
	cpu_model?: string;
	cpu_cores?: number;
	cpu_threads?: number;
	os?: string;
	kernel?: string;
	arch?: string;
	ping?: MmwxProbePingSeries[];
	expires_at?: string;
	renewal_price?: number;
	renewal_price_cny?: number;
	renewal_cycle?: "month" | "quarter" | "half_year" | "year";
	renewal_currency?: string;
	provider_name?: string;
	provider_url?: string;
	return_routes?: Array<{
		carrier: "telecom" | "unicom" | "mobile";
		region?: string;
		route_type: string;
		tested_at?: string;
	}>;
}

export interface MmwxProbePayload {
	enabled: boolean;
	title?: string;
	logo?: string;
	appearance?: {
		theme?: string;
		color_mode?: "light" | "dark" | "system";
	};
	servers?: MmwxProbeServer[];
}

export interface MmwxSystemPoint {
	t: number;
	value: number;
}

export interface MmwxSystemSeriesResponse {
	success: boolean;
	series?: Record<string, MmwxSystemPoint[]>;
}

export interface MmwxPingSeriesResponse {
	success: boolean;
	series?: MmwxProbePingSeries;
	all_series?: MmwxProbePingSeries[];
}

const CYCLE_LABEL: Record<
	NonNullable<MmwxProbeServer["renewal_cycle"]>,
	string
> = {
	month: "月",
	quarter: "季",
	half_year: "半年",
	year: "年",
};

const CYCLE_MONTHS: Record<
	NonNullable<MmwxProbeServer["renewal_cycle"]>,
	number
> = {
	month: 1,
	quarter: 3,
	half_year: 6,
	year: 12,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
	USD: "$",
	CNY: "¥",
	EUR: "€",
	GBP: "£",
	CAD: "C$",
	AUD: "A$",
	HKD: "HK$",
	TWD: "NT$",
	SGD: "S$",
	KRW: "₩",
	JPY: "¥",
};

const METRIC_KEYS: Partial<Record<MetricType, string>> = {
	cpu: "cpu_pct",
	memory: "mem_used",
	disk: "disk_used",
	net_in_speed: "download_speed",
	net_out_speed: "upload_speed",
	net_in_transfer: "cumulative_down",
	net_out_transfer: "cumulative_up",
	uptime: "uptime",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isMmwxProbePayload(value: unknown): value is MmwxProbePayload {
	if (!isRecord(value) || typeof value.enabled !== "boolean") return false;
	return value.servers === undefined || Array.isArray(value.servers);
}

function finite(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseLoadAverage(value?: string): [number, number, number] {
	const values = (value || "")
		.trim()
		.split(/[\s,]+/)
		.map(Number)
		.filter(Number.isFinite);
	return [values[0] || 0, values[1] || 0, values[2] || 0];
}

function countryCode(server: MmwxProbeServer): string {
	const explicit = server.region_country?.trim().toUpperCase();
	if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit;

	const region = server.region?.trim() || "";
	if (/^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
	const indicators = [...region]
		.map((character) => character.codePointAt(0) || 0)
		.filter((point) => point >= 0x1f1e6 && point <= 0x1f1ff)
		.slice(0, 2);
	if (indicators.length !== 2) return "";
	return indicators
		.map((point) => String.fromCharCode(65 + point - 0x1f1e6))
		.join("");
}

function displayName(server: MmwxProbeServer, index: number): string {
	const raw = server.name?.trim() || "";
	const withoutFlag = raw.replace(/^[\u{1f1e6}-\u{1f1ff}]{2}\s*/u, "");
	return withoutFlag || raw || `服务器 ${index + 1}`;
}

function cycleStart(
	expiresAt: string,
	cycle?: MmwxProbeServer["renewal_cycle"],
): string {
	const expiry = new Date(expiresAt);
	if (!Number.isFinite(expiry.getTime())) return "";
	const months = cycle ? CYCLE_MONTHS[cycle] : 1;
	const day = expiry.getUTCDate();
	expiry.setUTCDate(1);
	expiry.setUTCMonth(expiry.getUTCMonth() - months);
	const lastDay = new Date(
		Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0),
	).getUTCDate();
	expiry.setUTCDate(Math.min(day, lastDay));
	return expiry.toISOString().slice(0, 10);
}

function currencyPrefix(server: MmwxProbeServer): string {
	if (
		server.renewal_price === undefined &&
		server.renewal_price_cny !== undefined
	) {
		return "¥";
	}
	const code = server.renewal_currency?.trim().toUpperCase();
	if (!code) return "";
	return CURRENCY_SYMBOLS[code] || `${code} `;
}

function renewalAmount(server: MmwxProbeServer): string {
	const value =
		server.renewal_price ??
		(server.renewal_price === undefined ? server.renewal_price_cny : undefined);
	if (value === undefined || !Number.isFinite(value)) return "";
	return `${currencyPrefix(server)}${value}`;
}

function formatQuota(value?: number): string {
	if (!value || value <= 0) return "";
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let amount = value;
	let unit = 0;
	while (amount >= 1024 && unit < units.length - 1) {
		amount /= 1024;
		unit += 1;
	}
	return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)}${units[unit]}`;
}

function trafficUsedBytes(server: MmwxProbeServer): number {
	const directional =
		finite(server.traffic_used_up) + finite(server.traffic_used_down);
	return Math.max(
		0,
		finite(server.traffic_used_total ?? server.traffic_used, directional),
	);
}

/* 线路/带宽/IPv6 标签: 规则在 src/plan-tags.config.ts。networkRoute 用逗号分隔,
   PlanInfo 会在单个标签内以全角竖线相连。 */
function matchedPlanRules(server: MmwxProbeServer): PlanTagRule[] {
	const name = (server.name || "").toLowerCase();
	const provider = (server.provider_name || "").toLowerCase();
	const country = (server.region_country || "").trim().toUpperCase();
	const anyIn = (hay: string, keys?: string[]) =>
		!keys || keys.some((k) => hay.includes(k.toLowerCase()));
	return PLAN_TAG_RULES.filter(
		(rule) =>
			anyIn(name, rule.nameIncludes) &&
			anyIn(provider, rule.providerIncludes) &&
			(!rule.nameRegex || rule.nameRegex.test(server.name || "")) &&
			(!rule.country ||
				rule.country.some((c) => c.toUpperCase() === country)),
	);
}

function planLineTags(server: MmwxProbeServer): {
	bandwidth: string;
	networkRoute: string;
} {
	let bandwidth = "";
	let networkRoute = "";
	for (const rule of matchedPlanRules(server)) {
		if (rule.bandwidth !== undefined) bandwidth = rule.bandwidth;
		if (rule.networkRoute !== undefined) networkRoute = rule.networkRoute;
	}
	return { bandwidth, networkRoute };
}

function hasIPv6(server: MmwxProbeServer): boolean {
	let ipv6 = true;
	for (const rule of matchedPlanRules(server)) {
		if (rule.ipv6 !== undefined) ipv6 = rule.ipv6;
	}
	return ipv6;
}

function publicNote(server: MmwxProbeServer): string {
	const trafficLimitBytes = Math.max(0, finite(server.traffic_limit));
	const billingDataMod = server.expires_at
		? {
				startDate: cycleStart(server.expires_at, server.renewal_cycle),
				endDate: server.expires_at,
				autoRenewal: "0",
				cycle: server.renewal_cycle ? CYCLE_LABEL[server.renewal_cycle] : "",
				amount: renewalAmount(server),
			}
		: undefined;
	const { bandwidth, networkRoute } = planLineTags(server);
	// IPv4 全员; IPv6 只标真有 v6 的机器; 无流量上限的机器标"无限流量"
	const planDataMod = {
		bandwidth,
		trafficVol:
			trafficLimitBytes > 0 ? formatQuota(trafficLimitBytes) : "无限流量",
		trafficType: "",
		IPv4: "1",
		IPv6: hasIPv6(server) ? "1" : "",
		networkRoute,
		extra: "",
		trafficUsedBytes: trafficUsedBytes(server),
		trafficLimitBytes,
		...(server.period_end?.trim()
			? { periodEnd: server.period_end.trim() }
			: {}),
	};
	return JSON.stringify({ billingDataMod, planDataMod });
}

export function mmwxServerId(index: number): number {
	return index + 1;
}

export function mmwxServerIndex(id: number): number {
	return Math.max(0, Math.trunc(id) - 1);
}

export function toNezhaServer(
	server: MmwxProbeServer,
	index: number,
	now = Date.now(),
): NezhaServer {
	const [load1, load5, load15] = parseLoadAverage(server.loadavg);
	const uptime = Math.max(0, finite(server.uptime));
	const cores = Math.max(0, Math.trunc(finite(server.cpu_cores)));
	const cpuDescription = [server.cpu_model, cores ? `${cores} Core` : ""]
		.filter(Boolean)
		.join(" · ");
	const netOutTransfer = server.cumulative_up ?? server.traffic_used_up ?? 0;
	const netInTransfer = server.cumulative_down ?? server.traffic_used_down ?? 0;

	return {
		id: mmwxServerId(index),
		name: displayName(server, index),
		public_note: publicNote(server),
		last_active: server.online
			? new Date(now).toISOString()
			: "0001-01-01T00:00:00.000Z",
		country_code: countryCode(server),
		host: {
			platform: server.os || "",
			platform_version: server.kernel || "",
			cpu: cpuDescription ? [cpuDescription] : [],
			gpu: [],
			mem_total: Math.max(0, finite(server.mem_total)),
			disk_total: Math.max(0, finite(server.disk_total)),
			swap_total: 0,
			arch: server.arch || "",
			boot_time: uptime ? Math.max(0, Math.floor(now / 1000) - uptime) : 0,
			version: "MMWX",
		},
		state: {
			cpu: Math.max(0, finite(server.cpu_pct)),
			mem_used: Math.max(0, finite(server.mem_used)),
			swap_used: 0,
			disk_used: Math.max(0, finite(server.disk_used)),
			net_in_transfer: Math.max(0, finite(netInTransfer)),
			net_out_transfer: Math.max(0, finite(netOutTransfer)),
			net_in_speed: Math.max(0, finite(server.download_speed)),
			net_out_speed: Math.max(0, finite(server.upload_speed)),
			uptime,
			load_1: load1,
			load_5: load5,
			load_15: load15,
			tcp_conn_count: 0,
			udp_conn_count: 0,
			process_count: 0,
			temperatures: [],
			gpu: [],
		},
	};
}

export function toNezhaWebsocketResponse(
	payload: MmwxProbePayload,
	now = Date.now(),
): NezhaWebsocketResponse {
	const servers = payload.enabled
		? (payload.servers || []).map((server, index) =>
				toNezhaServer(server, index, now),
			)
		: [];
	return {
		now,
		online: servers.filter((server) => !server.last_active.startsWith("000"))
			.length,
		servers,
	};
}

export function toServerGroupResponse(
	payload: MmwxProbePayload,
	now = Date.now(),
): ServerGroupResponse {
	const groups = new Map<string, number[]>();
	for (const [index, server] of (payload.servers || []).entries()) {
		const groupName = server.region_name?.trim() || server.region?.trim();
		if (!groupName) continue;
		const ids = groups.get(groupName) || [];
		ids.push(mmwxServerId(index));
		groups.set(groupName, ids);
	}
	return {
		success: true,
		data: [...groups.entries()].map(([name, servers], index) => ({
			group: {
				id: index + 1,
				created_at: new Date(now).toISOString(),
				updated_at: new Date(now).toISOString(),
				name,
			},
			servers,
		})),
	};
}

function toServiceData(
	server: MmwxProbeServer,
	line: MmwxProbePingSeries,
): ServiceData {
	const up = line.buckets.map((bucket) => (bucket.loss >= 100 ? 0 : 1));
	const down = up.map((value) => (value ? 0 : 1));
	return {
		service_name: `${server.name || "服务器"} · ${line.label}`,
		current_up: line.loss_pct >= 100 ? 0 : 1,
		current_down: line.loss_pct >= 100 ? 1 : 0,
		total_up: up.reduce<number>((sum, value) => sum + value, 0),
		total_down: down.reduce<number>((sum, value) => sum + value, 0),
		delay: line.buckets.map((bucket) => Math.max(0, finite(bucket.ms))),
		up,
		down,
	};
}

export function toServiceResponse(payload: MmwxProbePayload): ServiceResponse {
	const services: Record<string, ServiceData> = {};
	const cycleTransferStats: CycleTransferStats = {};

	for (const [index, server] of (payload.servers || []).entries()) {
		for (const [lineIndex, line] of (server.ping || []).entries()) {
			const key = `${mmwxServerId(index)}-${line.key || lineIndex + 1}`;
			services[key] = toServiceData(server, line);
		}

		const max = finite(server.traffic_limit);
		const from = server.period_start || "";
		const to = server.period_end || "";
		if (max > 0 && from && to) {
			const id = String(mmwxServerId(index));
			cycleTransferStats[`mmwx-${id}`] = {
				name: "流量周期",
				from,
				to,
				max,
				min: 0,
				server_name: { [id]: server.name || `服务器 ${id}` },
				transfer: { [id]: trafficUsedBytes(server) },
				next_update: { [id]: to },
			};
		}
	}

	return {
		success: true,
		data: {
			services,
			cycle_transfer_stats: cycleTransferStats,
		},
	};
}

function periodMilliseconds(period: "1d" | "7d" | "30d"): number {
	return period === "30d"
		? 30 * 86_400_000
		: period === "7d"
			? 7 * 86_400_000
			: 86_400_000;
}

export function toMonitorResponse(
	payload: MmwxPingSeriesResponse,
	serverId: number,
	serverName: string,
	period: "1d" | "7d" | "30d" = "1d",
	now = Date.now(),
): MonitorResponse {
	const lines = payload.all_series?.length
		? payload.all_series
		: payload.series
			? [payload.series]
			: [];
	return {
		success: payload.success,
		data: lines.map((line, index) => {
			const count = line.buckets.length;
			const step = count > 1 ? periodMilliseconds(period) / (count - 1) : 0;
			return {
				monitor_id: index + 1,
				monitor_name: line.label || `线路 ${index + 1}`,
				display_index: lines.length - index,
				server_id: serverId,
				server_name: serverName,
				created_at: line.buckets.map((_, bucketIndex) =>
					Math.round(now - (count - 1 - bucketIndex) * step),
				),
				avg_delay: line.buckets.map((bucket) => Math.max(0, finite(bucket.ms))),
				packet_loss: line.buckets.map((bucket) =>
					Math.max(0, finite(bucket.loss)),
				),
			};
		}),
	};
}

function normalizeTimestamp(value: number): number {
	return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
}

export function toServerMetricsResponse(
	payload: MmwxSystemSeriesResponse,
	serverId: number,
	serverName: string,
	metric: MetricType,
): ServerMetricsResponse {
	const key = METRIC_KEYS[metric];
	const points = key ? payload.series?.[key] || [] : [];
	return {
		success: payload.success,
		data: {
			server_id: serverId,
			server_name: serverName,
			metric,
			data_points: points
				.filter(
					(point) => Number.isFinite(point.t) && Number.isFinite(point.value),
				)
				.map((point) => ({
					ts: normalizeTimestamp(point.t),
					value: point.value,
				}))
				.sort((left, right) => left.ts - right.ts),
		},
	};
}
