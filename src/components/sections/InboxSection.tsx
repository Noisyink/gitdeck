import type { GhRepo } from "../../types/github";
import type { InboxItem } from "../../utils/inbox";
import { InboxView } from "../views/InboxView";

interface InboxSectionProps {
  items: InboxItem[];
  mailboxLabel: string;
  search: string;
  page: number;
  pageSize: number;
  reposByName: Map<string, GhRepo>;
  onRepoClick: (repo: GhRepo) => void;
  onMarkRead: (threadId: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function InboxSection({
  items,
  mailboxLabel,
  search,
  page,
  pageSize,
  reposByName,
  onRepoClick,
  onMarkRead,
  onRefresh,
  onPageChange,
  onPageSizeChange,
}: InboxSectionProps) {
  return (
    <InboxView
      items={items}
      mailboxLabel={mailboxLabel}
      search={search}
      page={page}
      pageSize={pageSize}
      reposByName={reposByName}
      onRepoClick={onRepoClick}
      onMarkRead={onMarkRead}
      onRefresh={onRefresh}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  );
}
