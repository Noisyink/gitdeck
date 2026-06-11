import type { GhRepo, RepoInsight } from "../../types/github";
import { InsightsView } from "../views/InsightsView";
import { formatNumber } from "../../utils/format";
import type { TranslationKey } from "../../i18n/translations";

type Translate = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface InsightsSectionProps {
  t: Translate;
  filteredInsights: RepoInsight[];
  reposByName: Map<string, GhRepo>;
  averageHealth: number;
  totalAlerts: number;
  repoInsightsRiskyCount: number;
  onRepoClick: (repo: GhRepo) => void;
}

export function InsightsSection({
  t,
  filteredInsights,
  reposByName,
  averageHealth,
  totalAlerts,
  repoInsightsRiskyCount,
  onRepoClick,
}: InsightsSectionProps) {
  return (
    <div className="view-insights" style={{ display: "block" }}>
      <section className="stats">
        <div className="stat"><div className="k">{t("stats.averageHealth")}</div><div className="v">{formatNumber(averageHealth)}</div><div className="sub">{t("stats.acrossYourRepos")}</div></div>
        <div className="stat"><div className="k">{t("stats.alertCount")}</div><div className="v">{formatNumber(totalAlerts)}</div><div className="sub">{t("stats.activeRisksDetected")}</div></div>
        <div className="stat"><div className="k">{t("stats.reposWithInsights")}</div><div className="v">{formatNumber(filteredInsights.length)}</div><div className="sub">{t("stats.alertsOpportunitiesCorrelations")}</div></div>
        <div className="stat"><div className="k">{t("stats.atRiskRepos")}</div><div className="v">{formatNumber(repoInsightsRiskyCount)}</div><div className="sub">{t("stats.healthScoreUnder55")}</div></div>
      </section>
      <InsightsView insights={filteredInsights} reposByName={reposByName} onRepoClick={onRepoClick} />
    </div>
  );
}
