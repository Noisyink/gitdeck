import type { DailyDigestEntry, DigestPeriod } from "../../types/github";
import { DailyDigestView } from "../views/DailyDigestView";
import { formatNumber } from "../../utils/format";
import type { TranslationKey } from "../../i18n/translations";

type Translate = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface DigestsSectionProps {
  t: Translate;
  dailyDigests: DailyDigestEntry[];
  digestPeriod: DigestPeriod;
  onPeriodChange: (period: DigestPeriod) => void;
}

export function DigestsSection({ t, dailyDigests, digestPeriod, onPeriodChange }: DigestsSectionProps) {
  return (
    <div className="view-digests" style={{ display: "block" }}>
      <section className="stats">
        <div className="stat"><div className="k">{digestPeriod === "day" ? t("stats.digestDays") : digestPeriod === "week" ? t("stats.digestWeeks") : t("stats.digestMonths")}</div><div className="v">{formatNumber(dailyDigests.length)}</div><div className="sub">{digestPeriod === "day" ? t("stats.daysWithSavedSnapshots") : t("stats.periodsAggregated")}</div></div>
        <div className="stat"><div className="k">{t("stats.latestIssueDelta")}</div><div className="v">{dailyDigests[0] ? `${dailyDigests[0].issueDelta >= 0 ? "+" : ""}${formatNumber(dailyDigests[0].issueDelta)}` : "0"}</div><div className="sub">{t("stats.vsPrevious", { period: digestPeriod === "day" ? t("period.day") : t(`period.${digestPeriod}`) })}</div></div>
        <div className="stat"><div className="k">{t("stats.latestStarsDelta")}</div><div className="v">{dailyDigests[0] ? `${dailyDigests[0].starsDelta >= 0 ? "+" : ""}${formatNumber(dailyDigests[0].starsDelta)}` : "0"}</div><div className="sub">{t("stats.vsPrevious", { period: digestPeriod === "day" ? t("period.day") : t(`period.${digestPeriod}`) })}</div></div>
        <div className="stat"><div className="k">{t("stats.latestStaleDelta")}</div><div className="v">{dailyDigests[0] ? `${dailyDigests[0].staleIssueDelta >= 0 ? "+" : ""}${formatNumber(dailyDigests[0].staleIssueDelta)}` : "0"}</div><div className="sub">{t("stats.vsPrevious", { period: digestPeriod === "day" ? t("period.day") : t(`period.${digestPeriod}`) })}</div></div>
        <div className="stat"><div className="k">{t("alerts.totalAlerts")}</div><div className="v">{dailyDigests[0] ? formatNumber(dailyDigests[0].securityAlertsCount) : "0"}</div><div className="sub">{dailyDigests[0] ? t("digest.securityRepos", { count: formatNumber(dailyDigests[0].securityReposCount) }) : t("digest.securityUnavailable")}</div></div>
      </section>
      <DailyDigestView digests={dailyDigests} period={digestPeriod} onPeriodChange={onPeriodChange} />
    </div>
  );
}
