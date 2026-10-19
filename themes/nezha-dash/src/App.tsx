import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Route, HashRouter as Router, Routes } from "react-router-dom";
import { DashCommand } from "./components/DashCommand";
import ErrorBoundary from "./components/ErrorBoundary";
import Header, { RefreshToast } from "./components/Header";
import { useBackground } from "./hooks/use-background";
import { useTheme } from "./hooks/use-theme";
import { fetchSetting } from "./lib/nezha-api";
import { cn } from "./lib/utils";
import ErrorPage from "./pages/ErrorPage";
import Server from "./pages/Server";

const NotFound = lazy(() => import("./pages/NotFound"));
const loadServerDetail = () => import("./pages/ServerDetail");
const ServerDetail = lazy(loadServerDetail);

// Route checker component
const RouteChecker: React.FC = () => {
	return <MainApp />;
};

const toError = (error: unknown) => {
	if (!error) return null;
	return error instanceof Error ? error : new Error(String(error));
};

const MainApp: React.FC = () => {
	const { data: settingData, error } = useQuery({
		queryKey: ["setting"],
		queryFn: () => fetchSetting(),
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		retry: false,
	});
	const { i18n } = useTranslation();
	const { setTheme } = useTheme();
	const { backgroundImage: customBackgroundImage } = useBackground();

	useEffect(() => {
		loadServerDetail();
	}, []);

	// 检测是否强制指定了主题颜色
	const forceTheme =
		// @ts-expect-error ForceTheme is a global variable
		(window.ForceTheme as string) !== "" ? window.ForceTheme : undefined;

	useEffect(() => {
		if (forceTheme === "dark" || forceTheme === "light") {
			setTheme(forceTheme);
		}
	}, [forceTheme, setTheme]);

	const initialBackendError = !settingData ? toError(error) : null;

	if (
		settingData?.data?.config?.language &&
		!localStorage.getItem("language")
	) {
		i18n.changeLanguage(settingData?.data?.config?.language);
	}

	const customMobileBackgroundImage =
		window.CustomMobileBackgroundImage !== ""
			? window.CustomMobileBackgroundImage
			: undefined;

	return (
		<ErrorBoundary>
			{/* 固定定位的背景层 */}
			{customBackgroundImage && (
				<div
					className={cn(
						"fixed inset-0 z-0 bg-cover min-h-lvh bg-no-repeat bg-center dark:brightness-75",
						{
							"hidden sm:block": customMobileBackgroundImage,
						},
					)}
					style={{ backgroundImage: `url(${customBackgroundImage})` }}
				/>
			)}
			{customMobileBackgroundImage && (
				<div
					className={cn(
						"fixed inset-0 z-0 bg-cover min-h-lvh bg-no-repeat bg-center sm:hidden dark:brightness-75",
					)}
					style={{ backgroundImage: `url(${customMobileBackgroundImage})` }}
				/>
			)}
			<div
				className={cn("flex min-h-screen w-full flex-col", {
					"bg-background": !customBackgroundImage,
				})}
			>
				<main className="flex z-20 min-h-[calc(100vh-calc(var(--spacing)*16))] flex-1 flex-col gap-4 p-4 md:p-10 md:pt-8">
					<RefreshToast />
					<Header />
					<DashCommand />
					<Routes>
						<Route
							path="/"
							element={<Server backendError={initialBackendError} />}
						/>
						<Route
							path="/server/:id"
							element={
								<Suspense fallback={null}>
									<ServerDetail />
								</Suspense>
							}
						/>
						<Route path="/error" element={<ErrorPage />} />
						<Route
							path="*"
							element={
								<Suspense fallback={null}>
									<NotFound />
								</Suspense>
							}
						/>
					</Routes>
				</main>
			</div>
		</ErrorBoundary>
	);
};

// Main App wrapper with router
const App: React.FC = () => {
	return (
		<Router>
			<RouteChecker />
		</Router>
	);
};

export default App;
