<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import TypeBadge from '@/components/business/TypeBadge.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { searchPolls } from '@/api/poll'
import { bottomInset } from '@/utils/platform'
import { ROUTES, back, go } from '@/utils/router'

/**
 * 04 搜索结果
 *
 * 搜索框默认带焦点（从首页点进来就是为了搜），历史记录本地存 6 条。
 * 结果卡片和 41 的列表行不同：这里没有状态胶囊和指标行，
 * 只有「类型 + 人数 + 标题」——搜索结果只用来辨认是哪一场，不承担管理。
 */
const HISTORY_KEY = 'dyx_search_history'

const keyword = ref('')
const results = ref<Poll[]>([])
const searched = ref(false)
const loading = ref(false)
const history = ref<string[]>([])
/** 排序：最新 / 最热。默认最新，点按钮切换 */
const sort = ref<'latest' | 'hot'>('latest')
const sortLabel = computed(() => (sort.value === 'latest' ? '最新' : '最热'))

// 历史记录只存用户真的搜过的词，没有就空着（不塞假数据）
try {
  const raw = uni.getStorageSync(HISTORY_KEY)
  history.value = raw ? JSON.parse(raw) : []
} catch {
  history.value = []
}

let timer: ReturnType<typeof setTimeout> | null = null

watch(keyword, (v) => {
  if (timer) clearTimeout(timer)
  if (!v.trim()) {
    searched.value = false
    results.value = []
    return
  }
  timer = setTimeout(() => run(v), 300)
})

async function run(v: string) {
  loading.value = true
  try {
    results.value = await searchPolls(v, sort.value)
    searched.value = true
  } finally {
    loading.value = false
  }
}

/** 切换排序后按当前关键词重搜 */
function toggleSort() {
  sort.value = sort.value === 'latest' ? 'hot' : 'latest'
  if (keyword.value.trim()) run(keyword.value)
}

function pickTag(tag: string) {
  keyword.value = tag
  run(tag)
}

function remember(v: string) {
  const next = [v, ...history.value.filter((h) => h !== v)].slice(0, 6)
  history.value = next
  uni.setStorageSync(HISTORY_KEY, JSON.stringify(next))
}

function clearHistory() {
  history.value = []
  uni.removeStorageSync(HISTORY_KEY)
}

function clearKeyword() {
  keyword.value = ''
  searched.value = false
  results.value = []
}

function openDetail(poll: Poll) {
  remember(keyword.value.trim())
  go(ROUTES.detail, { id: poll.id })
}

function cancel() {
  back()
}
</script>

<template>
  <view class="search">
    <AppNavBar title="搜索">
      <template #right>
        <text class="search__cancel" @tap="cancel">取消</text>
      </template>
    </AppNavBar>

    <view class="search__content" :style="{ paddingBottom: bottomInset(20) }">
      <!-- 搜索框：有内容时描边变紫，右侧出现清除按钮 -->
      <view class="box" :class="{ 'box--active': keyword }">
        <AppIcon name="search" :size="18" :color="keyword ? '#71717A' : '#A1A1AA'" />
        <input
          v-model="keyword"
          class="box__input"
          placeholder="搜索投票或问卷"
          placeholder-class="box__ph"
          focus
          confirm-type="search"
          @confirm="remember(keyword.trim())"
        />
        <view v-if="keyword" class="box__clear" @tap="clearKeyword">
          <AppIcon name="x" :size="11" color="#71717A" :stroke-width="2.5" />
        </view>
      </view>

      <!-- 结果头部 -->
      <view v-if="searched" class="sort">
        <text class="sort__count">
          找到 {{ results.length }} 个相关投票与问卷
        </text>
        <view class="sort__btn" hover-class="sort__btn--active" @tap="toggleSort">
          <AppIcon name="arrow-down-wide-narrow" :size="13" color="#09090B" />
          <text class="sort__btn-text">{{ sortLabel }}</text>
        </view>
      </view>

      <!-- 最近搜索（没输入时显示） -->
      <view v-if="!searched" class="history">
        <view class="history__head">
          <text class="history__title">最近搜索</text>
          <view v-if="history.length" class="history__clear" @tap="clearHistory">
            <AppIcon name="trash-2" :size="14" color="#A1A1AA" />
          </view>
        </view>
        <view class="history__tags">
          <view
            v-for="tag in history"
            :key="tag"
            class="history__tag"
            hover-class="history__tag--active"
            @tap="pickTag(tag)"
          >
            <text class="history__tag-text">{{ tag }}</text>
          </view>
          <text v-if="!history.length" class="history__empty">还没有搜索记录</text>
        </view>
      </view>

      <!-- 结果列表 -->
      <template v-else>
        <view class="results">
          <text class="results__head">投票与问卷</text>

          <view
            v-for="poll in results"
            :key="poll.id"
            class="card"
            hover-class="card--active"
            @tap="openDetail(poll)"
          >
            <view class="card__left">
              <view class="card__top">
                <TypeBadge :type="poll.type" size="sm" />
                <text class="card__people">
                  {{
                    poll.type === 'survey'
                      ? `${poll.answerCount ?? 0} 条回答`
                      : `${poll.voterCount} 人已投`
                  }}
                </text>
              </view>
              <text class="card__title">{{ poll.title }}</text>
            </view>
            <AppIcon name="chevron-right" :size="16" color="#A1A1AA" />
          </view>

          <AppEmpty
            v-if="!results.length && !loading"
            icon="search"
            title="没有找到相关内容"
            desc="换个关键词试试，比如「团建」「午餐」"
          />

          <view v-if="results.length" class="results__more">
            <text class="results__more-text">没有更多结果了</text>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'SearchPage' }
</script>

<style lang="scss" scoped>
.search {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__cancel {
    font-size: 13px;
    color: $muted;
  }

  &__content {
    flex: 1;
    /* 下边距由 bottomInset(20) 内联控制 */
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
}

.box {
  height: 46px;
  padding: 0 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 10px;

  &--active {
    border-color: $accent;
  }

  &__input {
    flex: 1;
    font-size: 14px;
    color: $ink;
  }

  &__ph {
    color: $faint;
  }

  &__clear {
    width: 18px;
    height: 18px;
    border-radius: 9px;
    background: $line;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.sort {
  display: flex;
  align-items: center;
  justify-content: space-between;

  &__count {
    font-size: 12px;
    color: $muted;
  }

  &__btn {
    padding: 6px 10px;
    border-radius: 8px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    gap: 5px;

    &--active {
      background: $subtle;
    }
  }

  &__btn-text {
    font-size: 11px;
    font-weight: 600;
    color: $ink;
  }
}

.history {
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__clear {
    padding: 2px;
  }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__tag {
    padding: 7px 12px;
    border-radius: 16px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;

    &--active {
      background: $subtle;
    }
  }

  &__tag-text {
    font-size: 12px;
    color: $muted;
  }

  &__empty {
    font-size: 11px;
    color: $faint;
  }
}

.results {
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__head {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__more {
    padding: 20px 0;
    display: flex;
    justify-content: center;
  }

  &__more-text {
    font-size: 11px;
    color: $faint;
  }
}

.card {
  padding: 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 10px;

  &--active {
    background: $subtle;
  }

  &__left {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  &__top {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__people {
    font-size: 10px;
    color: $faint;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
