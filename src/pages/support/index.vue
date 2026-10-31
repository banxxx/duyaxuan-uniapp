<script setup lang="ts">
import { ref, computed } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { mockFaq } from '@/mock/data'
import { bottomInset } from '@/utils/platform'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

/**
 * 58 帮助与反馈
 *
 * 五条 FAQ 都做成可展开：默认只露问题，点开才展开答案。
 * 全展开会让页面一屏塞满文字，用户反而找不到自己那条。
 *
 * 搜索是本地过滤问题+答案，FAQ 只有几条，没必要走接口。
 * 反馈只留客服邮箱，点击复制——站内反馈没有后台查看入口，不再收。
 */
const keyword = ref('')
const openIndex = ref<number[]>([0])

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

function copyMail() {
  uni.setClipboardData({
    data: 'posoovo@gmail.com',
    success: () => toast.success('邮箱已复制')
  })
}
</script>

<template>
  <view class="support">
    <AppToast />
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
          desc="换个关键词试试，或直接发邮件给我们"
        />

        <!-- 没找到答案：只留客服邮箱，点击复制 -->
        <view class="contact">
          <view class="contact__head">
            <text class="contact__title">没找到答案？</text>
            <text class="contact__desc">发邮件告诉我们，我们会尽快回复</text>
          </view>
          <view class="contact__mail" hover-class="contact__mail--active" @tap="copyMail">
            <AppIcon name="mail" :size="14" color="#4F46E5" />
            <text class="contact__mail-text">posoovo@gmail.com</text>
            <text class="contact__copy">复制</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'SupportPage' }
</script>

<style lang="scss" scoped>
.support {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
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
    font-size: $fs-13;
    font-weight: 700;
    color: $ink;
  }
}

.search {
  height: 44px;
  padding: 0 14px;
  border-radius: $r-md;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 9px;

  &__input {
    flex: 1;
    font-size: $fs-13;
    color: $ink;
    height: 20px;
  }

  &__ph {
    color: $faint;
    font-size: $fs-13;
  }

  &__clear {
    font-size: $fs-11;
    color: $muted;
    flex-shrink: 0;
  }
}

.faq {
  border-radius: $r-input;
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
    font-size: $fs-13;
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
    font-size: $fs-12;
    color: $muted;
    line-height: 1.65;
  }
}

.contact {
  padding: 16px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__title {
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $muted;
  }

  /* 点整行复制，不用精确点到邮箱文字 */
  &__mail {
    padding: 12px;
    border-radius: $r-sm;
    background: $subtle;
    display: flex;
    align-items: center;
    gap: 8px;

    &--active {
      opacity: 0.8;
    }
  }

  &__mail-text {
    flex: 1;
    font-size: $fs-12;
    font-weight: 600;
    color: $ink;
  }

  &__copy {
    font-size: $fs-11;
    color: $accent;
    flex-shrink: 0;
  }
}
</style>
