import { describe, expect, it } from "vitest";
import {
	type MmwxProbePayload,
	mmwxServerId,
	mmwxServerIndex,
	toMonitorResponse,
	toNezhaWebsocketResponse,
	toServerGroupResponse,
	toServerMetricsResponse,
	toServiceResponse,
} from "@/lib/mmwx-adapter";

const payload: MmwxProbePayload = {
	enabled: true,
	title: "MMWX Probe",
	servers: [
		{
			name: "Tokyo-1",
			region: "🇯🇵",
			region_name: "东京",
			online: true,
			upload_speed: 1024,
			download_speed: 2048,
			cumulative_up: 30_000,
			cumulative_down: 40_000,
			cpu_pct: 12.5,
			loadavg: "0.12 0.34 0.56",
			mem_used: 256,
			mem_total: 1024,
			disk_used: 2048,
			disk_total: 4096,
			uptime: 3600,
			cpu_model: "Example CPU",
			cpu_cores: 2,
			os: "Debian",
			kernel: "6.1",
			arch: "amd64",
			expires_at: "2027-08-18",
			renewal_price: 5,
			renewal_currency: "USD",
			renewal_cycle: "month",
			provider_name: "Example Cloud",
			return_routes: [{ carrier: "telecom", route_type: "CN2 GIA" }],
			traffic_limit: 1_099_511_627_776,
			traffic_used_total: 500,
			period_start: "2026-08-01",
			period_end: "2026-09-01",
			ping: [
				{
					key: "ct",
					label: "中国电信",
					current_ms: 42,
					loss_pct: 0,
					buckets: [
						{ ms: 40, loss: 0 },
						{ ms: 42, loss: 1 },
					],
				},
			],
		},
	],
};

describe("MMWX adapter", () => {
	it("keeps Nezha ids aligned with zero-based MMWX series indexes", () => {
		expect(mmwxServerId(0)).toBe(1);
		expect(mmwxServerIndex(1)).toBe(0);
		expect(mmwxServerIndex(8)).toBe(7);
	});

	it("maps live server, region and billing fields", () => {
		const result = toNezhaWebsocketResponse(payload, 1_800_000_000_000);
		expect(result.online).toBe(1);
		expect(result.servers).toHaveLength(1);
		const server = result.servers[0];
		expect(server.id).toBe(1);
		expect(server.country_code).toBe("JP");
		expect(server.host.mem_total).toBe(1024);
		expect(server.state.net_out_speed).toBe(1024);
		expect(server.state.load_5).toBe(0.34);
		expect(JSON.parse(server.public_note)).toMatchObject({
			billingDataMod: {
				endDate: "2027-08-18",
				cycle: "月",
				amount: "$5",
			},
			planDataMod: {
				trafficVol: "1.0TB",
				trafficUsedBytes: 500,
				trafficLimitBytes: 1_099_511_627_776,
				periodEnd: "2026-09-01",
				networkRoute: "",
				extra: "",
			},
		});
		expect(server.public_note).not.toContain("Example Cloud");
		expect(server.public_note).not.toContain("CN2 GIA");
	});

	it("removes a duplicated leading flag from the displayed server name", () => {
		const result = toNezhaWebsocketResponse(
			{
				enabled: true,
				servers: [{ name: "🇯🇵 Tokyo-2", region: "🇯🇵", online: true }],
			},
			1_800_000_000_000,
		);
		expect(result.servers[0]).toMatchObject({
			name: "Tokyo-2",
			country_code: "JP",
		});
	});

	it("clamps month-end billing starts to the last day of the target month", () => {
		const result = toNezhaWebsocketResponse({
			enabled: true,
			servers: [
				{
					name: "month-end",
					online: true,
					expires_at: "2027-03-31",
					renewal_cycle: "month",
				},
			],
		});

		expect(JSON.parse(result.servers[0].public_note)).toMatchObject({
			billingDataMod: { startDate: "2027-02-28" },
		});
	});

	it("does not duplicate undirected billing traffic into both transfer totals", () => {
		const result = toNezhaWebsocketResponse({
			enabled: true,
			servers: [{ name: "billing-only", online: true, traffic_used: 500 }],
		});

		expect(result.servers[0].state).toMatchObject({
			net_out_transfer: 0,
			net_in_transfer: 0,
		});
	});

	it("builds region groups, ping services and traffic-cycle cards", () => {
		const groups = toServerGroupResponse(payload, 1_800_000_000_000);
		expect(groups.data[0]).toMatchObject({
			group: { name: "东京" },
			servers: [1],
		});

		const services = toServiceResponse(payload);
		expect(services.data.services["1-ct"].delay).toEqual([40, 42]);
		expect(services.data.cycle_transfer_stats["mmwx-1"]).toMatchObject({
			max: 1_099_511_627_776,
			transfer: { "1": 500 },
		});
	});

	it("maps ping buckets and system history to Nezha chart responses", () => {
		const monitor = toMonitorResponse(
			{
				success: true,
				all_series: payload.servers?.[0].ping,
			},
			1,
			"Tokyo-1",
			"1d",
			1_800_000_000_000,
		);
		expect(monitor.data[0].avg_delay).toEqual([40, 42]);
		expect(monitor.data[0].packet_loss).toEqual([0, 1]);
		expect(monitor.data[0].created_at[1]).toBe(1_800_000_000_000);

		const metrics = toServerMetricsResponse(
			{
				success: true,
				series: {
					cpu_pct: [
						{ t: 1_700_000_001, value: 22 },
						{ t: 1_700_000_000, value: 11 },
					],
				},
			},
			1,
			"Tokyo-1",
			"cpu",
		);
		expect(metrics.data.data_points).toEqual([
			{ ts: 1_700_000_000_000, value: 11 },
			{ ts: 1_700_000_001_000, value: 22 },
		]);
	});
});
