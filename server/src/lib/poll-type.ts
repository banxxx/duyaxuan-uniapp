/**
 * 投票类型的中文名
 *
 * 订阅消息的「活动名称」用它。以后加新类型（排序、打分、报名……）在这里补一行，
 * 通知、模板都不用改；没登记的类型退回「投票」，不会把英文枚举直接发给用户。
 */
const LABELS: Record<string, string> = {
  single: '单选投票',
  multiple: '多选投票',
  survey: '问卷收集'
}

export function pollTypeLabel(type: string): string {
  return LABELS[type] ?? '投票'
}
