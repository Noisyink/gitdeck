import type { GhIssue, GhRepo, RepoInsight } from "../../types/github";
import type { RepoOwnership } from "../../utils/dashboard";
import { ExportIcon } from "../common/Icons";
import { Pagination } from "../common/Pagination";
import { RepoGrid } from "../views/RepoGrid";
import { formatNumber } from "../../utils/format";
import type { TranslationKey } from "../../i18n/translations";
type Translate = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface ReposSectionProps {
  t: Translate;
  filteredRepos: GhRepo[];
  visibleRepos: GhRepo[];
  issues: GhIssue[];
  insightsByRepo: Map<string, RepoInsight>;
  // Noisyink fork: split star/fork counts and owned-only health are computed in the container
  mineStars: number;
  upstreamStars: number;
  mineForks: number;
  upstreamForks: number;
  averageHealth: number;
  // Noisyink fork: ownership toggle value and setter
  repoOwnership: RepoOwnership;
  repoSort: string;
  repoPageSafe: number;
  repoPageSize: number;
  onOwnershipChange: (ownership: RepoOwnership) => void;
  onSortChange: (sort: string) => void;
  onRepoClick: (repo: GhRepo) => void;
  onIssuesClick: (repo: string) => void;
  onStarsClick: (repo: string) => void;
  onForksClick: (repo: string) => void;
  onExport: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function ReposSection({
  t,
  filteredRepos,
  visibleRepos,
  issues,
  insightsByRepo,
  mineStars,
  upstreamStars,
  mineForks,
  upstreamForks,
  averageHealth,
  repoOwnership,
  repoSort,
  repoPageSafe,
  repoPageSize,
  onOwnershipChange,
  onSortChange,
  onRepoClick,
  onIssuesClick,
  onStarsClick,
  onForksClick,
  onExport,
  onPageChange,
  onPageSizeChange,
}: ReposSectionProps) {
  return (
    <div className="view-repos" style={{ display: "block" }}>
      <section className="stats">
        <div className="stat"><div className="k">{t("stats.repositories")}</div><div className="v">{formatNumber(filteredRepos.length)}</div><div className="sub">{t("stats.matchingFilters")}</div></div>
        <div className="stat"><div className="k">{t("stats.totalStars")}</div><div className="v">{formatNumber(mineStars)}</div><div className="sub">{t("stats.yoursUpstream", { count: formatNumber(upstreamStars) })}</div></div>
        <div className="stat"><div className="k">{t("stats.totalForks")}</div><div className="v">{formatNumber(mineForks)}</div><div className="sub">{t("stats.yoursUpstream", { count: formatNumber(upstreamForks) })}</div></div>
        <div className="stat"><div className="k">{t("stats.averageHealth")}</div><div className="v">{formatNumber(averageHealth)}</div><div className="sub">{t("stats.acrossYourRepos")}</div></div>
      </section>
      <div className="toolbar">
        <span className="count-chip"><strong>{visibleRepos.length}</strong> {t("common.of")} <span>{filteredRepos.length}</span> {t("common.shown")}</span>
        <div className="spacer" />
        <div className="owner-toggle" role="group" aria-label={t("repos.ownership.label")}>
          {(["both", "owned", "non-owned"] as RepoOwnership[]).map((opt) => (
            <button
              key={opt}
              type="button"
              className={`seg ${repoOwnership === opt ? "active" : ""}`}
              onClick={() => onOwnershipChange(opt)}
            >
              {t(opt === "both" ? "repos.ownership.both" : opt === "owned" ? "repos.ownership.owned" : "repos.ownership.nonOwned")}
            </button>
          ))}
        </div>
        <label>{t("common.sort")}</label>
        <select className="sort" value={repoSort} onChange={(event) => onSortChange(event.target.value)}>
          <option value="stars_desc">{t("sort.mostStars")}</option>
          <option value="stars_asc">{t("sort.fewestStars")}</option>
          <option value="forks_desc">{t("sort.mostForks")}</option>
          <option value="forks_asc">{t("sort.fewestForks")}</option>
          <option value="issues_desc">{t("sort.mostOpenIssues")}</option>
          <option value="issues_asc">{t("sort.fewestOpenIssues")}</option>
          <option value="health_desc">{t("sort.bestHealth")}</option>
          <option value="health_asc">{t("sort.mostAtRisk")}</option>
          <option value="pushed_desc">{t("sort.recentlyPushed")}</option>
          <option value="updated_desc">{t("sort.recentlyUpdated")}</option>
          <option value="name_asc">{t("sort.nameAZ")}</option>
        </select>
        <button className="btn ghost" onClick={onExport}><ExportIcon /> {t("common.export")}</button>
      </div>
      <RepoGrid
        repos={visibleRepos}
        issues={issues}
        insightsByRepo={insightsByRepo}
        onRepoClick={onRepoClick}
        onIssuesClick={onIssuesClick}
        onStarsClick={onStarsClick}
        onForksClick={onForksClick}
      />
      <Pagination totalItems={filteredRepos.length} page={repoPageSafe} pageSize={repoPageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}
