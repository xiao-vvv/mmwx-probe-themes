import { type ReactNode, useEffect, useState } from "react";

import {
	SORT_ORDERS,
	SORT_TYPES,
	SortContext,
	type SortOrder,
	type SortType,
} from "./sort-context";

const getForcedSortType = (): SortType | undefined => {
	const forcedSortType = window.ForceSortType;
	if (forcedSortType && SORT_TYPES.includes(forcedSortType as SortType)) {
		return forcedSortType as SortType;
	}
	return undefined;
};

const getForcedSortOrder = (): SortOrder | undefined => {
	const forcedSortOrder = window.ForceSortOrder;
	if (forcedSortOrder && SORT_ORDERS.includes(forcedSortOrder as SortOrder)) {
		return forcedSortOrder as SortOrder;
	}
	return undefined;
};

export function SortProvider({ children }: { children: ReactNode }) {
	const [sortType, setSortType] = useState<SortType>(
		() => getForcedSortType() || "default",
	);
	const [sortOrder, setSortOrder] = useState<SortOrder>(
		() => getForcedSortOrder() || "desc",
	);

	useEffect(() => {
		const applyForcedSort = () => {
			const forcedSortType = getForcedSortType();
			const forcedSortOrder = getForcedSortOrder();
			if (forcedSortType) {
				setSortType(forcedSortType);
			}
			if (forcedSortOrder) {
				setSortOrder(forcedSortOrder);
			}
		};

		applyForcedSort();

		let retryCount = 0;
		const intervalId = window.setInterval(() => {
			retryCount += 1;
			if (window.ForceSortType || window.ForceSortOrder || retryCount >= 50) {
				applyForcedSort();
				window.clearInterval(intervalId);
			}
		}, 100);

		return () => {
			window.clearInterval(intervalId);
		};
	}, []);

	return (
		<SortContext.Provider
			value={{ sortType, setSortType, sortOrder, setSortOrder }}
		>
			{children}
		</SortContext.Provider>
	);
}
