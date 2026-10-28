<script setup lang="ts">
import { ref, computed } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { mockFaq } from '@/mock/data'
import { bottomInset } from '@/utils/platform'

/**
 * 58 帮助与反馈
 *
 * 五条 FAQ 都做成可展开：默认只露问题，点开才展开答案。
 * 全展开会让页面一屏塞满文字，用户反而找不到自己那条。
 *
 * 搜索是本地过滤问题+答案，FAQ 只有几条，没必要走接口。
 * 反馈内容写进本地 storage 并 toast，真实环境是 POST /feedback。
 */
const keyword = ref('')
const openIndex = ref<number[]>([0])
const feedback = ref('')
const submitting = ref(false)

const list = computed(() => {
  const k = keyword.value.trim()
  if (!k) return mockFaq
  return mockFaq.filter((f) => f.q.includes(k) || f.a.includes(k))
})

/** 搜索时自动展开命中项，否则用户还得再点一次 */
const expanded = computed(() => (keyword.value.trim() ? list.value.map((_, i) => i) : openIndex.value))

function toggle(i: number) {
  if (keyword.value.trim()) return
  const at = openIndex.value.indexOf(i)
  if (at >= 0) openIndex.value.splice(at, 1)
  else openIndex.value.push(i)
}

const canSubmit = computed(() => feedback.value.trim().length >= 5 && !submitting.value)

function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  // 真实环境：await http.post('/feedback', { content })
  setTimeout(() => {
    submitting.value = false
    feedback.value = ''
    uni.showToast({ title: '已收到，我们会尽快回复', icon: 'none' })
  }, 400)
}

function copyMail() {
  uni.setClipboardData({
    data: 'support@vote.jun',
    success: () => uni.showToast({ title: '邮箱已复制', icon: 'none' })
  })
}
</script>

<template>
  <view class="support">
    <AppNavBar title="帮助与反馈" />

    <scroll-view class="support__scroll" scroll-y>
      <view class="support__content" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 搜索 -->
        <view class="search">
          <AppIcon name="search" :size="16" color="#A1A1AA" />
          <input
            v-model="keyword"
            class="search__input"
            placeholder="搜索常见问题"
            placeholder-class="search__ph"
            confirm-type="search"
          />
          <text v-if="keyword" class="search__clear" @tap="keyword = ''">清除</text>
        </view>

        <text class="support__head">常见问题</text>

        <view v-if="list.length" class="faq">
          <template v-for="(f, i) in list" :key="f.q">
            <view v-if="i > 0" class="faq__sep" />
            <view class="item">
              <view class="item__q" @tap="toggle(i)">
                <text class="item__q-text">{{ f.q }}</text>
                <view class="item__chev" :class="{ 'item__chev--open': expanded.includes(i) }">
                  <AppIcon name="chevron-down" :size="15" color="#A1A1AA" />
                </view>
              </view>
              <text v-if="expanded.includes(i)" class="item__a">{{ f.a }}</text>
            </view>
          </template>
        </view>

        <AppEmpty
          v-else
          icon="search"
          title="没有找到相关问题"
          desc="换个关键词试试，或者在下面直接告诉我们"
        />

        <!-- 反馈 -->
        <view class="feedback">
          <text class="feedback__title">没找到答案？</text>
          <text class="feedback__desc">告诉我们你遇到的问题，我们会尽快回复</text>
          <view class="feedback__box">
            <textarea
              v-model="feedback"
              class="feedback__input"
              :maxlength="200"
              placeholder="描述你的问题或建议…"
              placeholder-class="feedback__ph"
            />
          </view>
          <view
            class="feedback__btn"
            :class="{ 'feedback__btn--off': !canSubmit }"
            hover-class="feedback__btn--active"
            @tap="submit"
          >
            <text class="feedback__btn-text">{{ submitting ? '提交中…' : '提交反馈' }}</text>
          </view>
        </view>

        <text class="support__mail" @tap="copyMail">客服邮箱 support@vote.jun</text>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'SupportPage' }
</script>

<style lang="scss" scoped>
.support {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__content {
    /* 下边距由 bottomInset(20) 内联控制 */
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  &__head {
    font-size: 13px;
    font-weight: 700;
    color: $ink;
  }

  &__mail {
    font-size: 11px;
    color: $faint;
    text-align: center;
  }
}

.search {
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 9px;

  &__input {
    flex: 1;
    font-size: 13px;
    color: $ink;
    height: 20px;
  }

  &__ph {
    color: $faint;
    font-size: 13px;
  }

  &__clear {
    font-size: 11px;
    color: $muted;
    flex-shrink: 0;
  }
}

.faq {
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  overflow: hidden;

  &__sep {
    height: 1px;
    background: $line;
  }
}

.item {
  padding: 14px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__q {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__q-text {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: $ink;
    line-height: 1.45;
  }

  &__chev {
    display: flex;
    transition: transform 0.2s;

    &--open {
      transform: rotate(180deg);
    }
  }

  &__a {
    font-size: 12px;
    color: $muted;
    line-height: 1.65;
  }
}

.feedback {
  padding: 16px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $muted;
  }

  &__box {
    position: relative;
    padding: 12px;
    border-radius: 10px;
    background: $subtle;
    height: 84px;
    box-sizing: border-box;
  }

  &__input {
    width: 100%;
    /* 跟着 84 高的灰框走：写死 44 的话下面空一截，多打两行还会被截 */
    height: 100%;
    font-size: 12px;
    color: $ink;
    line-height: 1.5;
  }

  &__ph {
    color: $faint;
    font-size: 12px;
  }

  &__btn {
    height: 44px;
    border-radius: 12px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;

    &--off {
      opacity: 0.4;
    }

    &--active {
      opacity: 0.85;
    }
  }

  &__btn-text {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
  }
}
</style>
