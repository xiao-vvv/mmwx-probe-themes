import { afterEach, describe, expect, it } from "vitest";
import { applyMmwxSkin, isBeautySkin, resolveMmwxSkin } from "@/lib/mmwx-skin";

describe("MMWX skin selection", () => {
	afterEach(() => {
		document.documentElement.classList.remove("mmwx-farm", "mmwx-beauty");
	});

	it("keeps the farm skin as the no-query default", () => {
		expect(resolveMmwxSkin("")).toBe("farm");
		expect(resolveMmwxSkin("?skin=farm")).toBe("farm");
		expect(resolveMmwxSkin("?skin=unknown")).toBe("farm");
	});

	it("selects and applies the isolated beauty skin", () => {
		expect(resolveMmwxSkin("?skin=beauty")).toBe("beauty");
		document.documentElement.classList.add("mmwx-farm");

		applyMmwxSkin("beauty");

		expect(document.documentElement).toHaveClass("mmwx-beauty");
		expect(document.documentElement).not.toHaveClass("mmwx-farm");
		expect(isBeautySkin()).toBe(true);
	});
});
