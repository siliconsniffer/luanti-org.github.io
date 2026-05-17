import EleventyFetch from "@11ty/eleventy-fetch";

const graphQL = `
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
}
`;

export default async function () {
	// Get goals for collective
	const req = await fetch("https://opencollective.com/api/graphql/v2", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query: graphQL,
			operationName: "GetCollectiveGoals",
			variables: {
				"collectiveSlug": "luanti",
			},
		}),
	});

	if (!req.ok) {
		console.error(await req.text());
		throw Error("Failed to load Open Collective goals");
	}

	const data = (await req.json()).data;
	let monthlyBudgetAvailable = data.collective.stats.yearlyBudget.value / 12;
	let monthlyTarget = 0;
	let balanceAvailable = data.collective.stats.balance.value;

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

	return data.collective.settings.goals
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
		});
}
