import EleventyFetch from "@11ty/eleventy-fetch";

const CACHE = "1h";

async function runGraphQL(query, operationName, variables) {
	const {data} = await EleventyFetch("https://opencollective.com/api/graphql/v2", {
		duration: CACHE,
		type: "json",
		fetchOptions: {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query,
				operationName,
				variables,
			}),
		}
	});
	return data;
}

async function getCollectiveGoalsAndStats() {
	const data = await runGraphQL(`
		query GetCollectiveGoals($collectiveSlug: String!) {
			collective(slug: $collectiveSlug) {
				currency
				settings
				stats {
					balance {
						value
						currency
					}
					yearlyBudget {
						value
						currency
					}
				}
			}
		}`,
		"GetCollectiveGoals",
		{
			"collectiveSlug": "luanti",
		});

	return {
		goals: data.collective.settings.goals,
		balance: data.collective.stats.balance.value,
	};
}

async function getOneTimeTotal() {
	const dateTo = new Date();
	dateTo.setHours(0);
	dateTo.setMinutes(0);
	dateTo.setSeconds(0);
	dateTo.setMilliseconds(0);
	const dateFrom = new Date(dateTo);
	dateFrom.setMonth(dateFrom.getMonth() - 3);

	const data = await runGraphQL(`
		query GetOneTimeOrders(
			$collectiveSlug: String!
			$dateFrom: DateTime!
			$dateTo: DateTime!
			$limit: Int!
			$offset: Int!
		) {
			orders(
				account: { slug: $collectiveSlug }
				frequency: ONETIME
				status: PAID
				dateFrom: $dateFrom
				dateTo: $dateTo
				limit: $limit
				offset: $offset
			) {
				totalCount
				nodes {
					amount {
						value
						currency
					}
					createdAt
				}
			}
		}`,
		"GetOneTimeOrders",
		{
			collectiveSlug: "luanti",
			dateFrom: dateFrom.toISOString(),
			dateTo: dateTo.toISOString(),
			limit: 1000,
			offset: 0,
		});

	const nodes = data.orders.nodes;
	return nodes.reduce((acc, x) => acc + x.amount.value, 0) / 3;
}

async function getRecurring() {
	const data = await runGraphQL(`
		query GetRecurringMemberships(
			$collectiveSlug: String!
			$limit: Int!
		) {
			orders(
				account: { slug: $collectiveSlug }
				status: ACTIVE
				limit: $limit
			) {
				totalCount
				nodes {
					frequency
					amount {
						value
						currency
					}
				}
			}
		}`,
		"GetRecurringMemberships",
		{
			collectiveSlug: "luanti",
			limit: 1000,
		});

	const nodes = data.orders.nodes;
	return nodes
		.map(x => x.amount.value * (x.frequency == "YEARLY" ? (1/12) : 1))
		.reduce((acc, x) => acc + x, 0);
}

async function getCollectiveMonthlyBudget() {
	const oneTimeAverage = await getOneTimeTotal();
	const monthlyRecurring = await getRecurring();
	return oneTimeAverage + monthlyRecurring;
}

export default async function() {
	const {goals, balance} = await getCollectiveGoalsAndStats();
	const monthlyBudget = await getCollectiveMonthlyBudget();
	let monthlyBudgetAvailable = monthlyBudget;
	let monthlyTarget = 0;
	let balanceAvailable = balance;

	function getValueTarget(goal) {
		if (goal.type === "monthlyBudget") {
			const target = goal.amount / 100 - monthlyTarget;
			const value = Math.min(monthlyBudgetAvailable, target);
			monthlyBudgetAvailable -= value;
			monthlyTarget = goal.amount / 100;
			return [value, target, "[[value]] / [[target]] per month"];
		} else {
			const target = goal.amount / 100;
			const value = Math.min(balanceAvailable, target);
			balanceAvailable -= value;
			return [value, target, "[[value]] / [[target]] raised"];
		}
	}

	return {
		budget: Math.round(monthlyBudget),
		goals: goals
			.sort((a, b) => a.amount - b.amount)
			.map(goal => {
				const [value, target, progressSummary] = getValueTarget(goal);
				return {
					id: goal.key,
					title: goal.title,
					description: goal.description,
					value: Math.round(value),
					target: Math.round(target),
					progressSummary,
				};
			}),
	};
}
