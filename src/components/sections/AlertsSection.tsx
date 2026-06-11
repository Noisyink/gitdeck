import type { GhRepo, RepoInsight } from "../../types/github";
import { InsightsView } from "../views/InsightsView";
import { formatNumber } from "../../utils/format";
import type { TranslationKey } from "../../i18n/translations";

type Translate = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface AlertsSectionProps {
  t: Translate;
  securityInsights: RepoInsight[];
  reposByName: Map<string, GhRepo>;
  totalSecurityAlerts: number;
  securityRepoCount: number;
  securityAverageHealth: number;
  securityInsightsAlertCount: number;
  onRepoClick: (repo: GhRepo) => void;
}

export function AlertsSection({
  t,
  securityInsights,
  reposByName,
  totalSecurityAlerts,
  securityRepoCount,
  securityAverageHealth,
  securityInsightsAlertCount,
  onRepoClick,
}: AlertsSectionProps) {
  return (
    <div className="view-alerts" style={{ display: "block" }}>
      <section className="stats">
        <div className="stat"><div className="k">{t("alerts.totalAlerts")}</div><div className="v">{formatNumber(totalSecurityAlerts)}</div><div className="sub">{t("alerts.affectedRepos", { count: formatNumber(securityRepoCount) })}</div></div>
        <div className="stat"><div className="k">{t("alerts.reposWithAlerts")}</div><div className="v">{formatNumber(securityRepoCount)}</div><div className="sub">{t("alerts.securityFocusedView")}</div></div>
        <div className="stat"><div className="k">{t("stats.averageHealth")}</div><div className="v">{formatNumber(securityAverageHealth)}</div><div className="sub">{t("alerts.acrossSecurityRepos")}</div></div>
        <div className="stat"><div className="k">{t("stats.alertCount")}</div><div className="v">{formatNumber(securityInsightsAlertCount)}</div><div className="sub">{t("alerts.repoInsightAlerts")}</div></div>
      </section>
      <InsightsView
        insights={securityInsights}
        reposByName={reposByName}
        onRepoClick={onRepoClick}
        emptyTitleKey="alerts.emptyTitle"
        emptyTextKey="alerts.emptyText"
      />
    </div>
  );
}
