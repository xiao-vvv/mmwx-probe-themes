/* 每台机器的线路/带宽/IPv6 标签规则(哪吒两套皮肤的卡片标签)。
 *
 * 规则按顺序匹配,后面命中的会覆盖前面的同名字段。
 * 匹配条件(全部可选,同一条规则内为「且」关系,不区分大小写):
 *   nameIncludes      机器名包含其中任意一个关键字
 *   providerIncludes  商家名(provider_name)包含其中任意一个关键字
 *   nameRegex         机器名匹配该正则
 *   country           地区国家代码(region_country)等于其中之一,如 "US"、"HK"
 * 输出字段:
 *   networkRoute  线路标签,多个线路用英文逗号分隔,卡片上会合并成一个标签
 *   bandwidth     带宽标签,如 "1Gbps"
 *   ipv6          false = 不显示 IPv6 标签(默认所有机器都显示 IPv4/IPv6)
 */
export interface PlanTagRule {
	nameIncludes?: string[];
	providerIncludes?: string[];
	nameRegex?: RegExp;
	country?: string[];
	networkRoute?: string;
	bandwidth?: string;
	ipv6?: boolean;
}

export const PLAN_TAG_RULES: PlanTagRule[] = [
	// 示例:
	// { nameIncludes: ["hk-"], networkRoute: "CN2GIA,9929,CMIN2" },
	// { providerIncludes: ["examplehost"], bandwidth: "2.5Gbps" },
	// { nameIncludes: ["home"], country: ["US"], networkRoute: "家宽", ipv6: false },
	// { nameRegex: /node[1-4]$/, ipv6: false },
];
