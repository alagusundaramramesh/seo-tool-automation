// Scores are always 0 to 100. Higher is better.
//
// Page score  = average of the 4 Lighthouse scores (performance, accessibility, best practices, SEO)
// Site score  = average of all page scores
// Grade       = "good" (90+), "needs work" (50-89), "poor" (below 50), same colours as Lighthouse

function average(numbers) {
    const validNumbers = numbers.filter(number => typeof number === "number");

    if (validNumbers.length === 0) {
        return null;
    }

    const total = validNumbers.reduce((sum, number) => sum + number, 0);
    return Math.round(total / validNumbers.length);
}

export function getPageScore(categoryScores) {
    return average([
        categoryScores.performance,
        categoryScores.accessibility,
        categoryScores.bestPractices,
        categoryScores.seo
    ]);
}

export function getSiteScores(auditedPages) {
    return {
        overall: average(auditedPages.map(auditedPage => auditedPage.score)),
        performance: average(auditedPages.map(auditedPage => auditedPage.categoryScores.performance)),
        accessibility: average(auditedPages.map(auditedPage => auditedPage.categoryScores.accessibility)),
        bestPractices: average(auditedPages.map(auditedPage => auditedPage.categoryScores.bestPractices)),
        seo: average(auditedPages.map(auditedPage => auditedPage.categoryScores.seo))
    };
}

export function getGrade(score) {
    if (score === null) {
        return "unknown";
    }
    if (score >= 90) {
        return "good";
    }
    if (score >= 50) {
        return "needs work";
    }
    return "poor";
}
