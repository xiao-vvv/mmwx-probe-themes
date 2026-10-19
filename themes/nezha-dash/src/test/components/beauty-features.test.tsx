import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BeautyVisitorCard from "@/components/BeautyVisitorCard";

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

describe("BeautyVisitorCard", () => {
	it("does not request visitor data outside the beauty skin", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		render(<BeautyVisitorCard />);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(screen.queryByLabelText("访客网络信息")).not.toBeInTheDocument();
	});

	it("shows same-origin visitor data and remembers dismissal", async () => {
		document.documentElement.classList.add("mmwx-beauty");
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				ip: "203.0.113.8",
				city: "Tokyo",
				region: "Tokyo",
				country: "JP",
				isp: "Example Network",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		render(<BeautyVisitorCard />);

		await waitFor(() =>
			expect(screen.getByLabelText("访客网络信息")).toBeInTheDocument(),
		);
		expect(screen.getByText("IP 203.0.113.8")).toBeInTheDocument();
		expect(screen.getByText("Tokyo · JP")).toBeInTheDocument();
		expect(screen.getByText("Example Network")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/visitor",
			expect.objectContaining({ cache: "no-store" }),
		);

		fireEvent.click(screen.getByRole("button", { name: "关闭访客信息" }));
		expect(screen.queryByLabelText("访客网络信息")).not.toBeInTheDocument();
		expect(sessionStorage.getItem("mmwx-beauty-visitor-dismissed")).toBe("1");
	});
});
