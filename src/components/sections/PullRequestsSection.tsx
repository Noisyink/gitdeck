import type { GhPullRequest } from "../../types/github";
import { ExportIcon } from "../common/Icons";
import { Pagination } from "../common/Pagination";
import { PullRequestList } from "../views/PullRequestList";
import { formatNumber } from "../../utils/format";
import type { TranslationKey } from "../../i18n/translations";
import type { PullRequestFilters } from "../../utils/dashboard";

type Translate = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface PullRequestsSectionProps {
  t: Translate;
  filteredPullRequests: GhPullRequest[];
  visiblePullRequests: GhPullRequest[];
  draftCount: number;
  awaitingReviewCount: number;
  approvedCount: number;
  stalePrCount: number;
  prFilters: PullRequestFilters;
  prSort: string;
  prPageSafe: number;
  prPageSize: number;
  onPresetChange: (preset: string) => void;
  onSortChange: (sort: string) => void;
  onExport: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function PullRequestsSection({
  t,
  filteredPullRequests,
  visiblePullRequests,
  draftCount,
  awaitingReviewCount,
  approvedCount,
  stalePrCount,
  prFilters,
  prSort,
  prPageSafe,
  prPageSize,
  onPresetChange,
  onSortChange,
  onExport,
  onPageChange,
  onPageSizeChange,
}: PullRequestsSectionProps) {
  return (
    <div className="view-prs" style={{ display: "block" }}>
      <section className="stats">
        <div className="stat"><div className="k">{t("stats.openPrs")}</div><div className="v">{formatNumber(filteredPullRequests.length)}</div><div className="sub">{t("stats.matchingFilters")}</div></div>
        <div className="stat"><div className="k">{t("stats.drafts")}</div><div className="v">{formatNumber(draftCount)}</div><div className="sub">{t("stats.acrossAllPrs")}</div></div>
        <div className="stat"><div className="k">{t("stats.awaitingReview")}</div><div className="v">{formatNumber(awaitingReviewCount)}</div><div className="sub">{t("stats.noReviewYet")}</div></div>
        <div className="stat"><div className="k">{t("stats.approved")}</div><div className="v">{formatNumber(approvedCount)}</div><div className="sub">{t("stats.readyToMerge")}</div></div>
        <div className="stat"><div className="k">{t("stats.stale14")}</div><div className="v">{formatNumber(stalePrCount)}</div><div className="sub">{t("stats.noRecentActivity")}</div></div>
      </section>
      <div className="toolbar">
        <span className="count-chip"><strong>{visiblePullRequests.length}</strong> {t("common.of")} <span>{filteredPullRequests.length}</span> {t("common.shown")}</span>
        <div className="spacer" />
        <label>{t("common.preset")}</label>
        <select className="sort" value={prFilters.preset} onChange={(event) => onPresetChange(event.target.value)}>
          <option value="">{t("common.all")}</option>
          <option value="ready">{t("preset.ready")}</option>
          <option value="draft">{t("preset.draft")}</option>
          <option value="awaiting-review">{t("preset.awaitingReview")}</option>
          <option value="approved">{t("preset.approved")}</option>
          <option value="changes-requested">{t("preset.changesRequested")}</option>
          <option value="assigned-me">{t("preset.assignedMe")}</option>
          <option value="authored-me">{t("preset.authoredMe")}</option>
          <option value="stale">{t("preset.stale")}</option>
        </select>
        <label>{t("common.sort")}</label>
        <select className="sort" value={prSort} onChange={(event) => onSortChange(event.target.value)}>
          <option value="updated_desc">{t("sort.recentlyUpdated")}</option>
          <option value="updated_asc">{t("sort.leastRecentlyUpdated")}</option>
          <option value="created_desc">{t("sort.newest")}</option>
          <option value="created_asc">{t("sort.oldest")}</option>
          <option value="review_pending">{t("sort.awaitingReviewFirst")}</option>
          <option value="size_desc">{t("sort.largestDiff")}</option>
          <option value="size_asc">{t("sort.smallestDiff")}</option>
          <option value="files_desc">{t("sort.mostFilesChanged")}</option>
          <option value="comments_desc">{t("sort.mostCommented")}</option>
          <option value="repo_asc">{t("sort.repositoryAZ")}</option>
        </select>
        <button className="btn ghost" onClick={onExport}><ExportIcon /> {t("common.export")}</button>
      </div>
      <PullRequestList pullRequests={visiblePullRequests} />
      <Pagination totalItems={filteredPullRequests.length} page={prPageSafe} pageSize={prPageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}
