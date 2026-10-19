import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "./App";
import { ThemeColorManager } from "./components/ThemeColorManager";
import { ThemeProvider } from "./components/ThemeProvider";
import { CommandProvider } from "./context/command-provider";
import { SortProvider } from "./context/sort-provider";
import { StatusProvider } from "./context/status-provider";
import { TooltipProvider } from "./context/tooltip-provider";
import { WebSocketProvider } from "./context/websocket-provider";
import "flag-icons/css/flag-icons.min.css";
import "font-logos/assets/font-logos.css";
import "./i18n";
import "./index.css";
import "./farm-theme.css";
import "./beauty-theme.css";
import { applyMmwxSkin } from "./lib/mmwx-skin";

applyMmwxSkin();

const queryClient = new QueryClient();
const ReactQueryDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-query-devtools").then((module) => ({
				default: module.ReactQueryDevtools,
			})),
		)
	: null;

function ParentReadySignal() {
	useEffect(() => {
		if (window.parent === window) return;
		const announceReady = () => {
			window.parent.postMessage(
				{ type: "mmwx-nezha-dash-ready" },
				window.location.origin,
			);
		};
		const handleMessage = (event: MessageEvent<unknown>) => {
			if (
				event.source !== window.parent ||
				event.origin !== window.location.origin
			)
				return;
			if (
				event.data &&
				typeof event.data === "object" &&
				(event.data as { type?: unknown }).type === "mmwx-nezha-dash-ping"
			) {
				announceReady();
			}
		};
		window.addEventListener("message", handleMessage);
		announceReady();
		return () => window.removeEventListener("message", handleMessage);
	}, []);
	return null;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
	<ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
		<ParentReadySignal />
		<ThemeColorManager />
		<QueryClientProvider client={queryClient}>
			<WebSocketProvider url="/api/stream">
				<CommandProvider>
					<StatusProvider>
						<SortProvider>
							<TooltipProvider>
								<App />
								<Toaster
									duration={1000}
									toastOptions={{
										classNames: {
											default:
												"w-fit rounded-full px-2.5 py-1.5 bg-neutral-100 border border-neutral-200 backdrop-blur-xl shadow-none",
										},
									}}
									position="top-center"
									className={"flex items-center justify-center"}
								/>
								{ReactQueryDevtools ? (
									<Suspense fallback={null}>
										<ReactQueryDevtools />
									</Suspense>
								) : null}
							</TooltipProvider>
						</SortProvider>
					</StatusProvider>
				</CommandProvider>
			</WebSocketProvider>
		</QueryClientProvider>
	</ThemeProvider>,
);
