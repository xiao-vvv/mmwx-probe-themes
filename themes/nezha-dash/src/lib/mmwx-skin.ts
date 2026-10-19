export type MmwxSkin = "farm" | "beauty";

const SKIN_CLASSES = ["mmwx-farm", "mmwx-beauty"] as const;

export function resolveMmwxSkin(search: string): MmwxSkin {
	return new URLSearchParams(search).get("skin") === "beauty"
		? "beauty"
		: "farm";
}

export function getMmwxSkin(): MmwxSkin {
	return resolveMmwxSkin(window.location.search);
}

export function applyMmwxSkin(skin = getMmwxSkin()): MmwxSkin {
	document.documentElement.classList.remove(...SKIN_CLASSES);
	document.documentElement.classList.add(`mmwx-${skin}`);
	return skin;
}

export function isBeautySkin(): boolean {
	return document.documentElement.classList.contains("mmwx-beauty");
}
