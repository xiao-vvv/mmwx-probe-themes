import { fireEvent, screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServerCard from "@/components/ServerCard";
import ServerCardInline from "@/components/ServerCardInline";
import { createServer } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";

const publicNote = JSON.stringify({
	billingDataMod: {
		startDate: "2025-01-01T00:00:00.000Z",
		endDate: "2025-01-31T00:00:00.000Z",
		autoRenewal: "0",
		cycle: "monthly",
		amount: "10",
	},
	planDataMod: {
		bandwidth: "1Gbps",
		trafficVol: "2TB",
		trafficType: "monthly",
		IPv4: "1",
		IPv6: "1",
		networkRoute: "CN2,CMI",
		extra: "Premium",
	},
});

function LocationProbe() {
	const location = useLocation();
	return <p>{location.pathname}</p>;
}

describe("ServerCard", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-15T00:00:00.000Z"));
		Object.assign(window, {
			ForceUseSvgFlag: true,
			FixedTopServerName: true,
			ShowNetTransfer: true,
		});
	});

	it("renders online server metrics, billing, plan data, and navigates on click", async () => {
		const server = createServer({
			id: 7,
			name: "edge-online",
			public_note: publicNote,
			host: { platform: "Windows Server" },
		});

		renderWithProviders(
			<>
				<ServerCard
					now={Date.parse("2025-01-01T00:00:20.000Z")}
					serverInfo={server}
				/>
				<LocationProbe />
			</>,
		);

		expect(screen.getByText("edge-online")).toBeInTheDocument();
		expect(screen.getByText("Windows")).toBeInTheDocument();
		expect(screen.getByText("12.00%")).toBeInTheDocument();
		expect(screen.getAllByText("25.00%")).toHaveLength(2);
		expect(screen.getByText("serverCard.upload:2.00 GiB")).toBeInTheDocument();
		expect(
			screen.getByText("serverCard.download:1.00 GiB"),
		).toBeInTheDocument();
		expect(screen.getByText("1Gbps")).toBeInTheDocument();
		expect(
			screen.getAllByText(/billingInfo.remaining: 16/).length,
		).toBeGreaterThan(0);

		Object.defineProperty(window, "scrollY", {
			configurable: true,
			value: 432,
		});
		fireEvent.click(screen.getByText("edge-online"));

		expect(sessionStorage.getItem("fromMainPage")).toBe("true");
		expect(sessionStorage.getItem("scrollPosition")).toBe("432");
		expect(screen.getByText("/server/7")).toBeInTheDocument();
	});

	it("renders a compact offline card without live metric blocks", () => {
		const server = createServer({
			id: 8,
			name: "edge-offline",
			public_note: publicNote,
			last_active: "2024-12-31T23:00:00.000Z",
		});

		renderWithProviders(
			<ServerCard
				now={Date.parse("2025-01-01T00:00:20.000Z")}
				serverInfo={server}
			/>,
		);

		expect(screen.getByText("edge-offline")).toBeInTheDocument();
		expect(screen.getByText("1Gbps")).toBeInTheDocument();
		expect(screen.queryByText("CPU")).not.toBeInTheDocument();
	});

	it("marks unavailable memory and disk metrics instead of reporting zero", () => {
		const server = createServer({
			name: "edge-partial",
			host: { mem_total: 0, disk_total: 0 },
			state: { mem_used: 0, disk_used: 0 },
		});

		renderWithProviders(
			<ServerCard
				now={Date.parse("2025-01-01T00:00:20.000Z")}
				serverInfo={server}
			/>,
		);

		expect(screen.getAllByText("—")).toHaveLength(2);
		expect(screen.queryByText("0.00%")).not.toBeInTheDocument();
	});

	it("no longer renders the beauty traffic quota bar", () => {
		// 2026-08-18 按需求下线流量条: 流量只以 PlanInfo 标签呈现, 不再画用量进度条
		document.documentElement.classList.add("mmwx-beauty");
		const server = createServer({
			name: "quota-node",
			public_note: JSON.stringify({
				planDataMod: {
					trafficUsedBytes: 1024 ** 3,
					trafficLimitBytes: 2 * 1024 ** 3,
					periodEnd: "2026-09-01T00:00:00.000Z",
				},
			}),
		});

		renderWithProviders(
			<ServerCard
				now={Date.parse("2025-01-01T00:00:20.000Z")}
				serverInfo={server}
			/>,
		);

		expect(screen.queryByText("流量 1.00 GiB / 2.00 GiB")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("progressbar", { name: "流量使用率" }),
		).not.toBeInTheDocument();
	});
});

describe("ServerCardInline", () => {
	beforeEach(() => {
		Object.assign(window, { ForceUseSvgFlag: true });
	});

	it("renders online inline server detail columns", () => {
		const server = createServer({
			id: 9,
			name: "edge-inline",
			public_note: publicNote,
			state: { uptime: 2 * 86_400 },
		});

		renderWithProviders(
			<ServerCardInline
				now={Date.parse("2025-01-01T00:00:20.000Z")}
				serverInfo={server}
			/>,
		);

		expect(screen.getByText("edge-inline")).toBeInTheDocument();
		expect(screen.getByText("serverCard.system")).toBeInTheDocument();
		expect(screen.getByText("2 serverCard.days")).toBeInTheDocument();
		expect(screen.getByText("2.00 GiB")).toBeInTheDocument();
		expect(screen.getByText("1.00 GiB")).toBeInTheDocument();
	});

	it("renders offline inline server cards with saved plan data", () => {
		const server = createServer({
			id: 10,
			name: "edge-inline-offline",
			public_note: publicNote,
			last_active: "2024-12-31T23:00:00.000Z",
		});

		renderWithProviders(
			<ServerCardInline
				now={Date.parse("2025-01-01T00:00:20.000Z")}
				serverInfo={server}
			/>,
		);

		expect(screen.getByText("edge-inline-offline")).toBeInTheDocument();
		expect(screen.getByText("1Gbps")).toBeInTheDocument();
		expect(screen.queryByText("serverCard.system")).not.toBeInTheDocument();
	});
});
