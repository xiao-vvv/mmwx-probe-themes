import { CheckCircleIcon } from "@heroicons/react/20/solid";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getMmwxSkin } from "@/lib/mmwx-skin";
import { cn } from "@/lib/utils";

/* 内嵌于父站(NezhaDashFrame)时的整站主题切换器: 与 ModeToggle 同款按钮/菜单,
   挂在 header-handles 按钮排里自动继承皮肤样式; 选择后 postMessage 交父层切换。
   独立打开(非 iframe)时不渲染。 */

const SITE_THEME_OPTIONS: { value: string | null; label: string }[] = [
	{ value: null, label: "跟随主控" },
	{ value: "premium", label: "Premium" },
	{ value: "ran", label: "岚 · Ran" },
	{ value: "nezha-dash", label: "Nezha Dash" },
	{ value: "nezha-beauty", label: "Nezha 美化" },
];

export default function SiteThemeSwitch() {
	if (window.parent === window) return null;

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;
	const current = getMmwxSkin() === "beauty" ? "nezha-beauty" : "nezha-dash";

	const handleSelect = (e: Event, value: string | null) => {
		e.preventDefault();
		window.parent.postMessage(
			{ type: "mmwx-theme-change", theme: value },
			window.location.origin,
		);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					aria-label="切换主题"
					title="切换主题"
					className={cn("rounded-full px-[9px] bg-white dark:bg-black", {
						"bg-white/70 dark:bg-black/70": customBackgroundImage,
					})}
				>
					<Palette className="h-4 w-4" />
					<span className="sr-only">切换主题</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="flex flex-col gap-0.5" align="end">
				{SITE_THEME_OPTIONS.map((option) => (
					<DropdownMenuItem
						key={String(option.value)}
						className={cn("rounded-[5px] text-xs", {
							"gap-3 bg-muted font-semibold": option.value === current,
						})}
						onSelect={(e) => handleSelect(e, option.value)}
					>
						{option.label}
						{option.value === current && <CheckCircleIcon className="size-4" />}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
