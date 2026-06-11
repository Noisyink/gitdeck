import type { GhRepo, RepoCIHealth } from "../../types/github";
import { CIHealthView } from "../views/CIHealthView";
import { formatNumber } from "../../utils/format";
import type { TranslationKey } from "../../i18n/translations";

type Translate = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface CISectionProps {
  t: Translate;
  ciHealth: RepoCIHealth[];
  reposByName: Map<string, GhRepo>;
  onRepoClick: (repo: GhRepo) => void;
}

export function CISection({ t, ciHealth, reposByName, onRepoClick }: CISectionProps) {
  const totalRuns = ciHealth.reduce((sum, entry) => sum + entry.totalRuns, 0);
  const totalFailures = ciHealth.reduce((sum, entry) => sum + entry.failureCount, 0);
  const failingRepos = ciHealth.filter((entry) => entry.failureCount > 0).length;
  const decided = ciHealth.reduce((sum, entry) => sum + entry.successCount + entry.failureCount, 0);
  const successes = ciHealth.reduce((sum, entry) => sum + entry.successCount, 0);
  const avgSuccessPct = decided ? Math.round((successes / decided) * 100) : 0;

  return (
    <div className="view-ci" style={{ display: "block" }}>
      <section className="stats">
        <div className="stat"><div className="k">{t("stats.reposWithCi")}</div><div className="v">{formatNumber(ciHealth.length)}</div><div className="sub">{t("stats.recentWorkflowRuns")}</div></div>
        <div className="stat"><div className="k">{t("stats.totalRuns")}</div><div className="v">{formatNumber(totalRuns)}</div><div className="sub">{t("stats.lastRunsPerRepo", { count: ciHealth[0]?.totalRuns ?? 30 })}</div></div>
        <div className="stat"><div className="k">{t("stats.avgSuccess")}</div><div className="v">{avgSuccessPct}%</div><div className="sub">{t("stats.acrossDecidedRuns")}</div></div>
        <div className="stat"><div className="k">{t("stats.failingRepos")}</div><div className="v">{formatNumber(failingRepos)}</div><div className="sub">{t("stats.failuresTotal", { count: formatNumber(totalFailures) })}</div></div>
      </section>
      <CIHealthView data={ciHealth} reposByName={reposByName} onRepoClick={onRepoClick} />
    </div>
  );
}
