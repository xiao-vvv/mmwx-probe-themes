import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header, { RefreshToast } from "@/components/Header";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandProvider } from "@/context/command-provider";
import { createSettingResponse } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/utils";

const headerMocks = vi.hoisted(() => ({
	backgroundImage: undefined as string | undefined,
	connected: true,
	fetchLoginUser: vi.fn(),
	fetchSetting: vi.fn(),
	lastData: null as { now: number; online?: number; servers: [] } | null,
	needReconnect: false,
	setNeedReconnect: vi.fn(),
	updateBackground: vi.fn(),
}));

vi.mock("@/hooks/use-background", () => ({
	useBackground: () => ({
		backgroundImage: headerMocks.backgroundImage,
		updateBackground: headerMocks.updateBackground,
	}),
}));

vi.mock("@/hooks/use-websocket-context", () => ({
	useWebSocketContext: () => ({
		connected: headerMocks.connected,
		lastData: headerMocks.lastData,
		needReconnect: headerMocks.needReconnect,
		setNeedReconnect: headerMocks.setNeedReconnect,
	}),
}));

vi.mock("@/lib/nezha-api", () => ({
	fetchLoginUser: headerMocks.fetchLoginUser,
	fetchSetting: headerMocks.fetchSetting,
}));

function settingResponse(siteName = "Nezha") {
	return {
		...createSettingResponse(),
		data: {
			...createSettingResponse().data,
			config: {
				...createSettingResponse().data.config,
				site_name: siteName,
			},
		},
	};
}

function loginResponse() {
	return {
		success: true,
		data: {
			id: 1,
			username: "admin",
			password: "",
			created_at: "2025-01-01T00:00:00.000Z",
			updated_at: "2025-01-01T00:00:00.000Z",
		},
	};
}

function LocationProbe() {
	const location = useLocation();
	return <p>{location.pathname}</p>;
}

function renderHeader(route = "/server/1") {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<MemoryRouter initialEntries={[route]}>
				<ThemeProvider storageKey="header-theme-test">
					<CommandProvider>
						<Header />
						<LocationProbe />
					</CommandProvider>
				</ThemeProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

function renderInRouter(ui: ReactElement) {
	return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("Header", () => {
	beforeEach(() => {
		headerMocks.backgroundImage = undefined;
		headerMocks.connected = true;
		headerMocks.fetchLoginUser.mockReset();
		headerMocks.fetchSetting.mockReset();
		headerMocks.lastData = {
			now: Date.parse("2025-01-01T00:00:20.000Z"),
			online: 4,
			servers: [],
		};
		headerMocks.needReconnect = false;
		headerMocks.setNeedReconnect.mockReset();
		headerMocks.updateBackground.mockReset();
		Object.assign(window, {
			CustomBackgroundImage: "",
			CustomDesc: "",
			CustomLinks: "",
			CustomLogo: "",
			CustomMobileBackgroundImage: "",
		});
		headerMocks.fetchSetting.mockResolvedValue(settingResponse());
		headerMocks.fetchLoginUser.mockRejectedValue(new Error("anonymous"));
	});

	it("renders configured site identity, custom links, and online count without an admin link", async () => {
		const user = userEvent.setup();
		Object.assign(window, {
			CustomDesc: "edge status",
			CustomLinks: JSON.stringify([
				{ link: "https://example.test", name: "Docs" },
			]),
			CustomLogo: "/logo.png",
		});
		Object.defineProperty(document, "cookie", {
			configurable: true,
			value: "session=1",
		});
		sessionStorage.setItem("selectedGroup", "Edge");
		headerMocks.fetchSetting.mockResolvedValue(settingResponse("Status Hub"));
		headerMocks.fetchLoginUser.mockResolvedValue(loginResponse());

		renderHeader();

		const siteName = await screen.findByText("Status Hub");
		expect(screen.getByText("edge status")).toBeInTheDocument();
		expect(screen.getByAltText("apple-touch-icon")).toHaveAttribute(
			"src",
			"/logo.png",
		);
		expect(screen.getAllByRole("link", { name: "Docs" })).toHaveLength(2);
		expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
		expect(headerMocks.fetchLoginUser).not.toHaveBeenCalled();
		expect(screen.getByText("online").closest("button")).toHaveTextContent("4");
		expect(screen.getByText("online")).toBeInTheDocument();

		await waitFor(() => {
			expect(document.title).toBe("Status Hub");
		});
		expect(document.querySelector("link[rel='shortcut icon']")).toHaveAttribute(
			"href",
			"/logo.png",
		);

		await user.click(siteName);

		expect(sessionStorage.getItem("selectedGroup")).toBeNull();
		expect(screen.getByText("/")).toBeInTheDocument();
	});

	it("uses the offline display without exposing a login link", async () => {
		headerMocks.connected = false;

		const { container } = renderHeader();

		expect(screen.queryByText("login")).not.toBeInTheDocument();
		expect(screen.getByText("offline")).toBeInTheDocument();
		expect(
			container.querySelector("[data-visible='true']"),
		).toBeInTheDocument();
	});

	it("ignores invalid custom links instead of crashing", async () => {
		Object.assign(window, {
			CustomLinks: "{bad-json",
		});

		renderHeader();

		expect(await screen.findByText("Nezha")).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Docs" }),
		).not.toBeInTheDocument();
	});

	it("no longer renders the background toggle button", async () => {
		// 2026-08-18 按需求移除壁纸开关(点击会把背景切成白色, 易误触)
		headerMocks.backgroundImage = "/desktop.png";
		Object.assign(window, {
			CustomBackgroundImage: "/desktop.png",
			CustomMobileBackgroundImage: "/mobile.png",
		});

		const { container } = renderHeader();
		await screen.findByText("Nezha");

		expect(
			container.querySelector(".lucide-image-minus"),
		).not.toBeInTheDocument();
	});
});

describe("RefreshToast", () => {
	beforeEach(() => {
		headerMocks.needReconnect = false;
	});

	it("renders only while reconnect refresh is needed", () => {
		vi.useFakeTimers();
		sessionStorage.setItem("needRefresh", "true");

		const { container, rerender } = renderInRouter(<RefreshToast />);

		expect(container).toBeEmptyDOMElement();

		headerMocks.needReconnect = true;
		rerender(
			<MemoryRouter>
				<RefreshToast />
			</MemoryRouter>,
		);

		expect(screen.getByText("refreshing...")).toBeInTheDocument();
		expect(sessionStorage.getItem("needRefresh")).toBeNull();
	});
});
