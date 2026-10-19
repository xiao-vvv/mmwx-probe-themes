import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
	isMmwxProbePayload,
	type MmwxProbePayload,
	toNezhaWebsocketResponse,
} from "@/lib/mmwx-adapter";
import { fetchProbePayload, rememberProbePayload } from "@/lib/nezha-api";
import {
	WebSocketContext,
	type WebSocketContextType,
} from "./websocket-context";

interface WebSocketProviderProps {
	url: string;
	children: React.ReactNode;
}

const POLL_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 3000;
const STALE_AFTER_MS = 15000;

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
	url,
	children,
}) => {
	const [lastData, setLastData] =
		useState<WebSocketContextType["lastData"]>(null);
	const [messageHistory, setMessageHistory] = useState<
		WebSocketContextType["messageHistory"]
	>([]);
	const [connected, setConnected] = useState(false);
	const [needReconnect, setNeedReconnect] = useState(false);
	const [reconnectGeneration, setReconnectGeneration] = useState(0);

	const accept = useCallback((payload: MmwxProbePayload) => {
		rememberProbePayload(payload);
		const normalized = toNezhaWebsocketResponse(payload);
		setLastData(normalized);
		setMessageHistory((previous) => [normalized, ...previous].slice(0, 30));
		setConnected(true);
		return normalized.now;
	}, []);

	const reconnect = useCallback(() => {
		setReconnectGeneration((generation) => generation + 1);
	}, []);

	useEffect(() => {
		void reconnectGeneration;
		let stopped = false;
		let socket: WebSocket | undefined;
		let reconnectTimer: number | undefined;
		let pollTimer: number | undefined;
		let lastSuccessfulUpdate = 0;
		let lastStreamUpdate = 0;
		let socketOpenedAt = 0;
		let hasStreamFrame = false;

		const stopPolling = () => {
			if (pollTimer === undefined) return;
			window.clearInterval(pollTimer);
			pollTimer = undefined;
		};

		const receive = (payload: MmwxProbePayload, source: "stream" | "poll") => {
			if (stopped) return;
			lastSuccessfulUpdate = accept(payload);
			if (source === "stream") {
				hasStreamFrame = true;
				lastStreamUpdate = Date.now();
				stopPolling();
			}
		};

		const poll = async () => {
			try {
				receive(await fetchProbePayload({ force: true }), "poll");
			} catch (error) {
				console.error("Failed to poll MMWX probe:", error);
				if (Date.now() - lastSuccessfulUpdate > STALE_AFTER_MS) {
					setConnected(false);
				}
			}
		};

		const startPolling = () => {
			if (stopped || pollTimer !== undefined) return;
			void poll();
			pollTimer = window.setInterval(poll, POLL_INTERVAL_MS);
		};

		let connect: () => void = () => {};

		const scheduleReconnect = () => {
			if (stopped || reconnectTimer !== undefined) return;
			reconnectTimer = window.setTimeout(() => {
				reconnectTimer = undefined;
				connect();
			}, RECONNECT_DELAY_MS);
		};

		connect = () => {
			if (stopped) return;
			try {
				hasStreamFrame = false;
				socketOpenedAt = 0;
				const socketUrl = new URL(url, window.location.origin);
				socketUrl.protocol = socketUrl.protocol.replace("http", "ws");
				socket = new WebSocket(socketUrl.toString());
				socket.onopen = () => {
					if (!stopped) {
						socketOpenedAt = Date.now();
						setConnected(true);
					}
				};
				socket.onmessage = (event) => {
					try {
						if (typeof event.data !== "string") return;
						const payload: unknown = JSON.parse(event.data);
						if (!isMmwxProbePayload(payload)) {
							throw new TypeError("MMWX stream returned an invalid payload");
						}
						receive(payload, "stream");
					} catch (error) {
						console.error("Failed to parse MMWX stream message:", error);
					}
				};
				socket.onerror = () => {
					socket?.close();
				};
				socket.onclose = () => {
					socket = undefined;
					startPolling();
					scheduleReconnect();
				};
			} catch (error) {
				console.error("Failed to connect to MMWX stream:", error);
				startPolling();
				scheduleReconnect();
			}
		};

		connect();
		// 首屏垫底: 源站不给新连接发快照, ws 首帧最坏要等一个推送周期(~5s),
		// 期间 UI 卡在"处理中"。启动时外观配置已拉过 /api/probe(1.5s 内直接命中缓存,
		// 零额外请求), 先用它渲染, 流帧一到即被覆盖。失败不管——看门狗 5s 后会接管轮询。
		void (async () => {
			try {
				const payload = await fetchProbePayload();
				if (!stopped && !hasStreamFrame) receive(payload, "poll");
			} catch {
				// 静默降级到 watchdog 轮询
			}
		})();
		const watchdogTimer = window.setInterval(() => {
			const now = Date.now();
			const waitingForFirstFrame =
				!hasStreamFrame &&
				(!socketOpenedAt || now - socketOpenedAt >= POLL_INTERVAL_MS);
			const staleStream =
				hasStreamFrame && now - lastStreamUpdate > STALE_AFTER_MS;
			if (waitingForFirstFrame || staleStream) {
				startPolling();
			}
			if (
				socket &&
				socket.readyState === WebSocket.OPEN &&
				((hasStreamFrame && staleStream) ||
					(!hasStreamFrame &&
						!!socketOpenedAt &&
						now - socketOpenedAt > STALE_AFTER_MS))
			) {
				socket.close();
			}
		}, POLL_INTERVAL_MS);

		return () => {
			stopped = true;
			stopPolling();
			window.clearInterval(watchdogTimer);
			if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
			}
		};
	}, [accept, reconnectGeneration, url]);

	const contextValue: WebSocketContextType = {
		lastData,
		connected,
		messageHistory,
		reconnect,
		needReconnect,
		setNeedReconnect,
	};

	return (
		<WebSocketContext.Provider value={contextValue}>
			{children}
		</WebSocketContext.Provider>
	);
};
