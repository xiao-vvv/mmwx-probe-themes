import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchLoginUser,
	fetchMonitor,
	fetchServerMetrics,
	fetchService,
	fetchSetting,
} from "@/lib/nezha-api";

const jsonResponse = (body: unknown, init?: ResponseInit) =>
	new Response(JSON.stringify(body), {
		status: init?.status ?? 200,
		statusText: init?.statusText,
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
	});

const probePayload = {
	enabled: true,
	title: "MMWX Probe",
	logo: "https://example.com/logo.png",
	servers: [
		{
			name: "edge",
			online: true,
			ping: [
				{
					label: "Ping",
					current_ms: 12,
					loss_pct: 0,
					buckets: [{ ms: 12, loss: 0 }],
				},
			],
		},
	],
};

describe("MMWX API adapter", () => {
	let now = 1_800_000_000_000;

	beforeEach(() => {
		now += 5000;
		vi.useFakeTimers();
		vi.setSystemTime(now);
		vi.stubGlobal("fetch", vi.fn());
		window.history.replaceState(null, "", "/");
	});

	it("builds theme settings from the protected probe endpoint", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(probePayload));

		const setting = await fetchSetting();

		expect(setting).toMatchObject({
			success: true,
			data: {
				config: { language: "zh-CN", site_name: "MMWX Probe" },
				version: "MMWX",
			},
		});
		expect(window.CustomLogo).toBe("https://example.com/logo.png");
		expect(fetch).toHaveBeenCalledWith(
			"/api/probe",
			expect.objectContaining({ cache: "no-store" }),
		);
	});

	it("configures the isolated beauty background and card layout", async () => {
		window.history.replaceState(
			null,
			"",
			"/themes/nezha-dash/index.html?skin=beauty",
		);
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(probePayload));

		const setting = await fetchSetting();

		expect(window.CustomBackgroundImage).toMatch(
			/\/beauty-background-desktop-v3\.webp$/,
		);
		expect(window.CustomMobileBackgroundImage).toMatch(
			/\/beauty-background-mobile-v3\.webp$/,
		);
		expect(
			(window as unknown as Record<string, unknown>).FixedTopServerName,
		).toBe(true);
		expect((window as unknown as Record<string, unknown>).ShowNetTransfer).toBe(
			true,
		);
		expect(setting.data.config.custom_code).toBe("");
	});

	it("derives service status from MMWX ping buckets", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(probePayload));

		const service = await fetchService();

		expect(service.data.services["1-1"]).toMatchObject({
			service_name: "edge · Ping",
			delay: [12],
			up: [1],
		});
	});

	it("requests MMWX ping and system histories with zero-based indexes", async () => {
		const sevenServers = {
			...probePayload,
			servers: Array.from({ length: 7 }, (_, index) => ({
				name: `edge-${index + 1}`,
				online: true,
			})),
		};
		vi.mocked(fetch)
			.mockResolvedValueOnce(jsonResponse(sevenServers))
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					all_series: [
						{
							label: "Ping",
							current_ms: 20,
							loss_pct: 0,
							buckets: [{ ms: 20, loss: 0 }],
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					series: { cpu_pct: [{ t: 1_700_000_000, value: 25 }] },
				}),
			);

		const monitor = await fetchMonitor(7, "7d");
		const metrics = await fetchServerMetrics(7, "cpu", "30d");

		expect(monitor.data[0]).toMatchObject({
			server_id: 7,
			server_name: "edge-7",
			avg_delay: [20],
		});
		expect(metrics.data.data_points).toEqual([
			{ ts: 1_700_000_000_000, value: 25 },
		]);
		expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
			"/api/probe",
			"/api/series?server=6&range=24h&all=1",
			"/api/series?server=6&range=24h&metric=system",
		]);
	});

	it("keeps the Nezha login surface anonymous without extra requests", async () => {
		await expect(fetchLoginUser()).resolves.toMatchObject({
			success: false,
			data: { id: 0 },
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it("deduplicates concurrent system history requests for one server", async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(jsonResponse(probePayload))
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					series: { cpu_pct: [{ t: 1_700_000_000, value: 25 }] },
				}),
			);

		await Promise.all([
			fetchServerMetrics(1, "cpu", "1d"),
			fetchServerMetrics(1, "memory", "1d"),
			fetchServerMetrics(1, "disk", "1d"),
		]);

		expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
			"/api/probe",
			"/api/series?server=0&range=24h&metric=system",
		]);
	});

	it("returns an empty monitor list when MMWX has no ping history", async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(jsonResponse(probePayload))
			.mockResolvedValueOnce(jsonResponse({}, { status: 404 }));

		await expect(fetchMonitor(1)).resolves.toMatchObject({
			success: true,
			data: [],
		});
	});

	it("reports protected probe HTTP failures", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			jsonResponse({}, { status: 503, statusText: "Unavailable" }),
		);

		await expect(fetchSetting()).rejects.toThrow(
			"MMWX request failed: HTTP 503",
		);
	});
});
