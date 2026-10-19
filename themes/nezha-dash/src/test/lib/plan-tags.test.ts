import { describe, expect, it, vi } from "vitest";

vi.mock("@/plan-tags.config", () => ({
	PLAN_TAG_RULES: [
		{ nameIncludes: [], bandwidth: "1Gbps" },
		{ nameIncludes: ["HK-"], networkRoute: "CN2GIA,9929" },
		{ providerIncludes: ["examplehost"], bandwidth: "2.5Gbps" },
		{ nameIncludes: ["home"], country: ["us"], networkRoute: "家宽" },
		{ nameRegex: /node[1-4]$/g, ipv6: false },
	],
}));

const { toNezhaServer } = await import("@/lib/mmwx-adapter");

function plan(server: Record<string, unknown>) {
	const note = JSON.parse(
		toNezhaServer({ name: "x", online: true, ...server } as never, 0)
			.public_note,
	);
	return note.planDataMod;
}

describe("plan tag rules", () => {
	it("matches name, provider and country case-insensitively, later rules win", () => {
		expect(plan({ name: "hk-01" }).networkRoute).toBe("CN2GIA,9929");
		expect(
			plan({ name: "hk-01", provider_name: "ExampleHost" }).bandwidth,
		).toBe("2.5Gbps");
		expect(plan({ name: "hk-home", region_country: "US" }).networkRoute).toBe(
			"家宽",
		);
		expect(plan({ name: "hk-home", region_country: "JP" }).networkRoute).toBe(
			"CN2GIA,9929",
		);
	});

	it("treats empty condition arrays as no restriction", () => {
		expect(plan({ name: "anything" }).bandwidth).toBe("1Gbps");
	});

	it("applies global regex rules on every call", () => {
		for (let i = 0; i < 3; i++) {
			expect(plan({ name: "node2" }).IPv6).toBe("");
		}
		expect(plan({ name: "node5" }).IPv6).toBe("1");
	});
});
