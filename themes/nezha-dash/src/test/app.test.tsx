import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { createTestQueryClient } from "@/test/utils";

const appMocks = vi.hoisted(() => ({
	backgroundImage: undefined as string | undefined,
	fetchSetting: vi.fn(),
	setTheme: vi.fn(),
}));

vi.mock("../components/DashCommand", () => ({
	DashCommand: () => <div>dash-command</div>,
}));

vi.mock("../components/Footer", () => ({
	default: () => <footer>footer</footer>,
}));

vi.mock("../components/Header", () => ({
	default: () => <header>header</header>,
	RefreshToast: () => <div>refresh-toast</div>,
}));

vi.mock("../pages/Server", () => ({
	default: ({ backendError }: { backendError?: Error | null }) => (
		<div>
			<div>server-page</div>
			{backendError && <p>{backendError.message}</p>}
		</div>
	),
}));

vi.mock("../pages/ServerDetail", () => ({
	default: () => <div>server-detail-page</div>,
}));

vi.mock("../hooks/use-background", () => ({
	useBackground: () => ({ backgroundImage: appMocks.backgroundImage }),
}));

vi.mock("../hooks/use-theme", () => ({
	useTheme: () => ({ setTheme: appMocks.setTheme }),
}));

vi.mock("../lib/nezha-api", () => ({
	fetchSetting: appMocks.fetchSetting,
}));

function settingResponse() {
	return {
		success: true,
		data: {
			config: {
				debug: false,
				language: "zh-CN",
				site_name: "Nezha",
				user_template: "",
				admin_template: "",
				custom_code: "",
			},
			version: "1.0.0",
		},
	};
}

function renderApp(route = "/") {
	window.history.pushState({}, "", "/");
	window.location.hash = route === "/" ? "" : `#${route}`;
	const queryClient = createTestQueryClient();

	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>,
		),
	};
}

describe("App", () => {
	beforeEach(() => {
		appMocks.backgroundImage = undefined;
		appMocks.fetchSetting.mockResolvedValue(settingResponse());
	});

	it("renders the main shell after settings load and applies global theme/background settings", async () => {
		Object.assign(window, {
			ForceTheme: "dark",
			CustomMobileBackgroundImage: "/mobile.png",
		});
		appMocks.backgroundImage = "/desktop.png";

		const { container } = renderApp();

		expect(await screen.findByText("server-page")).toBeInTheDocument();
		expect(screen.getByText("refresh-toast")).toBeInTheDocument();
		expect(screen.getByText("header")).toBeInTheDocument();
		expect(screen.getByText("dash-command")).toBeInTheDocument();
		// 2026-08-18 底栏(版权/主题署名)已下线, 不再挂载
		expect(screen.queryByText("footer")).not.toBeInTheDocument();
		expect(appMocks.setTheme).toHaveBeenCalledWith("dark");
		expect(
			Array.from(container.querySelectorAll<HTMLElement>("[style]")).some(
				(element) => element.style.backgroundImage.includes("/desktop.png"),
			),
		).toBe(true);
		expect(
			Array.from(container.querySelectorAll<HTMLElement>("[style]")).some(
				(element) => element.style.backgroundImage.includes("/mobile.png"),
			),
		).toBe(true);
	});

	it("renders the app shell while initial settings are still pending", async () => {
		appMocks.fetchSetting.mockImplementation(
			() => new Promise(() => undefined),
		);

		renderApp();

		expect(await screen.findByText("server-page")).toBeInTheDocument();
		expect(screen.getByText("refresh-toast")).toBeInTheDocument();
		expect(screen.getByText("header")).toBeInTheDocument();
		expect(screen.getByText("dash-command")).toBeInTheDocument();
		// 2026-08-18 底栏(版权/主题署名)已下线, 不再挂载
		expect(screen.queryByText("footer")).not.toBeInTheDocument();
	});

	it("renders the app shell when initial settings fetch fails", async () => {
		appMocks.fetchSetting.mockRejectedValue(new Error("settings failed"));

		renderApp();

		expect(await screen.findByText("server-page")).toBeInTheDocument();
		expect(screen.getByText("refresh-toast")).toBeInTheDocument();
		expect(screen.getByText("header")).toBeInTheDocument();
		expect(screen.getByText("dash-command")).toBeInTheDocument();
		// 2026-08-18 底栏(版权/主题署名)已下线, 不再挂载
		expect(screen.queryByText("footer")).not.toBeInTheDocument();
		expect(await screen.findByText("settings failed")).toBeInTheDocument();
	});

	it("keeps rendering with stale settings when a later settings refetch fails", async () => {
		let requestCount = 0;
		appMocks.fetchSetting.mockImplementation(() => {
			requestCount += 1;
			return requestCount === 1
				? Promise.resolve(settingResponse())
				: Promise.reject(new Error("settings failed"));
		});

		const { queryClient } = renderApp();

		expect(await screen.findByText("server-page")).toBeInTheDocument();

		await queryClient.refetchQueries({ queryKey: ["setting"] });

		await waitFor(() => {
			expect(appMocks.fetchSetting.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
		expect(screen.getByText("server-page")).toBeInTheDocument();
		expect(screen.queryByText("settings failed")).not.toBeInTheDocument();
	});

	it("routes server detail paths through the app router", async () => {
		renderApp("/server/42");

		expect(await screen.findByText("server-detail-page")).toBeInTheDocument();
	});
});
