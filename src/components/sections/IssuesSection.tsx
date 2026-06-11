import type { GhIssue } from "../../types/github";
import { ExportIcon } from "../common/Icons";
import { Pagination } from "../common/Pagination";
import { IssueList } from "../views/IssueList";
import { formatNumber } from "../../utils/format";
import type { TranslationKey } from "../../i18n/translations";

type Translate = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface IssuesSectionProps {
  t: Translate;
  filteredIssues: GhIssue[];
  visibleIssues: GhIssue[];
  issueSort: string;
  issuePageSafe: number;
  issuePageSize: number;
  onSortChange: (sort: string) => void;
  onExport: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function IssuesSection({
  t,
  filteredIssues,
  visibleIssues,
  issueSort,
  issuePageSafe,
  issuePageSize,
  onSortChange,
  onExport,
  onPageChange,
  onPageSizeChange,
}: IssuesSectionProps) {
  return (
    <div className="view-issues" style={{ display: "block" }}>
      <section className="stats">
        <div className="stat"><div className="k">{t("stats.openIssues")}</div><div className="v">{formatNumber(filteredIssues.length)}</div><div className="sub">{t("stats.matchingFilters")}</div></div>
        <div className="stat"><div className="k">{t("stats.repositories")}</div><div className="v">{new Set(filteredIssues.map((issue) => issue.repository.nameWithOwner)).size}</div><div className="sub">{t("stats.withOpenIssues")}</div></div>
        <div className="stat"><div className="k">{t("stats.organizations")}</div><div className="v">{new Set(filteredIssues.map((issue) => issue.repository.nameWithOwner.split("/")[0])).size}</div><div className="sub">{t("stats.includingPersonal")}</div></div>
        <div className="stat"><div className="k">{t("stats.stale30")}</div><div className="v">{filteredIssues.filter((issue) => Date.now() - new Date(issue.updatedAt).getTime() > 30 * 86_400_000).length}</div><div className="sub">{t("stats.noRecentActivity")}</div></div>
      </section>
      <div className="toolbar">
        <span className="count-chip"><strong>{visibleIssues.length}</strong> {t("common.of")} <span>{filteredIssues.length}</span> {t("common.shown")}</span>
        <div className="spacer" />
        <label>{t("common.sort")}</label>
        <select className="sort" value={issueSort} onChange={(event) => onSortChange(event.target.value)}>
          <option value="updated_desc">{t("sort.recentlyUpdated")}</option>
          <option value="updated_asc">{t("sort.leastRecentlyUpdated")}</option>
          <option value="created_desc">{t("sort.newest")}</option>
          <option value="created_asc">{t("sort.oldest")}</option>
          <option value="comments_desc">{t("sort.mostCommented")}</option>
          <option value="comments_asc">{t("sort.leastCommented")}</option>
          <option value="repo_asc">{t("sort.repositoryAZ")}</option>
        </select>
        <button className="btn ghost" onClick={onExport}><ExportIcon /> {t("common.export")}</button>
      </div>
      <IssueList issues={visibleIssues} />
      <Pagination totalItems={filteredIssues.length} page={issuePageSafe} pageSize={issuePageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}
