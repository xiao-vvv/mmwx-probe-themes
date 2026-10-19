import { Globe2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isBeautySkin } from "@/lib/mmwx-skin";

const DISMISSED_KEY = "mmwx-beauty-visitor-dismissed";

interface VisitorInfo {
	ip: string;
	city?: string;
	region?: string;
	country?: string;
	isp?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseVisitorInfo(value: unknown): VisitorInfo | null {
	if (!isRecord(value)) return null;
	const ip = optionalString(value.ip);
	if (!ip || ip === "UNKNOWN") return null;
	return {
		ip,
		city: optionalString(value.city),
		region: optionalString(value.region),
		country: optionalString(value.country),
		isp: optionalString(value.isp),
	};
}

function visitorLocation(data: VisitorInfo): string {
	return [
		...new Set([data.city, data.region, data.country].filter(Boolean)),
	].join(" · ");
}

export default function BeautyVisitorCard() {
	const enabled = isBeautySkin();
	const [closed, setClosed] = useState(
		() => sessionStorage.getItem(DISMISSED_KEY) === "1",
	);
	const [data, setData] = useState<VisitorInfo | null>(null);

	useEffect(() => {
		if (!enabled || closed) return;
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 5000);

		void fetch("/api/visitor", {
			cache: "no-store",
			headers: { Accept: "application/json" },
			signal: controller.signal,
		})
			.then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.json() as Promise<unknown>;
			})
			.then((value) => {
				if (!controller.signal.aborted) setData(parseVisitorInfo(value));
			})
			.catch(() => undefined)
			.finally(() => window.clearTimeout(timeout));

		return () => {
			window.clearTimeout(timeout);
			controller.abort();
		};
	}, [closed, enabled]);

	if (!enabled || closed || !data) return null;
	const location = visitorLocation(data);

	return (
		<aside className="mmwx-beauty-visitor" aria-label="访客网络信息">
			<Globe2 aria-hidden="true" size={15} />
			<div className="mmwx-beauty-visitor-copy">
				<span className="mmwx-beauty-visitor-ip">IP {data.ip}</span>
				{location ? (
					<span className="mmwx-beauty-visitor-location">{location}</span>
				) : null}
				{data.isp ? (
					<span className="mmwx-beauty-visitor-isp">{data.isp}</span>
				) : null}
			</div>
			<button
				type="button"
				aria-label="关闭访客信息"
				title="关闭"
				onClick={() => {
					sessionStorage.setItem(DISMISSED_KEY, "1");
					setClosed(true);
				}}
			>
				<X aria-hidden="true" size={13} />
			</button>
		</aside>
	);
}
