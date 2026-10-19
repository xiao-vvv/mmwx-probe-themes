import { formatBytes } from "@/lib/format";
import { isBeautySkin } from "@/lib/mmwx-skin";
import type { PublicNoteData } from "@/lib/utils";

function percentLabel(percent: number): string {
	return `${percent < 10 ? percent.toFixed(1) : percent.toFixed(0)}%`;
}

function periodLabel(value?: string): string {
	if (!value) return "";
	const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
	return isoDate || value;
}

export default function BeautyTrafficQuota({
	parsedData,
}: {
	parsedData: PublicNoteData | null;
}) {
	if (!isBeautySkin()) return null;

	const plan = parsedData?.planDataMod;
	const used = plan?.trafficUsedBytes;
	const limit = plan?.trafficLimitBytes;
	if (used === undefined || !limit || limit <= 0) return null;

	const percent = Math.max(0, (used / limit) * 100);
	const visualPercent = Math.min(100, percent);
	const end = periodLabel(plan.periodEnd);

	return (
		<section className="mmwx-beauty-quota" aria-label="流量额度">
			<div className="mmwx-beauty-quota-copy">
				<span>
					流量 {formatBytes(used)} / {formatBytes(limit)}
				</span>
				<span className="mmwx-beauty-quota-meta">
					{percentLabel(percent)}
					{end ? ` · 周期至 ${end}` : ""}
				</span>
			</div>
			<div
				className="mmwx-beauty-quota-track"
				role="progressbar"
				aria-label="流量使用率"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.min(100, Math.round(percent))}
			>
				<span style={{ width: `${visualPercent}%` }} />
			</div>
		</section>
	);
}
